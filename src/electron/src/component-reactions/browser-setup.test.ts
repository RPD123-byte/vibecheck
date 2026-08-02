// @vitest-environment node

import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  showItemInFolder: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
  shell: electron,
}));

import {
  browserExtensionDirectory,
  openChromeExtensionSetup,
} from "./browser-setup";

afterEach(() => {
  vi.restoreAllMocks();
  electron.showItemInFolder.mockReset();
});

describe("browser reaction setup", () => {
  it("opens the fixed production extension and Chrome settings", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const directory = browserExtensionDirectory();
    expect(directory).toMatch(/dist\/component-reactions\/browser-extension$/);
    const openSettings = vi.fn(async () => undefined);
    await openChromeExtensionSetup(openSettings);
    expect(electron.showItemInFolder).toHaveBeenCalledWith(
      `${directory}/manifest.json`,
    );
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("fails safely when the packaged browser asset is missing", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const openSettings = vi.fn(async () => undefined);
    await expect(openChromeExtensionSetup(openSettings)).rejects.toThrow(
      /browser extension is missing/,
    );
    expect(openSettings).not.toHaveBeenCalled();
  });
});
