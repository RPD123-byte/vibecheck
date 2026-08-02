import { extensionApi, type ExtensionSender } from "./api";
import type {
  BackgroundToContent,
  ContentEvent,
  ContentToBackground,
} from "./messages";
import {
  BROWSER_CLIENT_KEY,
  BROWSER_PROTOCOL_VERSION,
  browserSocketUrl,
} from "../component-reactions/browser-shared";
import type {
  BrowserChallenge,
  BrowserClientMessage,
  BrowserDocument,
  BrowserFamily,
  BrowserHostMessage,
  BrowserStateSnapshot,
} from "../component-reactions/browser-protocol";
import type {
  RendererCommit,
  RendererSessionToggle,
  TapbackAssetMap,
} from "../component-reactions/types";

const PROFILE_KEY = "vibecheck_profile_id";
const MIN_RECONNECT_MS = 250;
const MAX_RECONNECT_MS = 10_000;
const MIN_CAPTURE_INTERVAL_MS = 600;
const api = extensionApi();
const browserFamily: BrowserFamily =
  /\bSafari\//.test(navigator.userAgent) &&
  !/\b(?:Chrome|Chromium|CriOS)\//.test(navigator.userAgent)
    ? "safari"
    : "chrome";
const documents = new Map<string, BrowserDocument>();
let socket: WebSocket | null = null;
let synchronized = false;
let reconnectDelay = MIN_RECONNECT_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let profileId = "";
let currentState: BrowserStateSnapshot = dormantState();
let captureQueue: Promise<void> = Promise.resolve();
let lastCaptureAt = 0;
setInterval(sendInventory, 20_000);

api.runtime.onMessage.addListener(async (value, sender) => {
  const message = value as Partial<ContentToBackground>;
  if (
    !message ||
    (message.kind !== "document_ready" && message.kind !== "renderer_event")
  ) {
    return;
  }
  const identity = trustedIdentity(sender, message.document_id);
  if (!identity) return;
  if (message.kind === "document_ready") {
    documents.set(documentKey(identity.tab_id, identity.frame_id), {
      ...identity,
      title: String(message.title ?? identity.title).slice(0, 1024),
      url: String(message.url ?? identity.url).slice(0, 8 * 1024),
    });
    sendInventory();
    await sendContentState(identity);
    return;
  }
  const eventMessage = message as Partial<ContentEvent>;
  const existing = documents.get(
    documentKey(identity.tab_id, identity.frame_id),
  );
  if (!existing || existing.document_id !== identity.document_id) return;
  documents.set(documentKey(identity.tab_id, identity.frame_id), identity);
  sendInventory();
  if (eventMessage.event?.type === "toggle_capture_session") {
    send({
      version: 1,
      type: "toggle_capture_session",
      tab_id: identity.tab_id,
      frame_id: identity.frame_id,
      document_id: identity.document_id,
    });
    return;
  }
  if (
    eventMessage.event?.type !== "commit" ||
    !eventMessage.viewport ||
    !currentState.enabled
  ) {
    return;
  }
  await captureAndSend(identity, eventMessage.event, eventMessage.viewport);
});

api.tabs.onRemoved.addListener((tabId) => {
  removeTabDocuments(tabId);
  sendInventory();
});

api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || typeof changeInfo.url === "string") {
    removeTabDocuments(tabId);
    sendInventory();
  }
  if (changeInfo.status === "complete") {
    void api.tabs.sendMessage(tabId, { kind: "probe" }).catch(() => undefined);
  }
});

void initialize();

async function initialize(): Promise<void> {
  const stored = await api.storage.local.get(PROFILE_KEY);
  profileId =
    typeof stored[PROFILE_KEY] === "string" &&
    String(stored[PROFILE_KEY]).length <= 128
      ? String(stored[PROFILE_KEY])
      : crypto.randomUUID();
  await api.storage.local.set({ [PROFILE_KEY]: profileId });
  await probeExistingDocuments();
  connect();
}

