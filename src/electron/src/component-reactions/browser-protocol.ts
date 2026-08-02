import { createHash, timingSafeEqual } from "node:crypto";
import {
  MAX_SCREENSHOT_BYTES,
  type ReactionOutcome,
  type RendererCommit,
  type TapbackAssetMap,
  validateRendererCommit,
} from "./types";
import {
  BROWSER_CLIENT_KEY,
  BROWSER_HOST,
  BROWSER_HOST_PORT,
  BROWSER_PROTOCOL_VERSION,
} from "./browser-shared";

export {
  BROWSER_CLIENT_KEY,
  BROWSER_HOST,
  BROWSER_HOST_PORT,
  BROWSER_PROTOCOL_VERSION,
} from "./browser-shared";
export const MAX_BROWSER_FRAME_BYTES =
  Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 128 * 1024;

export type BrowserFamily = "chrome" | "safari";

export interface BrowserChallenge {
  version: 1;
  type: "challenge";
  nonce: string;
}

export interface BrowserHello {
  version: 1;
  type: "hello";
  nonce: string;
  proof: string;
  browser: BrowserFamily;
  extension_version: string;
  profile_id: string;
}

export interface BrowserDocument {
  tab_id: number;
  window_id: number;
  frame_id: number;
  document_id: string;
  title: string;
  url: string;
  active: boolean;
}

export interface BrowserInventory {
  version: 1;
  type: "inventory";
  documents: BrowserDocument[];
}

export interface BrowserToggle {
  version: 1;
  type: "toggle_capture_session";
  tab_id: number;
  frame_id: number;
  document_id: string;
}

export interface BrowserCommit {
  version: 1;
  type: "commit";
  tab_id: number;
  window_id: number;
  frame_id: number;
  document_id: string;
  viewport: {
    width: number;
    height: number;
    device_scale_factor: number;
  };
  event: RendererCommit;
  screenshot_data_url: string;
}

export type BrowserClientMessage =
  BrowserHello | BrowserInventory | BrowserToggle | BrowserCommit;

export interface BrowserStateSnapshot {
  version: 1;
  type: "state";
  enabled: boolean;
  capture_session_id: string | null;
  recents: string[];
  tapback_assets: TapbackAssetMap;
}

export interface BrowserSettlement {
  version: 1;
  type: "settle";
  tab_id: number;
  frame_id: number;
  document_id: string;
  event_id: string;
  outcome: ReactionOutcome;
}

export interface BrowserDispose {
  version: 1;
  type: "dispose";
}

export type BrowserHostMessage =
  BrowserChallenge | BrowserStateSnapshot | BrowserSettlement | BrowserDispose;

export function browserProof(
  nonce: string,
  browser: BrowserFamily,
  profileId: string,
): string {
  return createHash("sha256")
    .update(`${BROWSER_CLIENT_KEY}:${nonce}:${browser}:${profileId}`, "utf8")
    .digest("hex");
}

export function verifyBrowserProof(hello: BrowserHello): boolean {
  const expected = Buffer.from(
    browserProof(hello.nonce, hello.browser, hello.profile_id),
    "hex",
  );
  const actual = Buffer.from(hello.proof, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validateBrowserClientMessage(
  value: unknown,
): BrowserClientMessage {
  const record = objectRecord(value, "browser message");
  if (
    record.version !== BROWSER_PROTOCOL_VERSION ||
    typeof record.type !== "string"
  ) {
    throw new Error("browser message version or type is invalid");
  }
  if (record.type === "hello") return validateHello(record);
  if (record.type === "inventory") return validateInventory(record);
  if (record.type === "toggle_capture_session") return validateToggle(record);
  if (record.type === "commit") return validateCommit(record);
  throw new Error("browser message type is unsupported");
}

export function extensionOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === "chrome-extension:" ||
        parsed.protocol === "safari-web-extension:") &&
      parsed.hostname.length >= 8 &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.port === "" &&
      (parsed.pathname === "/" || parsed.pathname === "")
    );
  } catch {
    return false;
  }
}

