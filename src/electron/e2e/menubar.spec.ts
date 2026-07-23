import { _electron as electron, expect, test } from "@playwright/test";
import electronPath from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("real demo runtime follows menu intent and quits without orphans", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibecheck-e2e-"));
  const runtimePrefix = `vibecheck-${process.getuid?.() ?? 0}-`;
  const before = runtimeDirectories(runtimePrefix);
  const application = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [
      path.resolve(__dirname, ".."),
      `--user-data-dir=${path.join(testRoot, "user-data")}`,
    ],
    env: {
      ...process.env,
      VIBECHECK_RUNTIME_MODE: "demo",
      VIBECHECK_HEADLESS_NOTCH: "1",
      VIBECHECK_PYTHON_OWNER: path.join(projectRoot, ".venv", "bin", "python"),
      TMPDIR: "/tmp",
    },
  });
  try {
    const window = await application.firstWindow();
    await expect(window.getByText("Off", { exact: true })).toBeVisible();
    expect(
      await application.evaluate(({ app }) => app.dock?.isVisible() ?? false),
    ).toBe(false);
    expect(
      await window.evaluate(
        () =>
          typeof (globalThis as { require?: unknown }).require === "undefined",
      ),
    ).toBe(true);

    await window.getByLabel("Show notch").click();
    await expect(window.getByText("Active", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await window.getByLabel("Codex interruption").click();
    await expect(window.getByLabel("Codex interruption")).toBeChecked();
    await window.getByRole("button", { name: "Pause" }).click();
    await expect(window.getByText("Paused", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Resume" }).click();
    await expect(window.getByText("Active", { exact: true })).toBeVisible();

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.hide();
    });
    expect(
      await application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible() ?? true,
      ),
    ).toBe(false);
    expect(application.process().exitCode).toBeNull();

    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show();
    });
    await window.getByRole("button", { name: "Quit" }).click();
    await application.process().exited;
  } finally {
    if (application.process().exitCode === null) await application.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  expect(runtimeDirectories(runtimePrefix)).toEqual(before);
});

function runtimeDirectories(prefix: string): string[] {
  return fs
    .readdirSync("/tmp")
    .filter((entry) => entry.startsWith(prefix))
    .sort();
}
