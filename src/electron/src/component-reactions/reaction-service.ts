import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  type ComponentReactionRuntimeState,
  type RuntimeSnapshot,
} from "../protocol";
import { Preferences } from "../preferences";
import { CdpService } from "./cdp-service";
import { BrowserReactionHost, type BrowserHostHealth } from "./browser-host";
import { openChromeExtensionSetup } from "./browser-setup";
import { NativeCompanionClient } from "./native-companion";
import { ComponentPermissionError, NativeInputBridge } from "./native-input";
import { TargetRegistry } from "./target-registry";
import {
  MAX_COMPONENT_FRAME_BYTES,
  MAX_SCREENSHOT_BYTES,
  type ExplicitReactionEvent,
  isReactionOutcome,
  type ReactionResult,
  type RendererReactionContext,
  type TapbackAssetMap,
  type TargetRecord,
} from "./types";

const DISCOVERY_INTERVAL_MS = 2_000;
const ENDPOINT_STARTUP_DEADLINE_MS = 12_000;
const CODEX_BUNDLE_IDS = new Set(["com.openai.codex", "com.openai.chat"]);

export class ComponentReactionService extends EventEmitter {
  private readonly transientFiles = new Set<string>();
  private commitQueue: Promise<void> = Promise.resolve();
  private discoveryTimer: NodeJS.Timeout | null = null;
  private runtime: RuntimeSnapshot | null = null;
  private desired = false;
  private effective = false;
  private syncing = false;
  private resyncRequested = false;
  private ownershipPromise: Promise<void> | null = null;
  private codexLifecycleOwned = false;
  private shuttingDown = false;
  private captureSessionId: string | null = null;
  private captureSessionHasCommitted = false;
  private tapbackAssets: TapbackAssetMap = {};
  private tapbackAssetsLoaded = false;
  private health: ComponentReactionRuntimeState = {
    desired: false,
    effective: false,
    health: "off",
    reaction_socket: null,
    attached_targets: 0,
    unavailable_targets: 0,
    permission: "unknown",
    companion_ready: false,
    clipboard_ready: false,
    last_error: null,
    browser_transport: "off",
    attached_browser_tabs: 0,
    browser_last_error: null,
  };

  constructor(
    private readonly preferences: Preferences,
    private readonly companion = new NativeCompanionClient(),
    private readonly cdp = new CdpService(),
    private readonly registry = new TargetRegistry(),
    private readonly input = new NativeInputBridge(),
    private readonly browser: BrowserReactionHost | null = null,
    private readonly desktopOwnershipEnabled = true,
  ) {
    super();
    this.cdp.on("commit", (context: RendererReactionContext) => {
      this.commitQueue = this.commitQueue
        .then(() => this.handleCommit(context))
        .catch((error) => {
          this.emit("diagnostic", error);
        });
    });
    this.cdp.on("toggle-capture-session", () => {
      this.commitQueue = this.commitQueue
        .then(() => this.toggleCaptureSession())
        .catch((error) => {
          this.emit("diagnostic", error);
        });
    });
    this.cdp.on("diagnostic", (error) => this.emit("diagnostic", error));
    if (this.browser) {
      this.browser.on("commit", (context: RendererReactionContext) => {
        this.commitQueue = this.commitQueue
          .then(() => this.handleCommit(context))
          .catch((error) => {
            this.emit("diagnostic", error);
          });
      });
      this.browser.on("toggle-capture-session", () => {
        this.commitQueue = this.commitQueue
          .then(() => this.toggleCaptureSession())
          .catch((error) => {
            this.emit("diagnostic", error);
          });
      });
      this.browser.on("state", (state: BrowserHostHealth) => {
        this.health.browser_transport = state.transport;
        this.health.attached_browser_tabs = state.attached_tabs;
        this.health.browser_last_error = state.last_error;
        this.recomputeHealth();
      });
      this.browser.on("diagnostic", (error) => this.emit("diagnostic", error));
    }
    this.companion.on("diagnostic", (message) =>
      this.emit("diagnostic", message),
    );
    this.companion.on("error", (error) => this.emit("diagnostic", error));
    this.companion.on("exit", () => {
      this.tapbackAssets = {};
      this.tapbackAssetsLoaded = false;
      this.health.companion_ready = false;
      this.degrade("Component companion exited");
    });
  }

