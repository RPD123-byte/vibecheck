import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  systemPreferences,
  Tray,
} from "electron";
import path from "node:path";
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
let popover: BrowserWindow | null = null;
let runtime: RuntimeClient | null = null;
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
  return path.join(app.getAppPath(), "resources", "trayTemplate.svg");
}

function positionPopover(): void {
  if (!popover || !tray) return;
  const trayBounds = tray.getBounds();
  const windowBounds = popover.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  });
  const area = display.workArea;
  const desiredX = Math.round(
    trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2,
  );
  const x = Math.max(
    area.x + 8,
    Math.min(desiredX, area.x + area.width - windowBounds.width - 8),
  );
  const below = trayBounds.y + trayBounds.height + 7;
  const y =
    below + windowBounds.height <= area.y + area.height
      ? below
      : trayBounds.y - windowBounds.height - 7;
  popover.setPosition(x, y, false);
}

function togglePopover(): void {
  if (!popover) return;
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  positionPopover();
  popover.show();
  popover.focus();
}

function publish(snapshot: RuntimeSnapshot): void {
  lastState = publicProjection(snapshot);
  popover?.webContents.send("vibecheck:state", lastState);
  tray?.setToolTip(`Vibecheck — ${labelFor(lastState.aggregate)}`);
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
    popover?.webContents.send("vibecheck:state", lastState);
    throw new Error("Camera access is required to enable this feature");
  }
}

function installIpc(): void {
  ipcMain.handle("vibecheck:state", () => lastState);
  ipcMain.handle(
    "vibecheck:set-feature",
    async (_event, name: unknown, enabled: unknown) => {
      if (
        (name !== "notch" && name !== "codex") ||
        typeof enabled !== "boolean"
      ) {
        throw new Error("Invalid feature request");
      }
      await allowCameraIfNeeded(enabled);
      await runtime?.setFeature(name, enabled);
    },
  );
  ipcMain.handle("vibecheck:set-paused", async (_event, paused: unknown) => {
    if (typeof paused !== "boolean") throw new Error("Invalid pause request");
    await runtime?.setPaused(paused);
  });
  ipcMain.handle("vibecheck:recover", async () => {
    await runtime?.recover();
  });
  ipcMain.handle("vibecheck:quit", () => app.quit());
  ipcMain.on("vibecheck:dismiss", () => popover?.hide());
}

async function createPopover(): Promise<void> {
  popover = new BrowserWindow({
    width: 340,
    height: 330,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  popover.setAlwaysOnTop(true, "pop-up-menu");
  popover.on("blur", () => popover?.hide());
  popover.on("closed", () => {
    popover = null;
  });
  popover.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  popover.webContents.on("will-navigate", (event) => event.preventDefault());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await popover.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await popover.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

async function launch(): Promise<void> {
  app.setName("Vibecheck");
  app.dock?.hide();
  Menu.setApplicationMenu(null);
  installIpc();
  await createPopover();
  const image = nativeImage.createFromPath(iconPath());
  image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Vibecheck — Off");
  tray.on("click", togglePopover);
  screen.on("display-metrics-changed", positionPopover);
  screen.on("display-added", positionPopover);
  screen.on("display-removed", positionPopover);
  runtime = new RuntimeClient();
  runtime.on("state", publish);
  runtime.on("terminal-failure", () => {
    lastState = { ...lastState, aggregate: "failed", canRecover: true };
    popover?.webContents.send("vibecheck:state", lastState);
  });
  runtime.on("runtime-error", (error) => console.error(error));
  await runtime.start();
}

app.on("second-instance", () => {
  if (popover) {
    positionPopover();
    popover.show();
  }
});
app.on("window-all-closed", () => {
  // Menu-bar utilities remain alive when their reusable popover is hidden.
});
app.on("before-quit", (event) => {
  if (runtime) {
    event.preventDefault();
    const owned = runtime;
    runtime = null;
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
