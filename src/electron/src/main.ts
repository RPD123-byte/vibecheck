import { app, Menu, nativeImage, systemPreferences, Tray } from "electron";
import path from "node:path";
import {
  buildMenuTemplate,
  MenuActions,
  menuProjection,
} from "./menu-template";
import { PublicState, publicProjection, RuntimeSnapshot } from "./protocol";
import { RuntimeClient } from "./runtime-client";

if (process.platform !== "darwin") {
  app.quit();
  throw new Error("Vibecheck is currently available only on macOS");
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
}

let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let runtime: RuntimeClient | null = null;
let runtimeReady: Promise<void> | null = null;
let shutdownInProgress = false;
let actionPending = false;
let actionError: string | null = null;
let trayImageIsEmpty = true;
let lastState: PublicState = {
  aggregate: "off",
  features: {
    revision: 0,
    notch_enabled: false,
    integrations: { codex_enabled: false },
    paused: false,
  },
  camera: "off",
  canRecover: false,
};

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "trayTemplate.png")
    : path.join(app.getAppPath(), "resources", "trayTemplate.png");
}

function labelFor(aggregate: PublicState["aggregate"]): string {
  return (
    {
      off: "Off",
      starting: "Starting",
      active: "Active",
      paused: "Paused",
      needs_permission: "Needs Camera Permission",
      degraded: "Degraded",
      failed: "Failed",
    } as const
  )[aggregate];
}

async function allowCameraIfNeeded(enabled: boolean): Promise<void> {
  if (!app.isPackaged && process.env.VIBECHECK_RUNTIME_MODE === "demo") {
    return;
  }
  if (
    !enabled ||
    systemPreferences.getMediaAccessStatus("camera") === "granted"
  ) {
    return;
  }
  const granted = await systemPreferences.askForMediaAccess("camera");
  if (!granted) {
    lastState = {
      ...lastState,
      aggregate: "needs_permission",
      camera: "needs_permission",
    };
    rebuildMenu();
    throw new Error("Camera access is required to enable this feature");
  }
}

async function runMenuAction(action: () => Promise<void>): Promise<void> {
  if (actionPending) return;
  actionPending = true;
  actionError = null;
  rebuildMenu();
  try {
    await runtimeReady;
    await action();
  } catch (error) {
    actionError =
      error instanceof Error
        ? error.message
        : "The action could not be completed";
  } finally {
    actionPending = false;
    rebuildMenu();
  }
}

const actions: MenuActions = {
  setNotch: (enabled) =>
    runMenuAction(async () => {
      await allowCameraIfNeeded(enabled);
      await runtime?.setFeature("notch", enabled);
    }),
  setCodex: (enabled) =>
    runMenuAction(async () => {
      await allowCameraIfNeeded(enabled);
      await runtime?.setFeature("codex", enabled);
    }),
  setPaused: (paused) =>
    runMenuAction(async () => {
      await runtime?.setPaused(paused);
    }),
  recover: () =>
    runMenuAction(async () => {
      await runtime?.recover();
    }),
  quit: () => app.quit(),
};

function rebuildMenu(): void {
  if (!tray) return;
  trayMenu = Menu.buildFromTemplate(
    buildMenuTemplate(lastState, actions, {
      pending: actionPending,
      error: actionError,
    }),
  );
  tray.setContextMenu(trayMenu);
  tray.setToolTip(`Vibecheck — ${labelFor(lastState.aggregate)}`);
}

function publish(snapshot: RuntimeSnapshot): void {
  lastState = publicProjection(snapshot);
  actionError = null;
  rebuildMenu();
}

function installDevelopmentTestHook(): void {
  if (app.isPackaged || process.env.VIBECHECK_E2E !== "1") return;
  Object.assign(globalThis, {
    __vibecheckE2E: {
      state: () => lastState,
      menu: () =>
        menuProjection(
          buildMenuTemplate(lastState, actions, {
            pending: actionPending,
            error: actionError,
          }),
        ),
      invoke: async (
        action: "notch" | "codex" | "pause" | "recover" | "quit",
        enabled?: boolean,
      ) => {
        if (action === "notch") await actions.setNotch(Boolean(enabled));
        if (action === "codex") await actions.setCodex(Boolean(enabled));
        if (action === "pause") await actions.setPaused(Boolean(enabled));
        if (action === "recover") await actions.recover();
        if (action === "quit") actions.quit();
      },
      dismissMenu: () => tray?.closeContextMenu(),
      trayImageIsEmpty: () => trayImageIsEmpty,
    },
  });
}

async function launch(): Promise<void> {
  app.setName("Vibecheck");
  app.dock?.hide();
  Menu.setApplicationMenu(null);
  runtime = new RuntimeClient();
  runtime.on("state", publish);
  runtime.on("terminal-failure", () => {
    lastState = { ...lastState, aggregate: "failed", canRecover: true };
    rebuildMenu();
  });
  runtime.on("runtime-error", (error) => console.error(error));
  runtimeReady = runtime.start();
  const image = nativeImage.createFromPath(iconPath());
  trayImageIsEmpty = image.isEmpty();
  if (trayImageIsEmpty) {
    throw new Error(`Vibecheck tray icon is missing or invalid: ${iconPath()}`);
  }
  image.setTemplateImage(true);
  tray = new Tray(image);
  rebuildMenu();
  installDevelopmentTestHook();
  await runtimeReady;
}

app.on("second-instance", () => {
  app.focus({ steal: true });
});
app.on("window-all-closed", () => {
  // The native-menu utility has no BrowserWindow and remains alive here.
});
app.on("before-quit", (event) => {
  if (shutdownInProgress) {
    event.preventDefault();
    return;
  }
  if (runtime) {
    event.preventDefault();
    shutdownInProgress = true;
    const owned = runtime;
    runtime = null;
    runtimeReady = null;
    void owned.shutdown().finally(() => app.exit(0));
  }
});
app
  .whenReady()
  .then(launch)
  .catch((error) => {
    console.error(error);
    app.quit();
  });
