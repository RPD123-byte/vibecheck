export const COMPONENT_PROTOCOL_VERSION = 1;
export const MAX_COMPONENT_FRAME_BYTES = 64 * 1024;
export const MAX_COPY_TEXT_BYTES = 32 * 1024;
export const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024;
export const MAX_EMOJI_RECENTS = 5;
export const MAX_TAPBACK_ASSET_BYTES = 8 * 1024;
export const MAX_TAPBACK_ASSET_MAP_BYTES = 48 * 1024;
export const TAPBACK_ASSET_KEYS = [
  "heart",
  "thumbs-up",
  "thumbs-down",
  "haha",
  "exclamation",
  "question",
] as const;

export type TapbackAssetKey = (typeof TAPBACK_ASSET_KEYS)[number];
export type TapbackAssetMap = Partial<Record<TapbackAssetKey, string>>;

export interface TargetApplication {
  name: string;
  bundle_id: string;
  bundle_path: string;
  pid: number;
  managed_debug_port?: number;
  managed_ownership_marker?: string;
}

export interface TargetRecord extends TargetApplication {
  debug_port: number;
  ownership_marker: string;
  enrolled: boolean;
  attached: boolean;
  status:
    | "discovered"
    | "managed"
    | "relaunching"
    | "attaching"
    | "attached"
    | "deferred"
    | "unavailable"
    | "stopped";
  last_error: string | null;
}

export interface ReactionSource {
  name: string;
  bundle_id: string;
}

export interface RendererCommit {
  schema_version: 1;
  type: "commit";
  event_id: string;
  document_id: string;
  clipboard_session_id: string | null;
  copy_text: string;
  reaction_emoji: string;
  reaction_label: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    device_scale_factor: number;
  };
}

export interface RendererSessionToggle {
  schema_version: 1;
  type: "toggle_capture_session";
  document_id: string;
}

export type RendererHostEvent = RendererCommit | RendererSessionToggle;

export interface RendererReactionContext {
  source: ReactionSource;
  event: RendererCommit;
  capture(): Promise<Buffer>;
  settle(outcome: ReactionOutcome): Promise<void>;
}

export interface ExplicitReactionEvent {
  schema_version: 1;
  event_id: string;
  captured_at_ms: number;
  source_application_name: string;
  source_bundle_id: string;
  reaction_emoji: string;
  reaction_label: string;
  copy_text: string;
  screenshot_path: string;
}

export type ReactionOutcome =
  | "sent"
  | "no_active_turn"
  | "multiple_active_turns"
  | "unavailable"
  | "rejected"
  | "interrupt_failed"
  | "restart_failed"
  | "sent_outcome_unknown"
  | "copy_failed";

const REACTION_OUTCOMES: ReadonlySet<string> = new Set<ReactionOutcome>([
  "sent",
  "no_active_turn",
  "multiple_active_turns",
  "unavailable",
  "rejected",
  "interrupt_failed",
  "restart_failed",
  "sent_outcome_unknown",
  "copy_failed",
]);

export interface ReactionResult {
  schema_version: 1;
  event_id: string;
  outcome: ReactionOutcome;
  thread_id?: string;
  detail?: string;
}

export interface NativeResponse {
  version: 1;
  id: string;
  ok: boolean;
  result?: {
    enabled?: boolean;
    permission?: "granted" | "denied";
    entry_count?: number;
    marked?: boolean;
    targets?: TargetApplication[];
    relaunched?: boolean;
    tapback_assets?: TapbackAssetMap;
  };
  error?: { code: string; message: string };
}

export function validateRendererCommit(value: unknown): RendererCommit {
  if (!value || typeof value !== "object") {
    throw new Error("renderer commit must be an object");
  }
  const event = value as Partial<RendererCommit>;
  if (
    !exactKeys(value, [
      "schema_version",
      "type",
      "event_id",
      "document_id",
      "clipboard_session_id",
      "copy_text",
      "reaction_emoji",
      "reaction_label",
      "bounds",
    ]) ||
    event.schema_version !== COMPONENT_PROTOCOL_VERSION ||
    event.type !== "commit" ||
    !bounded(event.event_id, 128) ||
    !bounded(event.document_id, 128) ||
    !(
      event.clipboard_session_id === null ||
      bounded(event.clipboard_session_id, 128)
    ) ||
    !bounded(event.copy_text, MAX_COPY_TEXT_BYTES, true) ||
    !bounded(event.reaction_emoji, 32) ||
    !bounded(event.reaction_label, 128) ||
    !validBounds(event.bounds)
  ) {
    throw new Error("renderer commit is invalid");
  }
  return event as RendererCommit;
}

export function validateRendererHostEvent(value: unknown): RendererHostEvent {
  if (!value || typeof value !== "object") {
    throw new Error("renderer host event must be an object");
  }
  if ((value as { type?: unknown }).type === "commit") {
    return validateRendererCommit(value);
  }
  const event = value as Partial<RendererSessionToggle>;
  if (
    !exactKeys(value, ["schema_version", "type", "document_id"]) ||
    event.schema_version !== COMPONENT_PROTOCOL_VERSION ||
    event.type !== "toggle_capture_session" ||
    !bounded(event.document_id, 128)
  ) {
    throw new Error("renderer session toggle is invalid");
  }
  return event as RendererSessionToggle;
}

export function isReactionOutcome(value: unknown): value is ReactionOutcome {
  return typeof value === "string" && REACTION_OUTCOMES.has(value);
}

export function validateTapbackAssetMap(value: unknown): TapbackAssetMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tapback asset map must be an object");
  }
  const allowed = new Set<string>(TAPBACK_ASSET_KEYS);
  const assets: TapbackAssetMap = {};
  let totalBytes = 0;
  for (const [key, dataUrl] of Object.entries(value)) {
    if (
      !allowed.has(key) ||
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/png;base64,")
    ) {
      throw new Error("tapback asset map is invalid");
    }
    const encoded = dataUrl.slice("data:image/png;base64,".length);
    if (
      encoded.length === 0 ||
      encoded.length > Math.ceil((MAX_TAPBACK_ASSET_BYTES * 4) / 3) + 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ) {
      throw new Error("tapback asset encoding is invalid");
    }
    const png = Buffer.from(encoded, "base64");
    if (
      png.length === 0 ||
      png.length > MAX_TAPBACK_ASSET_BYTES ||
      !png.subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary"))
    ) {
      throw new Error("tapback asset is not a bounded PNG");
    }
    totalBytes += png.length;
    if (totalBytes > MAX_TAPBACK_ASSET_MAP_BYTES) {
      throw new Error("tapback asset map exceeds limit");
    }
    assets[key as TapbackAssetKey] = dataUrl;
  }
  return assets;
}

function bounded(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.trim().length > 0) &&
    !value.includes("\0") &&
    Buffer.byteLength(value) <= maximumBytes
  );
}

function validBounds(value: unknown): value is RendererCommit["bounds"] {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Record<string, unknown>;
  return (
    exactKeys(value, ["x", "y", "width", "height", "device_scale_factor"]) &&
    ["x", "y", "width", "height", "device_scale_factor"].every(
      (key) => typeof bounds[key] === "number" && Number.isFinite(bounds[key]),
    ) &&
    Number(bounds.width) > 0 &&
    Number(bounds.height) > 0
  );
}

function exactKeys(value: object, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}
