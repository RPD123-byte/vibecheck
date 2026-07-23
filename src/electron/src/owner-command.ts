import path from "node:path";

export interface OwnerCommandInput {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  environment: NodeJS.ProcessEnv;
}

export interface OwnerCommand {
  executable: string;
  args: string[];
  cwd: string;
}

export function resolveOwnerCommand(input: OwnerCommandInput): OwnerCommand {
  if (input.packaged) {
    return {
      executable: path.join(
        input.resourcesPath,
        "vibecheck-runtime",
        "vibecheck-runtime",
      ),
      args: ["--controller"],
      cwd: input.resourcesPath,
    };
  }
  const projectRoot = path.resolve(input.appPath, "../..");
  const args = [
    "-m",
    "vibecheck.runtime.cli",
    "--controller",
    "--mode",
    input.environment.VIBECHECK_RUNTIME_MODE ?? "normal",
  ];
  if (input.environment.VIBECHECK_HEADLESS_NOTCH === "1") {
    args.push("--headless-notch");
  }
  return {
    executable:
      input.environment.VIBECHECK_PYTHON_OWNER ??
      path.join(projectRoot, ".venv", "bin", "python"),
    args,
    cwd: projectRoot,
  };
}
