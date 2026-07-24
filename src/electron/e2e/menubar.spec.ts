import { _electron as electron, expect, test } from "@playwright/test";
import electronPath from "electron";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Action = "notch" | "codex" | "pause" | "recover" | "quit";

interface TestHook {
  state(): {
    aggregate: string;
    features: {
      notch_enabled: boolean;
      integrations: { codex_enabled: boolean };
      paused: boolean;
    };
  };
  menu(): Array<{
    id: string | null;
    label: string | null;
    checked: boolean | null;
    enabled: boolean;
  }>;
  invoke(action: Action, enabled?: boolean): Promise<void>;
  dismissMenu(): void;
  trayImageIsEmpty(): boolean;
}

test("native menu drives the demo runtime without windows or orphans", async () => {
  const projectRoot = path.resolve(__dirname, "../../..");
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibecheck-e2e-"));
  const runtimePrefix = `vibecheck-${process.getuid?.() ?? 0}-`;
  const before = runtimeDirectories(runtimePrefix);
  const appArguments = [
    path.resolve(__dirname, ".."),
    `--user-data-dir=${path.join(testRoot, "user-data")}`,
  ];
  const appEnvironment = {
    ...process.env,
    VIBECHECK_E2E: "1",
    VIBECHECK_RUNTIME_MODE: "demo",
    VIBECHECK_HEADLESS_NOTCH: "1",
    VIBECHECK_PYTHON_OWNER:
      process.env.VIBECHECK_PYTHON_OWNER ??
      path.join(projectRoot, ".venv", "bin", "python"),
    TMPDIR: "/tmp",
  };
  const application = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: appArguments,
    env: appEnvironment,
  });
  try {
    await expect
      .poll(() =>
        application.evaluate(() =>
          Boolean((globalThis as { __vibecheckE2E?: TestHook }).__vibecheckE2E),
        ),
      )
      .toBe(true);
    expect(
      await application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(0);
    expect(
      await application.evaluate(({ app }) => app.dock?.isVisible() ?? false),
    ).toBe(false);
    expect(
      await application.evaluate(() =>
        (
          globalThis as { __vibecheckE2E: TestHook }
        ).__vibecheckE2E.trayImageIsEmpty(),
      ),
    ).toBe(false);
    const packagedTrayIcon = path.resolve(
      __dirname,
      "../out/Vibecheck-darwin-arm64/Vibecheck.app/Contents/Resources/trayTemplate.png",
    );
    expect(fs.existsSync(packagedTrayIcon)).toBe(true);
    expect(
      fs.existsSync(
        path.resolve(
          __dirname,
          "../out/Vibecheck-darwin-arm64/Vibecheck.app/Contents/Resources/trayTemplate@2x.png",
        ),
      ),
    ).toBe(true);
    expect(
      await application.evaluate(
        ({ nativeImage }, assetPath) =>
          nativeImage.createFromPath(assetPath).isEmpty(),
        packagedTrayIcon,
      ),
    ).toBe(false);
    await expect
      .poll(() => state(application).then((value) => value.aggregate))
      .toBe("off");

    const initialMenu = await application.evaluate(() =>
      (globalThis as { __vibecheckE2E: TestHook }).__vibecheckE2E.menu(),
    );
    expect(initialMenu.find((item) => item.id === "status")?.label).toBe(
      "Vibecheck — Off",
    );
    expect(initialMenu.find((item) => item.id === "notch")?.checked).toBe(
      false,
    );

    const duplicate = spawn(electronPath as unknown as string, appArguments, {
      env: appEnvironment,
      stdio: "ignore",
    });
    const [duplicateExit] = await Promise.race([
      once(duplicate, "exit"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("second instance did not exit")),
          5_000,
        ),
      ),
    ]);
    expect(duplicateExit).toBe(0);
    expect(application.process().exitCode).toBeNull();

    await invoke(application, "notch", true);
    await expect
      .poll(() => state(application).then((value) => value.aggregate), {
        timeout: 30_000,
      })
      .toBe("active");
    expect((await state(application)).features.notch_enabled).toBe(true);

    await invoke(application, "codex", true);
    await expect
      .poll(
        () =>
          state(application).then(
            (value) => value.features.integrations.codex_enabled,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    await invoke(application, "pause", true);
    await expect
      .poll(() => state(application).then((value) => value.aggregate))
      .toBe("paused");
    await invoke(application, "pause", false);
    await expect
      .poll(() => state(application).then((value) => value.aggregate), {
        timeout: 30_000,
      })
      .toBe("active");

    await application.evaluate(() =>
      (globalThis as { __vibecheckE2E: TestHook }).__vibecheckE2E.dismissMenu(),
    );
    expect((await state(application)).aggregate).toBe("active");
    expect(
      await application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(0);

    await invoke(application, "quit");
    await application.process().exited;
  } finally {
    if (application.process().exitCode === null) await application.close();
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
  expect(runtimeDirectories(runtimePrefix)).toEqual(before);
});

async function state(
  application: Awaited<ReturnType<typeof electron.launch>>,
): Promise<ReturnType<TestHook["state"]>> {
  return application.evaluate(() =>
    (globalThis as { __vibecheckE2E: TestHook }).__vibecheckE2E.state(),
  );
}

async function invoke(
  application: Awaited<ReturnType<typeof electron.launch>>,
  action: Action,
  enabled?: boolean,
): Promise<void> {
  await application.evaluate(
    (_electron, { action: selected, enabled: value }) =>
      (globalThis as { __vibecheckE2E: TestHook }).__vibecheckE2E.invoke(
        selected,
        value,
      ),
    { action, enabled },
  );
}

function runtimeDirectories(prefix: string): string[] {
  return fs
    .readdirSync("/tmp")
    .filter((entry) => entry.startsWith(prefix))
    .sort();
}
