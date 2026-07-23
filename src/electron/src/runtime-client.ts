import { app } from "electron";
import { EventEmitter } from "node:events";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import {
  Bootstrap,
  ControlEnvelope,
  Features,
  isBootstrap,
  isControlEnvelope,
  MAX_CONTROL_BYTES,
  PROTOCOL_VERSION,
  RuntimeSnapshot,
} from "./protocol";
import { FeaturePreferences, Preferences } from "./preferences";
import { OwnerCommand, resolveOwnerCommand } from "./owner-command";

const BOOTSTRAP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface Pending {
  resolve: (message: ControlEnvelope) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PreferenceStore {
  read(): FeaturePreferences;
  write(value: FeaturePreferences): void;
}

export class RuntimeClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private socket: net.Socket | null = null;
  private bootstrap: Bootstrap | null = null;
  private snapshot: RuntimeSnapshot | null = null;
  private socketBuffer = Buffer.alloc(0);
  private pending = new Map<string, Pending>();
  private quitting = false;
  private restartTimes: number[] = [];
  private reconnecting = false;

  constructor(
    private readonly preferences: PreferenceStore = new Preferences(),
    private readonly commandFactory?: () => OwnerCommand,
  ) {
    super();
  }

  get state(): RuntimeSnapshot | null {
    return this.snapshot;
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.quitting = false;
    const { executable, args, cwd } = this.ownerCommand();
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
    });
    child.stdin.end();
    this.child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) console.error(`[vibecheck-runtime] ${text}`);
    });
    child.once("exit", (code, signal) => {
      this.onOwnerExit(code, signal);
    });
    try {
      const bootstrap = await this.readBootstrap(child);
      child.stdout.resume();
      this.bootstrap = bootstrap;
      await this.connect(bootstrap);
      await this.reapplyPreferences();
    } catch (error) {
      await this.terminateOwnedChild();
      throw error;
    }
  }

  async setFeature(
    name: "notch" | "codex",
    enabled: boolean,
  ): Promise<RuntimeSnapshot> {
    const current = this.requireState();
    const features: Omit<Features, "revision"> = {
      notch_enabled:
        name === "notch" ? enabled : current.features.notch_enabled,
      integrations: {
        codex_enabled:
          name === "codex"
            ? enabled
            : current.features.integrations.codex_enabled,
      },
      paused: current.features.paused,
    };
    const state = await this.setFeatures(features);
    this.preferences.write({
      notch_enabled: state.features.notch_enabled,
      codex_enabled: state.features.integrations.codex_enabled,
    });
    return state;
  }

  async setPaused(paused: boolean): Promise<RuntimeSnapshot> {
    const current = this.requireState();
    return this.setFeatures({
      notch_enabled: current.features.notch_enabled,
      integrations: {
        codex_enabled: current.features.integrations.codex_enabled,
      },
      paused,
    });
  }

  async recover(): Promise<RuntimeSnapshot> {
    const state = this.requireState();
    const roles = Object.entries(state.workers)
      .filter(
        ([, worker]) =>
          worker.lifecycle === "failed" || worker.lifecycle === "exited",
      )
      .map(([role]) => role);
    if (roles.length === 0) return state;
    return (await this.request("restart_failed_roles", { roles })).state;
  }

  async shutdown(): Promise<void> {
    this.quitting = true;
    if (this.socket && this.snapshot) {
      try {
        await this.request("shutdown", {});
      } catch {
        // The owned process is still bounded and escalated below.
      }
    }
    await this.waitForExitOrTerminate();
    this.closeSocket();
  }

  private async setFeatures(
    features: Omit<Features, "revision">,
  ): Promise<RuntimeSnapshot> {
    const current = this.requireState();
    return (
      await this.request("set_features", {
        expected_revision: current.features.revision,
        features,
      })
    ).state;
  }

  private ownerCommand(): {
    executable: string;
    args: string[];
    cwd: string;
  } {
    if (this.commandFactory) return this.commandFactory();
    return resolveOwnerCommand({
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      environment: process.env,
    });
  }

  private readBootstrap(
    child: ChildProcessWithoutNullStreams,
  ): Promise<Bootstrap> {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("runtime bootstrap timed out"));
      }, BOOTSTRAP_TIMEOUT_MS);
      const cleanup = (): void => {
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        child.off("exit", onExit);
      };
      const onExit = (): void => {
        cleanup();
        reject(new Error("runtime exited before bootstrap"));
      };
      const onData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_CONTROL_BYTES) {
          cleanup();
          reject(new Error("runtime bootstrap exceeded the frame limit"));
          return;
        }
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) return;
        try {
          const parsed = JSON.parse(
            buffer.subarray(0, newline).toString("utf8"),
          );
          if (!isBootstrap(parsed)) {
            throw new Error("runtime returned an invalid bootstrap record");
          }
          cleanup();
          resolve(parsed);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      child.stdout.on("data", onData);
      child.once("exit", onExit);
    });
  }

  private connect(bootstrap: Bootstrap): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(bootstrap.control_socket);
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("runtime control connection timed out"));
      }, REQUEST_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timeout);
        socket.on("data", (chunk) => this.onSocketData(chunk));
        socket.on("close", () => {
          if (this.socket !== socket) return;
          this.socket = null;
          this.rejectPending("runtime connection closed");
          if (!this.quitting) void this.reconnect();
        });
        socket.on("error", (error) => {
          if (!this.quitting) this.emit("runtime-error", error);
        });
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private onSocketData(chunk: Buffer): void {
    this.socketBuffer = Buffer.concat([this.socketBuffer, chunk]);
    if (this.socketBuffer.length > MAX_CONTROL_BYTES * 2) {
      this.closeSocket();
      this.emit("runtime-error", new Error("control input exceeded bounds"));
      return;
    }
    let newline = this.socketBuffer.indexOf(0x0a);
    while (newline >= 0) {
      const frame = this.socketBuffer.subarray(0, newline);
      this.socketBuffer = this.socketBuffer.subarray(newline + 1);
      if (frame.length > MAX_CONTROL_BYTES) {
        this.closeSocket();
        return;
      }
      try {
        const parsed = JSON.parse(frame.toString("utf8"));
        if (
          !isControlEnvelope(parsed) ||
          parsed.runtime_id !== this.bootstrap?.runtime_id
        ) {
          throw new Error("invalid runtime control message");
        }
        const pending = parsed.id ? this.pending.get(parsed.id) : undefined;
        if (
          this.snapshot &&
          parsed.state.features.revision < this.snapshot.features.revision
        ) {
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(parsed.id!);
            pending.reject(
              new Error("runtime returned a stale state revision"),
            );
          }
          newline = this.socketBuffer.indexOf(0x0a);
          continue;
        }
        this.snapshot = parsed.state;
        this.emit("state", parsed.state);
        if (parsed.id) {
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(parsed.id);
            if (parsed.type === "error") {
              pending.reject(
                new Error(parsed.error?.message ?? "runtime request failed"),
              );
            } else {
              pending.resolve(parsed);
            }
          }
        }
      } catch (error) {
        this.emit("runtime-error", error);
      }
      newline = this.socketBuffer.indexOf(0x0a);
    }
  }

  private request(
    type: "get_state" | "set_features" | "restart_failed_roles" | "shutdown",
    fields: Record<string, unknown>,
  ): Promise<ControlEnvelope> {
    const socket = this.socket;
    const bootstrap = this.bootstrap;
    if (!socket || !bootstrap) {
      return Promise.reject(new Error("runtime is not connected"));
    }
    const id = randomUUID();
    const message = {
      version: PROTOCOL_VERSION,
      id,
      token: bootstrap.controller_token,
      type,
      ...fields,
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`runtime request ${type} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      socket.write(`${JSON.stringify(message)}\n`);
    });
  }

  private async reapplyPreferences(): Promise<void> {
    await this.request("get_state", {});
    const preferred = this.preferences.read();
    if (!preferred.notch_enabled && !preferred.codex_enabled) return;
    await this.setFeatures({
      notch_enabled: preferred.notch_enabled,
      integrations: { codex_enabled: preferred.codex_enabled },
      paused: false,
    });
  }

  private requireState(): RuntimeSnapshot {
    if (!this.snapshot) throw new Error("runtime state is unavailable");
    return this.snapshot;
  }

  private onOwnerExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.child = null;
    this.closeSocket();
    if (this.quitting) return;
    this.emit(
      "runtime-error",
      new Error(`runtime owner exited (${code ?? signal ?? "unknown"})`),
    );
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((time) => now - time < 60_000);
    if (this.restartTimes.length >= 3) {
      this.emit("terminal-failure");
      return;
    }
    this.restartTimes.push(now);
    setTimeout(
      () =>
        void this.start().catch((error) => this.emit("runtime-error", error)),
      250 * 2 ** (this.restartTimes.length - 1),
    );
  }

  private closeSocket(): void {
    this.socket?.removeAllListeners("close");
    this.socket?.destroy();
    this.socket = null;
    this.socketBuffer = Buffer.alloc(0);
    this.rejectPending("runtime connection closed");
  }

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  private async reconnect(): Promise<void> {
    const bootstrap = this.bootstrap;
    if (this.reconnecting || !bootstrap || this.quitting || !this.child) return;
    this.reconnecting = true;
    try {
      for (const delay of [100, 200, 400, 800, 1_000, 1_000]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.quitting || !this.child) return;
        try {
          await this.connect(bootstrap);
          await this.request("get_state", {});
          this.emit("reconnected");
          return;
        } catch {
          this.closeSocket();
        }
      }
      this.emit("disconnected");
    } finally {
      this.reconnecting = false;
    }
  }

  private async waitForExitOrTerminate(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    const deadline = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 5_000),
    );
    if ((await Promise.race([exited, deadline])) === "timeout") {
      await this.terminateOwnedChild();
    }
  }

  private async terminateOwnedChild(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.kill("SIGTERM");
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    const deadline = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 3_000),
    );
    if ((await Promise.race([exited, deadline])) === "timeout") {
      child.kill("SIGKILL");
    }
  }
}

export function preferencesFromState(
  state: RuntimeSnapshot,
): FeaturePreferences {
  return {
    notch_enabled: state.features.notch_enabled,
    codex_enabled: state.features.integrations.codex_enabled,
  };
}