async function probeExistingDocuments(): Promise<void> {
  let tabs: Array<{ id?: number }> = [];
  try {
    tabs = await api.tabs.query({
      url: ["http://*/*", "https://*/*", "file:///*"],
    });
  } catch {
    return;
  }
  await Promise.allSettled(
    tabs.map(async (tab) => {
      if (!Number.isInteger(tab.id)) return;
      try {
        await api.tabs.sendMessage(tab.id!, { kind: "probe" });
      } catch {
        // The tab is restricted or has no permitted content entry.
      }
    }),
  );
}

function connect(): void {
  if (socket && socket.readyState < WebSocket.CLOSING) return;
  const next = new WebSocket(browserSocketUrl());
  socket = next;
  synchronized = false;
  next.addEventListener("message", (event) => {
    void receiveHostMessage(next, String(event.data));
  });
  next.addEventListener("open", () => {
    reconnectDelay = MIN_RECONNECT_MS;
  });
  next.addEventListener("close", () => {
    if (socket === next) socket = null;
    synchronized = false;
    currentState = dormantState();
    void broadcastState();
    scheduleReconnect();
  });
  next.addEventListener("error", () => {
    next.close();
  });
}

async function receiveHostMessage(
  connection: WebSocket,
  encoded: string,
): Promise<void> {
  let message: BrowserHostMessage;
  try {
    message = JSON.parse(encoded) as BrowserHostMessage;
  } catch (error) {
    console.error("[vibecheck-browser-reactions] invalid host message", error);
    connection.close(1008, "Invalid host message");
    return;
  }
  if (
    message.version !== BROWSER_PROTOCOL_VERSION ||
    typeof message.type !== "string"
  ) {
    connection.close(1008, "Incompatible host protocol");
    return;
  }
  if (message.type === "challenge") {
    await answerChallenge(connection, message);
    return;
  }
  if (message.type === "state") {
    currentState = {
      version: 1,
      type: "state",
      enabled: Boolean(message.enabled),
      capture_session_id:
        typeof message.capture_session_id === "string"
          ? message.capture_session_id
          : null,
      recents: Array.isArray(message.recents)
        ? message.recents
            .filter((emoji): emoji is string => typeof emoji === "string")
            .slice(0, 5)
        : [],
      tapback_assets: normalizeTapbackAssets(message.tapback_assets),
    };
    synchronized = true;
    sendInventory();
    await broadcastState();
    return;
  }
  if (message.type === "settle") {
    await sendToContent(message.tab_id, message.frame_id, {
      kind: "settle",
      document_id: message.document_id,
      event_id: message.event_id,
      outcome: message.outcome,
    });
    return;
  }
  if (message.type === "dispose") {
    currentState = dormantState();
    synchronized = false;
    await broadcastDispose();
    connection.close(1001, "Host disposed");
  }
}

async function answerChallenge(
  connection: WebSocket,
  challenge: BrowserChallenge,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(challenge.nonce) || !profileId) {
    connection.close(1008, "Invalid challenge");
    return;
  }
  const proof = await sha256(
    `${BROWSER_CLIENT_KEY}:${challenge.nonce}:${browserFamily}:${profileId}`,
  );
  send(
    {
      version: 1,
      type: "hello",
      nonce: challenge.nonce,
      proof,
      browser: browserFamily,
      extension_version: api.runtime.getManifest().version,
      profile_id: profileId,
    },
    connection,
    false,
  );
}

async function captureAndSend(
  identity: BrowserDocument,
  event: RendererCommit,
  viewport: {
    width: number;
    height: number;
    device_scale_factor: number;
  },
): Promise<void> {
  try {
    const current = await api.tabs.get(identity.tab_id);
    if (
      !current.active ||
      current.windowId !== identity.window_id ||
      !synchronized
    ) {
      throw new Error("The committing browser tab is no longer active");
    }
    const screenshot = await queuedVisibleTabCapture(identity.window_id);
    send({
      version: 1,
      type: "commit",
      tab_id: identity.tab_id,
      window_id: identity.window_id,
      frame_id: identity.frame_id,
      document_id: identity.document_id,
      viewport,
      event,
      screenshot_data_url: screenshot,
    });
  } catch (error) {
    console.error(
      "[vibecheck-browser-reactions] visible-tab capture failed",
      error,
    );
    await sendToContent(identity.tab_id, identity.frame_id, {
      kind: "settle",
      document_id: identity.document_id,
      event_id: event.event_id,
      outcome: "copy_failed",
    });
  }
}

