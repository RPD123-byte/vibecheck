import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import http from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  BROWSER_HOST,
  BROWSER_HOST_PORT,
  BROWSER_PROTOCOL_VERSION,
  MAX_BROWSER_FRAME_BYTES,
  browserProof,
  extensionOriginAllowed,
  validateBrowserClientMessage,
  verifyBrowserProof,
  type BrowserCommit,
  type BrowserDocument,
  type BrowserFamily,
  type BrowserHello,
  type BrowserHostMessage,
  type BrowserStateSnapshot,
} from "./browser-protocol";
import { cropBrowserScreenshot } from "./browser-image";
import {
  type ReactionSource,
  type RendererReactionContext,
  type TapbackAssetMap,
} from "./types";

const SOCKET_PATH = "/component-reactions/v1";
const AUTHENTICATION_TIMEOUT_MS = 5_000;
const MAX_SEEN_EVENTS = 4_096;

export type BrowserTransportState =
  "off" | "listening" | "connected" | "degraded";

export interface BrowserHostHealth {
  transport: BrowserTransportState;
  attached_tabs: number;
  last_error: string | null;
}

export interface BrowserHostOptions {
  port?: number;
  crop?: typeof cropBrowserScreenshot;
}

interface BrowserClient {
  socket: WebSocket;
  origin: string;
  nonce: string;
  authenticated: boolean;
  synchronized: boolean;
  browser: BrowserFamily | null;
  profileId: string | null;
  documents: Map<string, BrowserDocument>;
  authenticationTimer: NodeJS.Timeout;
}

export class BrowserReactionHost extends EventEmitter {
  private readonly requestedPort: number;
  private readonly crop: typeof cropBrowserScreenshot;
  private readonly clients = new Set<BrowserClient>();
  private readonly seenEvents = new Map<string, true>();
  private server: http.Server | null = null;
  private webSockets: WebSocketServer | null = null;
  private enabled = false;
  private captureSessionId: string | null = null;
  private recents: string[] = [];
  private tapbackAssets: TapbackAssetMap = {};
  private health: BrowserHostHealth = {
    transport: "off",
    attached_tabs: 0,
    last_error: null,
  };

  constructor(options: BrowserHostOptions = {}) {
    super();
    this.requestedPort = options.port ?? BROWSER_HOST_PORT;
    this.crop = options.crop ?? cropBrowserScreenshot;
  }

  get state(): BrowserHostHealth {
    return { ...this.health };
  }

