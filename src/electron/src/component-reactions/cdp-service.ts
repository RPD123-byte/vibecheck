import { EventEmitter } from "node:events";
import { componentRendererSource } from "./renderer-source";
import {
  validateRendererHostEvent,
  type RendererReactionContext,
  type RendererCommit,
  type RendererSessionToggle,
  type TapbackAssetMap,
  type TargetRecord,
} from "./types";

const HOST_BINDING = "__vibecheckComponentCommit";
const CDP_REQUEST_TIMEOUT_MS = 8_000;

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

interface Pending {
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export type CdpCommitContext = RendererReactionContext;

export interface CdpSessionToggleContext {
  target: TargetRecord;
  session: CdpSession;
  event: RendererSessionToggle;
}

export class CdpSession extends EventEmitter {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private openPromise: Promise<void>;

  constructor(
    readonly targetId: string,
    private readonly socket: WebSocket,
  ) {
    super();
    this.openPromise =
      socket.readyState === WebSocket.OPEN
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            socket.addEventListener("open", () => resolve(), { once: true });
            socket.addEventListener(
              "error",
              () => reject(new Error("CDP websocket failed to open")),
              { once: true },
            );
          });
    socket.addEventListener("message", (event) => {
      this.onMessage(String(event.data));
    });
    socket.addEventListener("close", () => {
      this.rejectAll("CDP websocket closed");
      this.emit("close");
    });
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    await this.openPromise;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, CDP_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(serialized: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(serialized) as CdpMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(
          new Error(message.error.message ?? "CDP request failed"),
        );
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) this.emit(message.method, message.params ?? {});
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}

export class CdpService extends EventEmitter {
  private readonly sessions = new Map<string, Map<string, CdpSession>>();
  private readonly documentRefreshes = new WeakMap<CdpSession, Promise<void>>();
  private enabled = false;
  private recents: string[] = [];
  private tapbackAssets: TapbackAssetMap = {};
  private captureSessionId: string | null = null;

  async endpointHealthy(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(600),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async attach(target: TargetRecord): Promise<number> {
    const response = await fetch(
      `http://127.0.0.1:${target.debug_port}/json/list`,
      {
        signal: AbortSignal.timeout(2_000),
      },
    );
    if (!response.ok)
      throw new Error(`debug endpoint returned ${response.status}`);
    const targets = (await response.json()) as CdpTarget[];
    const pages = targets.filter(
      (page) => page.type === "page" && Boolean(page.webSocketDebuggerUrl),
    );
    if (!pages.length) throw new Error("debug endpoint has no usable pages");
    const existing = this.sessions.get(target.bundle_id) ?? new Map();
    this.sessions.set(target.bundle_id, existing);
    for (const page of pages) {
      if (existing.has(page.id)) continue;
      const session = new CdpSession(
        page.id,
        new WebSocket(page.webSocketDebuggerUrl!),
      );
      existing.set(page.id, session);
      session.once("close", () => existing.delete(page.id));
      try {
        await this.install(target, session);
      } catch (error) {
        existing.delete(page.id);
        session.close();
        throw error;
      }
    }
    return existing.size;
  }

  async setEnabled(
    enabled: boolean,
    recents: string[],
    tapbackAssets: TapbackAssetMap = {},
  ): Promise<void> {
    this.enabled = enabled;
    this.recents = recents.slice(0, 5);
    this.tapbackAssets = { ...tapbackAssets };
    await Promise.allSettled(
      [...this.sessions.values()].flatMap((targetSessions) =>
        [...targetSessions.values()].map((session) =>
          this.evaluateController(session, "setEnabled", [
            enabled,
            this.recents,
            this.tapbackAssets,
          ]),
        ),
      ),
    );
  }

  async setCaptureSession(sessionId: string | null): Promise<void> {
    this.captureSessionId = sessionId;
    await Promise.allSettled(
      [...this.sessions.values()].flatMap((targetSessions) =>
        [...targetSessions.values()].map((session) =>
          this.evaluateController(session, "setCaptureSession", [sessionId]),
        ),
      ),
    );
  }

  async settle(
    bundleId: string,
    targetId: string,
    eventId: string,
    outcome: string,
  ): Promise<void> {
    const session = this.sessions.get(bundleId)?.get(targetId);
    if (!session) return;
    await this.evaluateController(session, "settle", [eventId, outcome]);
  }

  async capture(
    session: CdpSession,
    bounds: RendererCommit["bounds"],
  ): Promise<Buffer> {
    const result = await session.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scale: 1,
      },
    });
    if (typeof result.data !== "string") {
      throw new Error("CDP screenshot response is missing PNG data");
    }
    const png = Buffer.from(result.data, "base64");
    if (
      !png.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))
    ) {
      throw new Error("CDP returned an invalid PNG");
    }
    return png;
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(
      [...this.sessions.values()].flatMap((targetSessions) =>
        [...targetSessions.values()].map((session) =>
          this.evaluateController(session, "dispose", []),
        ),
      ),
    );
    for (const targetSessions of this.sessions.values()) {
      for (const session of targetSessions.values()) session.close();
    }
    this.sessions.clear();
  }

  private async install(
    target: TargetRecord,
    session: CdpSession,
  ): Promise<void> {
    await session.call("Runtime.enable");
    await session.call("Page.enable");
    await session.call("Runtime.addBinding", { name: HOST_BINDING });
    const source = componentRendererSource();
    await session.call("Page.addScriptToEvaluateOnNewDocument", { source });
    session.on("Runtime.bindingCalled", (params: Record<string, unknown>) => {
      if (params.name !== HOST_BINDING || typeof params.payload !== "string")
        return;
      try {
        const event = validateRendererHostEvent(JSON.parse(params.payload));
        if (event.type === "toggle_capture_session") {
          this.emit("toggle-capture-session", {
            target,
            session,
            event,
          } satisfies CdpSessionToggleContext);
        } else {
          this.emit("commit", {
            source: target,
            event,
            capture: () => this.capture(session, event.bounds),
            settle: (outcome) =>
              this.settle(
                target.bundle_id,
                session.targetId,
                event.event_id,
                outcome,
              ),
          } satisfies CdpCommitContext);
        }
      } catch (error) {
        this.emit("diagnostic", error);
      }
    });
    session.on("Page.loadEventFired", () => {
      void this.refreshDocument(session, source).catch((error) => {
        this.emit("diagnostic", error);
      });
    });
    await this.refreshDocument(session, source);
  }

  private refreshDocument(session: CdpSession, source: string): Promise<void> {
    const previous = this.documentRefreshes.get(session) ?? Promise.resolve();
    const refresh = previous
      .catch(() => undefined)
      .then(async () => {
        await session.call("Runtime.evaluate", {
          expression: source,
          awaitPromise: false,
          returnByValue: true,
        });
        await this.evaluateController(session, "setEnabled", [
          this.enabled,
          this.recents,
          this.tapbackAssets,
        ]);
        await this.evaluateController(session, "setCaptureSession", [
          this.captureSessionId,
        ]);
      });
    this.documentRefreshes.set(session, refresh);
    return refresh;
  }

  private async evaluateController(
    session: CdpSession,
    method: "setEnabled" | "setCaptureSession" | "settle" | "dispose",
    args: unknown[],
  ): Promise<void> {
    await session.call("Runtime.evaluate", {
      expression: `globalThis.__vibecheckComponentReactions?.${method}(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
    });
  }
}