  get state(): ComponentReactionRuntimeState {
    return { ...this.health };
  }

  startOwnership(codexLifecycleRequired = false): Promise<void> {
    if (!this.desktopOwnershipEnabled) return Promise.resolve();
    this.codexLifecycleOwned ||= codexLifecycleRequired;
    if (this.ownershipPromise) return this.ownershipPromise;
    this.startDiscovery();
    const attempt = (async () => {
      if (this.browser) {
        try {
          await this.browser.start();
        } catch {
          // Browser availability is additive; desktop ownership still starts.
        }
      }
      await this.ensureCompanion();
      await this.cdp.setEnabled(
        false,
        this.preferences.read().emoji_recents,
        this.tapbackAssets,
      );
      await this.cdp.setCaptureSession(null);
      await this.browser?.setEnabled(
        false,
        this.preferences.read().emoji_recents,
        this.tapbackAssets,
      );
      await this.browser?.setCaptureSession(null);
      await this.discover();
    })().catch((error) => {
      this.degrade(
        error instanceof Error
          ? error.message
          : "Component ownership could not start",
      );
      throw error;
    });
    this.ownershipPromise = attempt;
    void attempt.catch(() => {
      if (this.ownershipPromise === attempt) this.ownershipPromise = null;
    });
    return attempt;
  }