  get port(): number | null {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : null;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((_request, response) => {
      response.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
    });
    const webSockets = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_BROWSER_FRAME_BYTES,
      perMessageDeflate: false,
      clientTracking: false,
    });
    server.on("upgrade", (request, socket, head) => {
      if (
        request.url !== SOCKET_PATH ||
        !extensionOriginAllowed(request.headers.origin)
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (connection) => {
        webSockets.emit("connection", connection, request);
      });
    });
    webSockets.on("connection", (socket, request) => {
      this.accept(socket, request.headers.origin!);
    });
    webSockets.on("error", (error) => this.fail(error));
    server.on("error", (error) => this.fail(error));
    this.server = server;
    this.webSockets = webSockets;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(this.requestedPort, BROWSER_HOST);
      });
      this.health = {
        transport: "listening",
        attached_tabs: 0,
        last_error: null,
      };
      this.publish();
    } catch (error) {
      this.server = null;
      this.webSockets = null;
      webSockets.close();
      server.close();
      this.fail(error);
      throw error;
    }
  }

  async setEnabled(
    enabled: boolean,
    recents: string[],
    tapbackAssets: TapbackAssetMap = {},
  ): Promise<void> {
    this.enabled = enabled;
    this.recents = recents
      .filter((emoji) => typeof emoji === "string" && emoji.length <= 32)
      .slice(0, 5);
    this.tapbackAssets = { ...tapbackAssets };
    this.broadcastState();
  }

  async setCaptureSession(sessionId: string | null): Promise<void> {
    this.captureSessionId = sessionId;
    this.broadcastState();
  }

  async dispose(): Promise<void> {
    this.enabled = false;
    this.captureSessionId = null;
    this.recents = [];
    this.tapbackAssets = {};
    this.broadcast({ version: 1, type: "dispose" });
    for (const client of this.clients) {
      clearTimeout(client.authenticationTimer);
      client.socket.close(1001, "Vibecheck is shutting down");
    }
    this.clients.clear();
    const webSockets = this.webSockets;
    const server = this.server;
    this.webSockets = null;
    this.server = null;
    webSockets?.close();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    this.health = {
      transport: "off",
      attached_tabs: 0,
      last_error: null,
    };
    this.publish();
  }

  private accept(socket: WebSocket, origin: string): void {
    const nonce = randomBytes(32).toString("hex");
    const authenticationTimer = setTimeout(() => {
      socket.close(1008, "Authentication timed out");
    }, AUTHENTICATION_TIMEOUT_MS);
    const client: BrowserClient = {
      socket,
      origin,
      nonce,
      authenticated: false,
      synchronized: false,
      browser: null,
      profileId: null,
      documents: new Map(),
      authenticationTimer,
    };
    this.clients.add(client);
    socket.on("message", (data, binary) => {
      if (binary) {
        socket.close(1003, "Binary messages are unsupported");
        return;
      }
      void this.receive(client, data).catch((error) => {
        this.emit("diagnostic", error);
        socket.close(1008, "Invalid component reaction message");
      });
    });
    socket.once("close", () => {
      clearTimeout(authenticationTimer);
      this.clients.delete(client);
      this.recomputeHealth();
    });
    socket.once("error", (error) => this.emit("diagnostic", error));
    this.send(client, {
      version: BROWSER_PROTOCOL_VERSION,
      type: "challenge",
      nonce,
    });
  }

  private async receive(client: BrowserClient, data: RawData): Promise<void> {
    const encoded = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
    if (encoded.length > MAX_BROWSER_FRAME_BYTES) {
      throw new Error("browser extension frame exceeds limit");
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(encoded.toString("utf8"));
    } catch {
      throw new Error("browser extension frame is not valid JSON");
    }
    const message = validateBrowserClientMessage(decoded);
    if (!client.authenticated) {
      if (message.type !== "hello") {
        throw new Error("browser extension must authenticate first");
      }
      this.authenticate(client, message);
      return;
    }
    if (message.type === "hello") {
      throw new Error("browser extension sent a duplicate hello");
    }
    if (!client.synchronized) {
      throw new Error("browser extension is not synchronized");
    }
    if (message.type === "inventory") {
      client.documents = new Map(
        message.documents.map((document) => [
          documentKey(document.tab_id, document.frame_id),
          document,
        ]),
      );
      this.recomputeHealth();
      return;
    }
    const document = client.documents.get(
      documentKey(message.tab_id, message.frame_id),
    );
    if (
      !document ||
      document.document_id !== message.document_id ||
      (message.type === "commit" &&
        (document.window_id !== message.window_id || !document.active))
    ) {
      throw new Error("browser event does not match a live active document");
    }
    if (message.type === "toggle_capture_session") {
      this.emit("toggle-capture-session");
      return;
    }
    this.acceptCommit(client, message);
  }

  private authenticate(client: BrowserClient, hello: BrowserHello): void {
    if (
      hello.nonce !== client.nonce ||
      !verifyBrowserProof(hello) ||
      hello.proof !== browserProof(hello.nonce, hello.browser, hello.profile_id)
    ) {
      throw new Error("browser extension authentication failed");
    }
    clearTimeout(client.authenticationTimer);
    client.authenticated = true;
    client.browser = hello.browser;
    client.profileId = hello.profile_id;
    this.send(client, this.snapshot());
    client.synchronized = true;
    this.recomputeHealth();
  }

  private acceptCommit(client: BrowserClient, message: BrowserCommit): void {
    const browser = client.browser;
    const profileId = client.profileId;
    if (!browser || !profileId) {
      throw new Error("browser connection has no authenticated identity");
    }
    const identity = `${browser}:${profileId}:${message.tab_id}:${message.frame_id}:${message.document_id}:${message.event.event_id}`;
    if (this.seenEvents.has(identity)) return;
    this.seenEvents.set(identity, true);
    while (this.seenEvents.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEvents.keys().next().value as string | undefined;
      if (!oldest) break;
      this.seenEvents.delete(oldest);
    }
    const source: ReactionSource = {
      name: browser === "safari" ? "Safari" : "Google Chrome",
      bundle_id:
        browser === "safari" ? "com.apple.Safari" : "com.google.Chrome",
    };
    const context: RendererReactionContext = {
      source,
      event: message.event,
      capture: async () =>
        this.crop(
          message.screenshot_data_url,
          message.event.bounds,
          message.viewport,
        ),
      settle: async (outcome) => {
        if (
          client.socket.readyState !== WebSocket.OPEN ||
          client.documents.get(documentKey(message.tab_id, message.frame_id))
            ?.document_id !== message.document_id
        ) {
          return;
        }
        this.send(client, {
          version: 1,
          type: "settle",
          tab_id: message.tab_id,
          frame_id: message.frame_id,
          document_id: message.document_id,
          event_id: message.event.event_id,
          outcome,
        });
      },
    };
    this.emit("commit", context);
  }

  private snapshot(): BrowserStateSnapshot {
    return {
      version: 1,
      type: "state",
      enabled: this.enabled,
      capture_session_id: this.captureSessionId,
      recents: this.recents,
      tapback_assets: this.tapbackAssets,
    };
  }

  private broadcastState(): void {
    this.broadcast(this.snapshot());
  }

  private broadcast(message: BrowserHostMessage): void {
    for (const client of this.clients) {
      if (client.authenticated) this.send(client, message);
    }
  }

  private send(client: BrowserClient, message: BrowserHostMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private recomputeHealth(): void {
    if (!this.server) {
      this.health = {
        transport: "off",
        attached_tabs: 0,
        last_error: null,
      };
      this.publish();
      return;
    }
    const tabs = new Set<string>();
    let connected = false;
    for (const client of this.clients) {
      if (!client.authenticated) continue;
      connected = true;
      for (const document of client.documents.values()) {
        tabs.add(`${client.browser}:${client.profileId}:${document.tab_id}`);
      }
    }
    this.health = {
      transport: connected ? "connected" : "listening",
      attached_tabs: tabs.size,
      last_error: null,
    };
    this.publish();
  }

  private fail(error: unknown): void {
    const message =
      error instanceof Error ? error.message : "Browser reaction host failed";
    this.health = {
      transport: "degraded",
      attached_tabs: 0,
      last_error: message,
    };
    this.emit("diagnostic", error);
    this.publish();
  }

  private publish(): void {
    this.emit("state", this.state);
  }
}

function documentKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}