function validateHello(record: Record<string, unknown>): BrowserHello {
  exactKeys(record, [
    "version",
    "type",
    "nonce",
    "proof",
    "browser",
    "extension_version",
    "profile_id",
  ]);
  if (
    !boundedString(record.nonce, 64) ||
    !/^[0-9a-f]{64}$/.test(record.proof as string) ||
    (record.browser !== "chrome" && record.browser !== "safari") ||
    !boundedString(record.extension_version, 32) ||
    !boundedString(record.profile_id, 128)
  ) {
    throw new Error("browser hello is invalid");
  }
  return record as unknown as BrowserHello;
}

function validateInventory(record: Record<string, unknown>): BrowserInventory {
  exactKeys(record, ["version", "type", "documents"]);
  if (!Array.isArray(record.documents) || record.documents.length > 512) {
    throw new Error("browser inventory is invalid");
  }
  const documents = record.documents.map((value) => {
    const document = objectRecord(value, "browser document");
    exactKeys(document, [
      "tab_id",
      "window_id",
      "frame_id",
      "document_id",
      "title",
      "url",
      "active",
    ]);
    if (
      !nonNegativeInteger(document.tab_id) ||
      !nonNegativeInteger(document.window_id) ||
      !Number.isInteger(document.frame_id) ||
      Number(document.frame_id) < 0 ||
      !boundedString(document.document_id, 128) ||
      !boundedString(document.title, 1024, true) ||
      !boundedString(document.url, 8 * 1024, true) ||
      typeof document.active !== "boolean"
    ) {
      throw new Error("browser document is invalid");
    }
    return document as unknown as BrowserDocument;
  });
  return { version: 1, type: "inventory", documents };
}

function validateToggle(record: Record<string, unknown>): BrowserToggle {
  exactKeys(record, ["version", "type", "tab_id", "frame_id", "document_id"]);
  if (
    !nonNegativeInteger(record.tab_id) ||
    !nonNegativeInteger(record.frame_id) ||
    !boundedString(record.document_id, 128)
  ) {
    throw new Error("browser toggle is invalid");
  }
  return record as unknown as BrowserToggle;
}

function validateCommit(record: Record<string, unknown>): BrowserCommit {
  exactKeys(record, [
    "version",
    "type",
    "tab_id",
    "window_id",
    "frame_id",
    "document_id",
    "viewport",
    "event",
    "screenshot_data_url",
  ]);
  const viewport = objectRecord(record.viewport, "browser viewport");
  exactKeys(viewport, ["width", "height", "device_scale_factor"]);
  if (
    !nonNegativeInteger(record.tab_id) ||
    !nonNegativeInteger(record.window_id) ||
    !nonNegativeInteger(record.frame_id) ||
    !boundedString(record.document_id, 128) ||
    !positiveFinite(viewport.width) ||
    !positiveFinite(viewport.height) ||
    !positiveFinite(viewport.device_scale_factor) ||
    Number(viewport.width) > 100_000 ||
    Number(viewport.height) > 100_000 ||
    Number(viewport.device_scale_factor) > 16 ||
    typeof record.screenshot_data_url !== "string" ||
    record.screenshot_data_url.length > MAX_BROWSER_FRAME_BYTES
  ) {
    throw new Error("browser commit envelope is invalid");
  }
  const event = validateRendererCommit(record.event);
  if (event.document_id !== record.document_id) {
    throw new Error("browser commit document identity does not match");
  }
  return {
    version: 1,
    type: "commit",
    tab_id: record.tab_id as number,
    window_id: record.window_id as number,
    frame_id: record.frame_id as number,
    document_id: record.document_id as string,
    viewport: viewport as unknown as BrowserCommit["viewport"],
    event,
    screenshot_data_url: record.screenshot_data_url,
  };
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error("browser message contains unknown or missing fields");
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function boundedString(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    !value.includes("\0") &&
    Buffer.byteLength(value) <= maximumBytes
  );
}
