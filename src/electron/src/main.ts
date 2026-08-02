import { app, Menu, nativeImage, systemPreferences, Tray } from "electron";
import path from "node:path";
import {
  buildMenuTemplate,
  MenuActions,
  menuProjection,
} from "./menu-template";
import { FeaturePreferences, Preferences } from "./preferences";
import { PublicState, publicProjection, RuntimeSnapshot } from "./protocol";
import { RuntimeClient } from "./runtime-client";
import { ComponentReactionService } from "./component-reactions/reaction-service";
import { BrowserReactionHost } from "./component-reactions/browser-host";

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
let componentReactions: ComponentReactionService | null = null;
let runtimeReady: Promise<void> | null = null;
let shutdownInProgress = false;
let actionPending = false;
let actionError: string | null = null;
let trayImageIsEmpty = true;
let trayMenuPopupCount = 0;
const preferences = new Preferences();
let lastState: PublicState = {
  aggregate: "off",
  features: {
    revision: 0,
    notch_enabled: false,
    component_reactions_enabled: false,
    integrations: { codex_enabled: false },
    paused: false,
  },
  camera: "off",
  componentReactions: {
    desired: false,
    effective: false,
    health: "off",
    attached_targets: 0,
    unavailable_targets: 0,
    permission: "unknown",
    companion_ready: false,
    clipboard_ready: false,
    last_error: null,
    browser_transport: "off",
    attached_browser_tabs: 0,
    browser_last_error: null,
  },
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

async function allowCameraIfNeeded(
  enabled: boolean,
  desired?: FeaturePreferences,
): Promise<boolean> {
  if (!app.isPackaged && process.env.VIBECHECK_RUNTIME_MODE === "demo") {
    return true;
  }
  if (
    !enabled ||
    systemPreferences.getMediaAccessStatus("camera") === "granted"
  ) {
    return true;
  }
  const granted = await systemPreferences.askForMediaAccess("camera");
  if (!granted) {
    lastState = {
      ...lastState,
      aggregate: "needs_permission",
      camera: "needs_permission",
      features: desired
        ? {
            ...lastState.features,
            notch_enabled: desired.notch_enabled,
            component_reactions_enabled: desired.component_reactions_enabled,
            integrations: { codex_enabled: desired.codex_enabled },
          }
        : lastState.features,
    };
    rebuildMenu();
    return false;
  }
  return true;
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
      if (!(await allowCameraIfNeeded(enabled))) {
        throw new Error("Camera access is required to enable this feature");
      }
      await runtime?.setFeature("notch", enabled);
    }),
  setCodex: (enabled) =>
    runMenuAction(async () => {
      if (!(await allowCameraIfNeeded(enabled))) {
        throw new Error("Camera access is required to enable this feature");
      }
      await runtime?.setFeature("codex", enabled);
    }),
  setComponentReactions: (enabled) =>
    runMenuAction(async () => {
      await runtime?.setFeature("component_reactions", enabled);
    }),
  openChromeSetup: () =>
    runMenuAction(async () => {
      await componentReactions?.openChromeSetup();
    }),
  openSafariSetup: () =>
    runMenuAction(async () => {
      await componentReactions?.openSafariSetup();
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
  tray.setToolTip(`Vibecheck — ${labelFor(lastState.aggregate)}`);
}

function showTrayMenu(): void {
  if (!tray) return;
  trayMenuPopupCount += 1;
  if (!app.isPackaged && process.env.VIBECHECK_E2E === "1") return;
  tray.popUpContextMenu(trayMenu ?? undefined);
}

function publish(snapshot: RuntimeSnapshot): void {
  const projected = publicProjection(snapshot);
  lastState = {
    ...projected,
    componentReactions: componentReactions
      ? (() => {
          const { reaction_socket: _private, ...state } =
            componentReactions.state;
          return state;
        })()
      : projected.componentReactions,
  };
  actionError = null;
  rebuildMenu();
  void componentReactions?.sync(snapshot).catch((error) => {
    console.error("[component-reactions]", error);
  });
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
        action:
          | "notch"
          | "codex"
          | "component_reactions"
          | "chrome_setup"
          | "safari_setup"
          | "pause"
          | "recover"
          | "quit",
        enabled?: boolean,
      ) => {
        if (action === "notch") await actions.setNotch(Boolean(enabled));
        if (action === "codex") await actions.setCodex(Boolean(enabled));
        if (action === "component_reactions")
          await actions.setComponentReactions(Boolean(enabled));
        if (action === "chrome_setup") await actions.openChromeSetup();
        if (action === "safari_setup") await actions.openSafariSetup();
        if (action === "pause") await actions.setPaused(Boolean(enabled));
        if (action === "recover") await actions.recover();
        if (action === "quit") actions.quit();
      },
      dismissMenu: () => tray?.closeContextMenu(),
      trayClickListenerCount: () => ({
        mouseDown: tray?.listenerCount("mouse-down") ?? 0,
        rightClick: tray?.listenerCount("right-click") ?? 0,
      }),
      menuPopupCount: () => trayMenuPopupCount,
      trayImageIsEmpty: () => trayImageIsEmpty,
    },
  });
}

async function launch(): Promise<void> {
  app.setName("Vibecheck");
  app.dock?.hide();
  Menu.setApplicationMenu(null);
  runtime = new RuntimeClient(preferences, undefined, (desired) =>
    allowCameraIfNeeded(
      desired.notch_enabled || desired.codex_enabled,
      desired,
    ),
  );
  componentReactions = new ComponentReactionService(
    preferences,
    undefined,
    undefined,
    undefined,
    undefined,
    new BrowserReactionHost(),
    app.isPackaged || process.env.VIBECHECK_E2E !== "1",
  );
  componentReactions.on("state", (state) => {
    const { reaction_socket: _private, ...publicState } = state;
    lastState = { ...lastState, componentReactions: publicState };
    rebuildMenu();
  });
  componentReactions.on("diagnostic", (message) =>
    console.error("[component-reactions]", message),
  );
  const stored = preferences.read();
  void componentReactions
    .startOwnership(stored.codex_enabled || stored.component_reactions_enabled)
    .catch((error) => console.error("[component-reactions]", error));
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
  tray.on("mouse-down", showTrayMenu);
  tray.on("right-click", showTrayMenu);
  rebuildMenu();
  installDevelopmentTestHook();
  await runtimeReady;
}

if (lock) {
  app.on("second-instance", () => {
    showTrayMenu();
  });
  app.on("activate", () => {
    showTrayMenu();
  });
  app.on("window-all-closed", () => {
    // The native-menu utility has no BrowserWindow and remains alive here.
  });
  app.on("before-quit", (event) => {
    if (shutdownInProgress) {
      event.preventDefault();
      return;
    }
    if (runtime || componentReactions) {
      event.preventDefault();
      shutdownInProgress = true;
      const owned = runtime;
      const components = componentReactions;
      runtime = null;
      componentReactions = null;
      runtimeReady = null;
      void Promise.allSettled([
        components?.shutdown() ?? Promise.resolve(),
        owned?.shutdown() ?? Promise.resolve(),
      ]).finally(() => app.exit(0));
    }
  });
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      console.error(error);
      app.quit();
    });
}
