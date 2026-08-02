import { app, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function browserExtensionDirectory(): string {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "component-reactions",
        "browser-extension",
      )
    : path.resolve(
        app.getAppPath(),
        "../../dist/component-reactions/browser-extension",
      );
}

export async function openChromeExtensionSetup(
  openSettings: () => Promise<void> = openChromeSettings,
): Promise<void> {
  const directory = browserExtensionDirectory();
  const manifest = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifest)) {
    throw new Error(`browser extension is missing: ${manifest}`);
  }
  shell.showItemInFolder(manifest);
  await openSettings();
}

function openChromeSettings(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/open",
      ["-a", "Google Chrome", "chrome://extensions"],
      (error) => (error ? reject(error) : resolve()),
    );
  });
}
