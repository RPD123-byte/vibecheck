import { describe, expect, it } from "vitest";
import { resolveOwnerCommand } from "./owner-command";

describe("resolveOwnerCommand", () => {
  it("uses only the bundled owner in a packaged application", () => {
    const command = resolveOwnerCommand({
      packaged: true,
      appPath: "/Applications/Vibecheck.app/Contents/Resources/app.asar",
      resourcesPath: "/Applications/Vibecheck.app/Contents/Resources",
      environment: {
        VIBECHECK_PYTHON_OWNER: "/tmp/attacker",
        VIBECHECK_RUNTIME_MODE: "demo",
      },
    });
    expect(command).toEqual({
      executable:
        "/Applications/Vibecheck.app/Contents/Resources/vibecheck-runtime/vibecheck-runtime",
      args: ["--controller"],
      cwd: "/Applications/Vibecheck.app/Contents/Resources",
    });
  });

  it("allows a main-process development override without arbitrary arguments", () => {
    const command = resolveOwnerCommand({
      packaged: false,
      appPath: "/repo/src/electron",
      resourcesPath: "/unused",
      environment: {
        VIBECHECK_PYTHON_OWNER: "/repo/.venv/bin/python",
        VIBECHECK_RUNTIME_MODE: "demo",
      },
    });
    expect(command.executable).toBe("/repo/.venv/bin/python");
    expect(command.args).toEqual([
      "-m",
      "vibecheck.runtime.cli",
      "--controller",
      "--mode",
      "demo",
    ]);
  });
});