  async sync(snapshot: RuntimeSnapshot): Promise<void> {
    this.runtime = snapshot;
    this.desired = snapshot.features.component_reactions_enabled;
    this.effective = this.desired && !snapshot.features.paused;
    this.codexLifecycleOwned ||=
      snapshot.features.integrations.codex_enabled || this.desired;
    this.health.desired = this.desired;
    this.health.reaction_socket =
      this.effective && snapshot.component_reactions?.reaction_socket
        ? snapshot.component_reactions.reaction_socket
        : null;
    if (!this.desktopOwnershipEnabled) {
      this.health.health = this.desired ? "starting" : "off";
      this.health.effective = false;
      this.publish();
      return;
    }
    if (this.syncing) {
      this.resyncRequested = true;
      return;
    }
    this.syncing = true;
    try {
      await this.startOwnership(this.codexLifecycleOwned);
      if (!this.desired) {
        this.health.health = "off";
        this.health.effective = false;
        this.input.setEnabled(false);
        await this.endCaptureSession();
        await this.cdp.setEnabled(
          false,
          this.preferences.read().emoji_recents,
          this.tapbackAssets,
        );
        await this.browser?.setEnabled(
          false,
          this.preferences.read().emoji_recents,
          this.tapbackAssets,
        );
        await this.discover();
        this.publish();
        return;
      }
      if (!this.effective) {
        this.input.setEnabled(false);
        await this.endCaptureSession();
        await this.cdp.setEnabled(
          false,
          this.preferences.read().emoji_recents,
          this.tapbackAssets,
        );
        await this.browser?.setEnabled(
          false,
          this.preferences.read().emoji_recents,
          this.tapbackAssets,
        );
        this.health.health = "paused";
        this.health.effective = false;
        this.startDiscovery();
        this.publish();
        return;
      }
      this.health.health = "starting";
      this.publish();
      const permission = this.input.permissionStatus();
      this.health.permission = permission;
      try {
        this.input.setEnabled(true);
      } catch (error) {
        this.health.health =
          error instanceof ComponentPermissionError
            ? "needs_permission"
            : "failed";
        this.health.effective = false;
        this.health.last_error =
          error instanceof Error ? error.message : "Permission is required";
        this.publish();
        return;
      }
      this.health.clipboard_ready = true;
      await this.cdp.setEnabled(
        true,
        this.preferences.read().emoji_recents,
        this.tapbackAssets,
      );
      await this.browser?.setEnabled(
        true,
        this.preferences.read().emoji_recents,
        this.tapbackAssets,
      );
      await this.cdp.setCaptureSession(this.captureSessionId);
      await this.browser?.setCaptureSession(this.captureSessionId);
      this.startDiscovery();
      await this.discover();
      this.recomputeHealth();
    } finally {
      this.syncing = false;
      if (this.resyncRequested && this.runtime) {
        this.resyncRequested = false;
        void this.sync(this.runtime);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = null;
    this.input.setEnabled(false);
    await this.endCaptureSession();
    await this.cdp.setEnabled(false, [], this.tapbackAssets);
    await this.commitQueue;
    await this.cdp.dispose();
    await this.browser?.dispose();
    await this.companion.stop();
    for (const file of this.transientFiles) {
      try {
        fs.unlinkSync(file);
      } catch {
        // The Rust result path may already have cleaned it.
      }
    }
    this.transientFiles.clear();
  }

  async openChromeSetup(): Promise<void> {
    try {
      await openChromeExtensionSetup();
    } catch (error) {
      this.health.browser_last_error =
        error instanceof Error ? error.message : "Chrome setup failed";
      this.publish();
      throw error;
    }
  }

  async openSafariSetup(): Promise<void> {
    try {
      await this.ensureCompanion();
      await this.companion.openSafariExtensionPreferences();
    } catch (error) {
      this.health.browser_last_error =
        error instanceof Error ? error.message : "Safari setup failed";
      this.publish();
      throw error;
    }
  }

  private async ensureCompanion(): Promise<void> {
    if (!this.companion.running) {
      await this.companion.start();
      this.tapbackAssets = {};
      this.tapbackAssetsLoaded = false;
    }
    if (!this.tapbackAssetsLoaded) {
      try {
        this.tapbackAssets = await this.companion.tapbackAssets();
      } catch (error) {
        this.tapbackAssets = {};
        this.emit("diagnostic", error);
      }
      this.tapbackAssetsLoaded = true;
    }
    this.health.companion_ready = true;
  }

  private startDiscovery(): void {
    if (this.discoveryTimer) return;
    this.discoveryTimer = setInterval(
      () => void this.discover(),
      DISCOVERY_INTERVAL_MS,
    );
  }

  private async discover(): Promise<void> {
    if (this.shuttingDown) return;
    if (!this.companion.running) {
      try {
        await this.ensureCompanion();
      } catch (error) {
        this.degrade(
          error instanceof Error ? error.message : "Target discovery failed",
        );
        return;
      }
    }
    let targets;
    try {
      targets = await this.companion.listTargets();
    } catch (error) {
      this.degrade(
        error instanceof Error ? error.message : "Target discovery failed",
      );
      return;
    }
    this.registry.prepare(targets);
    for (const target of targets) {
      const record = this.registry.observe(target);
      if (!record.enrolled) this.registry.enroll(record.bundle_id);
      if (
        CODEX_BUNDLE_IDS.has(record.bundle_id) &&
        !this.codexLifecycleOwned &&
        !record.attached
      ) {
        this.registry.mark(
          record.bundle_id,
          "deferred",
          "ChatGPT attachment is deferred until its coordinated lifecycle is required",
        );
        continue;
      }
      if (
        record.enrolled &&
        record.status !== "relaunching" &&
        record.status !== "attaching"
      ) {
        void this.ensureAttached(record);
      }
    }
    this.registry.reconcileRunning(
      new Set(targets.map((target) => target.bundle_id)),
    );
    this.recomputeHealth();
  }

  private async ensureAttached(record: TargetRecord): Promise<void> {
    if (await this.cdp.endpointHealthy(record.debug_port)) {
      if (record.status === "discovered") {
        this.registry.mark(
          record.bundle_id,
          "unavailable",
          "allocated debug port is already owned by another process",
        );
        this.recomputeHealth();
        return;
      }
      try {
        this.registry.mark(record.bundle_id, "attaching");
        await this.cdp.attach(record);
        this.registry.mark(record.bundle_id, "attached");
      } catch (error) {
        this.registry.mark(
          record.bundle_id,
          "unavailable",
          error instanceof Error ? error.message : "CDP attachment failed",
        );
      }
      this.recomputeHealth();
      return;
    }
    this.registry.mark(record.bundle_id, "relaunching");
    try {
      await this.companion.relaunchTarget(
        record.bundle_path,
        record.debug_port,
        record.ownership_marker,
        CODEX_BUNDLE_IDS.has(record.bundle_id) ? "managed_codex" : "standard",
      );
      const deadline = Date.now() + ENDPOINT_STARTUP_DEADLINE_MS;
      while (Date.now() < deadline) {
        if (await this.cdp.endpointHealthy(record.debug_port)) {
          this.registry.mark(record.bundle_id, "attaching");
          await this.cdp.attach(record);
          this.registry.mark(record.bundle_id, "attached");
          this.recomputeHealth();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error("debug endpoint did not become ready");
    } catch (error) {
      this.registry.mark(
        record.bundle_id,
        "unavailable",
        error instanceof Error ? error.message : "Target relaunch failed",
      );
      this.recomputeHealth();
    }
  }

  private async handleCommit(context: RendererReactionContext): Promise<void> {
    const { source, event } = context;
    if (!this.effective) return;
    if (
      event.clipboard_session_id !== null &&
      event.clipboard_session_id !== this.captureSessionId
    ) {
      return;
    }
    if (event.clipboard_session_id === null && this.captureSessionId !== null) {
      await this.endCaptureSession();
    }
    const replaceBundle =
      event.clipboard_session_id === null || !this.captureSessionHasCommitted;
    let outcome: ReactionResult["outcome"] = "copy_failed";
    let screenshotPath: string | null = null;
    let copied = false;
    try {
      const png = await context.capture();
      if (png.length === 0 || png.length > MAX_SCREENSHOT_BYTES) {
        throw new Error("component screenshot is outside allowed bounds");
      }
      const reactionSocket = this.health.reaction_socket;
      const runtimeDirectory = reactionSocket
        ? path.dirname(reactionSocket)
        : this.runtime?.component_reactions?.reaction_socket
          ? path.dirname(this.runtime.component_reactions.reaction_socket)
          : null;
      if (!runtimeDirectory) {
        throw new Error("component runtime directory is unavailable");
      }
      screenshotPath = path.join(runtimeDirectory, `${event.event_id}.png`);
      fs.writeFileSync(screenshotPath, png, {
        flag: "wx",
        mode: 0o600,
      });
      this.transientFiles.add(screenshotPath);
      if (replaceBundle) {
        await this.companion.replaceBundle(event.copy_text, screenshotPath);
      } else {
        await this.companion.appendBundle(event.copy_text, screenshotPath);
      }
      copied = true;
      if (
        event.clipboard_session_id !== null &&
        event.clipboard_session_id === this.captureSessionId
      ) {
        this.captureSessionHasCommitted = true;
      }
      this.health.clipboard_ready = true;
      this.recordRecent(event.reaction_emoji);
      if (!reactionSocket) {
        outcome = "unavailable";
      } else {
        const explicit: ExplicitReactionEvent = {
          schema_version: 1,
          event_id: event.event_id,
          captured_at_ms: Date.now(),
          source_application_name: source.name,
          source_bundle_id: source.bundle_id,
          reaction_emoji: event.reaction_emoji,
          reaction_label: event.reaction_label,
          copy_text: event.copy_text,
          screenshot_path: screenshotPath,
        };
        const result = await sendReaction(reactionSocket, explicit);
        outcome = result.outcome;
      }
    } catch (error) {
      if (copied) outcome = "unavailable";
      this.health.last_error =
        error instanceof Error ? error.message : "Component reaction failed";
    } finally {
      await context.settle(outcome);
      const codexMayStillReadScreenshot =
        outcome === "sent" || outcome === "sent_outcome_unknown";
      if (screenshotPath && !codexMayStillReadScreenshot) {
        try {
          fs.unlinkSync(screenshotPath);
        } catch {
          // Shutdown cleanup retains ownership if immediate deletion fails.
        }
        this.transientFiles.delete(screenshotPath);
      }
      this.publish();
    }
  }

  private async toggleCaptureSession(): Promise<void> {
    if (!this.effective) return;
    if (this.captureSessionId !== null) {
      await this.endCaptureSession();
      return;
    }
    this.captureSessionId = randomUUID();
    this.captureSessionHasCommitted = false;
    await this.cdp.setCaptureSession(this.captureSessionId);
    await this.browser?.setCaptureSession(this.captureSessionId);
  }

  private async endCaptureSession(): Promise<void> {
    if (this.captureSessionId === null && !this.captureSessionHasCommitted) {
      return;
    }
    this.captureSessionId = null;
    this.captureSessionHasCommitted = false;
    await this.cdp.setCaptureSession(null);
    await this.browser?.setCaptureSession(null);
  }

  private recordRecent(emoji: string): void {
    const current = this.preferences.read();
    const emoji_recents = [
      emoji,
      ...current.emoji_recents.filter((value) => value !== emoji),
    ].slice(0, 5);
    this.preferences.write({ ...current, emoji_recents });
    void this.cdp.setEnabled(this.effective, emoji_recents, this.tapbackAssets);
    void this.browser?.setEnabled(
      this.effective,
      emoji_recents,
      this.tapbackAssets,
    );
  }

  private recomputeHealth(): void {
    const records = this.registry.enrolled();
    const attached = records.filter((record) => record.attached).length;
    const unavailable = records.filter(
      (record) => record.status === "unavailable",
    ).length;
    const browserTabs = this.health.attached_browser_tabs ?? 0;
    const browserDegraded = this.health.browser_transport === "degraded";
    this.health.attached_targets = attached;
    this.health.unavailable_targets = unavailable;
    this.health.effective =
      this.effective &&
      this.health.companion_ready &&
      this.health.clipboard_ready &&
      (attached > 0 || browserTabs > 0);
    this.health.health = !this.desired
      ? "off"
      : !this.effective
        ? "paused"
        : this.health.permission === "denied"
          ? "needs_permission"
          : attached > 0 || browserTabs > 0
            ? unavailable > 0 || browserDegraded
              ? "degraded"
              : "active"
            : unavailable > 0 || browserDegraded
              ? "degraded"
              : "starting";
    this.publish();
  }

  private degrade(message: string): void {
    void this.endCaptureSession();
    this.health.health = "degraded";
    this.health.effective = false;
    this.health.last_error = message;
    this.publish();
  }

  private publish(): void {
    this.emit("state", this.state);
  }
}

async function sendReaction(
  socketPath: string,
  event: ExplicitReactionEvent,
): Promise<ReactionResult> {
  const encoded = Buffer.from(`${JSON.stringify(event)}\n`);
  if (encoded.length > MAX_COMPONENT_FRAME_BYTES) {
    throw new Error("reaction event exceeds the protocol limit");
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("reaction delivery timed out"));
    }, 15_000);
    const cleanup = (): void => clearTimeout(timeout);
    socket.once("connect", () => socket.write(encoded));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_COMPONENT_FRAME_BYTES) {
        cleanup();
        socket.destroy();
        reject(new Error("reaction result exceeds the protocol limit"));
        return;
      }
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) return;
      try {
        const result = JSON.parse(
          buffer.subarray(0, newline).toString("utf8"),
        ) as ReactionResult;
        if (
          result.schema_version !== 1 ||
          result.event_id !== event.event_id ||
          !isReactionOutcome(result.outcome)
        ) {
          throw new Error("reaction result is invalid");
        }
        cleanup();
        socket.end();
        resolve(result);
      } catch (error) {
        cleanup();
        socket.destroy();
        reject(error);
      }
    });
    socket.once("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}