async function queuedVisibleTabCapture(windowId: number): Promise<string> {
  let captured = "";
  const operation = captureQueue
    .catch(() => undefined)
    .then(async () => {
      const remaining = MIN_CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      captured = await api.tabs.captureVisibleTab(windowId, {
        format: "png",
      });
      lastCaptureAt = Date.now();
    });
  captureQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
  return captured;
}

function trustedIdentity(
  sender: ExtensionSender,
  documentId: unknown,
): BrowserDocument | null {
  const tab = sender.tab;
  if (
    !tab ||
    !Number.isInteger(tab.id) ||
    !Number.isInteger(tab.windowId) ||
    !Number.isInteger(sender.frameId) ||
    typeof documentId !== "string" ||
    documentId.length === 0 ||
    documentId.length > 128
  ) {
    return null;
  }
  return {
    tab_id: tab.id!,
    window_id: tab.windowId!,
    frame_id: sender.frameId!,
    document_id: documentId,
    title: String(tab.title ?? "").slice(0, 1024),
    url: String(sender.url ?? tab.url ?? "").slice(0, 8 * 1024),
    active: Boolean(tab.active),
  };
}

function sendInventory(): void {
  if (!synchronized) return;
  send({
    version: 1,
    type: "inventory",
    documents: [...documents.values()],
  });
}

function send(
  message: BrowserClientMessage,
  connection = socket,
  requireSynchronized = true,
): void {
  if (
    !connection ||
    connection.readyState !== WebSocket.OPEN ||
    (requireSynchronized && !synchronized)
  ) {
    return;
  }
  connection.send(JSON.stringify(message));
}

async function broadcastState(): Promise<void> {
  await Promise.allSettled(
    [...documents.values()].map((document) => sendContentState(document)),
  );
}

async function sendContentState(document: BrowserDocument): Promise<void> {
  await sendToContent(document.tab_id, document.frame_id, {
    kind: "state",
    document_id: document.document_id,
    enabled: currentState.enabled,
    capture_session_id: currentState.capture_session_id,
    recents: currentState.recents,
    tapback_assets: currentState.tapback_assets,
  });
}

async function broadcastDispose(): Promise<void> {
  await Promise.allSettled(
    [...documents.values()].map((document) =>
      sendToContent(document.tab_id, document.frame_id, {
        kind: "dispose",
        document_id: document.document_id,
      }),
    ),
  );
}

async function sendToContent(
  tabId: number,
  frameId: number,
  message: BackgroundToContent,
): Promise<void> {
  try {
    await api.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    // The frame navigated or its site permission was revoked.
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(MAX_RECONNECT_MS, reconnectDelay * 2);
}

function dormantState(): BrowserStateSnapshot {
  return {
    version: 1,
    type: "state",
    enabled: false,
    capture_session_id: null,
    recents: [],
    tapback_assets: {},
  };
}

function normalizeTapbackAssets(value: unknown): TapbackAssetMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set([
    "heart",
    "thumbs-up",
    "thumbs-down",
    "haha",
    "exclamation",
    "question",
  ]);
  const normalized: Record<string, string> = {};
  let totalLength = 0;
  for (const [key, dataUrl] of Object.entries(value)) {
    if (
      !allowed.has(key) ||
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/png;base64,") ||
      dataUrl.length > 12 * 1024
    ) {
      continue;
    }
    totalLength += dataUrl.length;
    if (totalLength > 64 * 1024) break;
    normalized[key] = dataUrl;
  }
  return normalized as TapbackAssetMap;
}

function documentKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

function removeTabDocuments(tabId: number): void {
  for (const [key, document] of documents) {
    if (document.tab_id === tabId) documents.delete(key);
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
