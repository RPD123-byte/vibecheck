import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_COMPONENT_FRAME_BYTES,
  type NativeResponse,
  type TapbackAssetMap,
  type TargetApplication,
  validateTapbackAssetMap,
} from "./types";

interface Pending {
  resolve(response: NativeResponse): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export interface CompanionCommand {
  type:
    | "ping"
    | "set_enabled"
    | "permission_status"
    | "list_targets"
    | "relaunch_target"
    | "replace_bundle"
    | "append_bundle"
    | "clipboard_status"
    | "tapback_assets"
    | "open_safari_extension_preferences"
    | "shutdown";
  enabled?: boolean;
  text?: string;
  png_path?: string;
  bundle_path?: string;
  debug_port?: number;
  ownership_marker?: string;
  launch_profile?: "standard" | "managed_codex";
}

export class NativeCompanionClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private buffer = Buffer.alloc(0);
  private stopping = false;

  constructor(private readonly executable = resolveCompanionExecutable()) {
    super();
  }

  get running(): boolean {
    return this.child !== null;
  }

  async start(): Promise<void> {
    if (this.child) return;
    if (!fs.existsSync(this.executable)) {
      throw new Error(`component companion is missing: ${this.executable}`);
    }
    this.stopping = false;
    const child = spawn(this.executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
      env: { ...process.env },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) this.emit("diagnostic", message);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(
        `component companion exited (${code ?? signal ?? "unknown"})`,
      );
      if (!this.stopping) this.emit("exit", code, signal);
    });
    await this.request({ type: "ping" });
  }

  async setEnabled(enabled: boolean): Promise<NativeResponse> {
    return this.request({ type: "set_enabled", enabled });
  }

  async permissionStatus(): Promise<"granted" | "denied"> {
    const response = await this.request({ type: "permission_status" });
    return response.result?.permission ?? "denied";
  }

  async listTargets(): Promise<TargetApplication[]> {
    const response = await this.request({ type: "list_targets" });
    return response.result?.targets ?? [];
  }

  async relaunchTarget(
    bundlePath: string,
    debugPort: number,
    ownershipMarker: string,
    launchProfile: "standard" | "managed_codex" = "standard",
  ): Promise<void> {
    await this.request({
      type: "relaunch_target",
      bundle_path: bundlePath,
      debug_port: debugPort,
      ownership_marker: ownershipMarker,
      launch_profile: launchProfile,
    });
  }

  async appendBundle(text: string, pngPath: string): Promise<number> {
    const response = await this.request({
      type: "append_bundle",
      text,
      png_path: pngPath,
    });
    return response.result?.entry_count ?? 0;
  }

  async replaceBundle(text: string, pngPath: string): Promise<number> {
    const response = await this.request({
      type: "replace_bundle",
      text,
      png_path: pngPath,
    });
    return response.result?.entry_count ?? 0;
  }

  async tapbackAssets(): Promise<TapbackAssetMap> {
    const response = await this.request({ type: "tapback_assets" });
    return validateTapbackAssetMap(response.result?.tapback_assets ?? {});
  }

  async openSafariExtensionPreferences(): Promise<void> {
    await this.request({ type: "open_safari_extension_preferences" });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    try {
      await this.request({ type: "shutdown" }, 2_000);
    } catch {
      child.kill("SIGTERM");
    }
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
          resolve();
        }, 3_000),
      ),
    ]);
  }

  private request(
    command: CompanionCommand,
    timeoutMs = 12_000,
  ): Promise<NativeResponse> {
    const child = this.child;
    if (!child)
      return Promise.reject(new Error("component companion is not running"));
    const id = randomUUID();
    const message = { version: 1, id, ...command };
    const encoded = Buffer.from(`${JSON.stringify(message)}\n`);
    if (encoded.length > MAX_COMPONENT_FRAME_BYTES) {
      return Promise.reject(
        new Error("component companion command exceeds limit"),
      );
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`component companion ${command.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(encoded);
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_COMPONENT_FRAME_BYTES * 2) {
      this.child?.kill("SIGTERM");
      return;
    }
    let newline = this.buffer.indexOf(0x0a);
    while (newline >= 0) {
      const frame = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      try {
        if (frame.length > MAX_COMPONENT_FRAME_BYTES) {
          throw new Error("component companion response exceeds limit");
        }
        const response = JSON.parse(frame.toString("utf8")) as NativeResponse;
        if (
          response.version !== 1 ||
          typeof response.id !== "string" ||
          typeof response.ok !== "boolean"
        ) {
          throw new Error("invalid component companion response");
        }
        const pending = this.pending.get(response.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(response.id);
          if (response.ok) pending.resolve(response);
          else
            pending.reject(
              new Error(
                response.error?.message ?? "component operation failed",
              ),
            );
        }
      } catch (error) {
        this.emit("error", error);
      }
      newline = this.buffer.indexOf(0x0a);
    }
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

export function resolveCompanionExecutable(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "component-reactions",
      "vibecheck-component-companion",
    );
  }
  return path.resolve(
    app.getAppPath(),
    "../../dist/component-reactions/vibecheck-component-companion",
  );
}
