import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface NativeInputBinding {
  permissionStatus(): "granted" | "denied";
  setEnabled(enabled: boolean): void;
}

export class ComponentPermissionError extends Error {}

export class NativeInputBridge {
  private binding: NativeInputBinding | null = null;

  constructor(private readonly executable?: string) {}

  permissionStatus(): "granted" | "denied" {
    return this.load().permissionStatus();
  }

  setEnabled(enabled: boolean): void {
    if (!enabled && !this.binding) return;
    try {
      this.load().setEnabled(enabled);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Component permission failed";
      if (
        message.includes("Accessibility") ||
        message.includes("Input Monitoring")
      ) {
        throw new ComponentPermissionError(message);
      }
      throw error;
    }
  }

  private load(): NativeInputBinding {
    if (this.binding) return this.binding;
    const executable = this.executable ?? resolveInputBridge();
    if (!fs.existsSync(executable)) {
      throw new Error(`component input bridge is missing: ${executable}`);
    }
    const nativeModule = { exports: {} } as NodeModule;
    process.dlopen(nativeModule, executable);
    this.binding = nativeModule.exports as NativeInputBinding;
    return this.binding;
  }
}

export function resolveInputBridge(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "component-reactions",
      "vibecheck-component-input.node",
    );
  }
  return path.resolve(
    app.getAppPath(),
    "../../dist/component-reactions/vibecheck-component-input.node",
  );
}
