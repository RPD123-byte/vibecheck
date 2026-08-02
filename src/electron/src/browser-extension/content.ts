import { extensionApi } from "./api";
import type { BackgroundToContent, ContentToBackground } from "./messages";
import { rendererBootstrap } from "../component-reactions/renderer-source";
import rendererCss from "../component-reactions/renderer-style.css?raw";
import type {
  RendererCommit,
  RendererHostEvent,
  TapbackAssetMap,
} from "../component-reactions/types";

const FRAME_MESSAGE = "__vibecheck_component_frame_v1__";
const documentId = crypto.randomUUID();
const api = extensionApi();

type ControllerWindow = Window & {
  __vibecheckComponentCommit?: (payload: string) => void;
  __vibecheckComponentReactions?: {
    setEnabled(
      enabled: boolean,
      recents?: string[],
      tapbackAssets?: TapbackAssetMap,
    ): void;
    setCaptureSession(sessionId: string | null): void;
    settle(eventId: string, outcome: string): void;
    dispose(): void;
    documentId: string;
  };
};

type FrameRequest = {
  marker: typeof FRAME_MESSAGE;
  kind: "request";
  id: string;
  bounds: RendererCommit["bounds"];
};

type FrameResponse = {
  marker: typeof FRAME_MESSAGE;
  kind: "response";
  id: string;
  bounds: RendererCommit["bounds"] | null;
  viewport: {
    width: number;
    height: number;
    device_scale_factor: number;
  } | null;
};

const host = window as ControllerWindow;

api.runtime.onMessage.addListener((value) => {
  const message = value as Partial<BackgroundToContent>;
  if (!message) return;
  if (message.kind === "probe") {
    announceDocument();
    return;
  }
  if (!("document_id" in message) || message.document_id !== documentId) return;
  const controller = host.__vibecheckComponentReactions;
  if (!controller) return;
  if (message.kind === "state") {
    controller.setEnabled(
      Boolean(message.enabled),
      message.recents ?? [],
      message.tapback_assets ?? {},
    );
    controller.setCaptureSession(message.capture_session_id ?? null);
  } else if (message.kind === "settle") {
    controller.settle(String(message.event_id), String(message.outcome));
  } else if (message.kind === "dispose") {
    controller.setCaptureSession(null);
    controller.setEnabled(false, [], {});
  }
});

window.addEventListener("message", (event) => {
  const message = event.data as Partial<FrameRequest | FrameResponse>;
  if (
    event.source === window ||
    !message ||
    message.marker !== FRAME_MESSAGE ||
    message.kind !== "request" ||
    typeof message.id !== "string" ||
    !validBounds(message.bounds)
  ) {
    return;
  }
  const frame = [
    ...document.querySelectorAll<HTMLIFrameElement | HTMLFrameElement>(
      "iframe,frame",
    ),
  ].find((candidate) => candidate.contentWindow === event.source);
  if (!frame) return;
  const requestId = message.id;
  const frameRect = frame.getBoundingClientRect();
  const lifted = {
    ...message.bounds,
    x: message.bounds.x + frameRect.left,
    y: message.bounds.y + frameRect.top,
  };
  void liftBounds(lifted).then((result) => {
    (event.source as WindowProxy | null)?.postMessage(
      {
        marker: FRAME_MESSAGE,
        kind: "response",
        id: requestId,
        bounds: result?.bounds ?? null,
        viewport: result?.viewport ?? null,
      } satisfies FrameResponse,
      "*",
    );
  });
});

if (document.documentElement) {
  installController();
} else {
  document.addEventListener("readystatechange", function ready() {
    if (!document.documentElement) return;
    document.removeEventListener("readystatechange", ready);
    installController();
  });
}

function installController(): void {
  host.__vibecheckComponentCommit = (payload) => {
    void forwardRendererPayload(payload);
  };
  rendererBootstrap(rendererCss);
  announceDocument();
}

function announceDocument(): void {
  void api.runtime.sendMessage({
    kind: "document_ready",
    document_id: documentId,
    title: document.title.slice(0, 1024),
    url: location.href.slice(0, 8 * 1024),
  } satisfies ContentToBackground);
}

async function forwardRendererPayload(payload: string): Promise<void> {
  let event: RendererHostEvent;
  try {
    event = JSON.parse(payload) as RendererHostEvent;
  } catch {
    return;
  }
  if (event.document_id !== host.__vibecheckComponentReactions?.documentId) {
    return;
  }
  if (event.type === "toggle_capture_session") {
    await api.runtime.sendMessage({
      kind: "renderer_event",
      document_id: documentId,
      event: { ...event, document_id: documentId },
    } satisfies ContentToBackground);
    return;
  }
  if (!validBounds(event.bounds)) return;
  const lifted = await liftBounds(event.bounds);
  if (!lifted) {
    host.__vibecheckComponentReactions?.settle(event.event_id, "copy_failed");
    return;
  }
  await api.runtime.sendMessage({
    kind: "renderer_event",
    document_id: documentId,
    event: {
      ...event,
      document_id: documentId,
      bounds: lifted.bounds,
    },
    viewport: lifted.viewport,
  } satisfies ContentToBackground);
}

async function liftBounds(bounds: RendererCommit["bounds"]): Promise<{
  bounds: RendererCommit["bounds"];
  viewport: {
    width: number;
    height: number;
    device_scale_factor: number;
  };
} | null> {
  if (window === window.top) {
    return {
      bounds: { ...bounds, device_scale_factor: window.devicePixelRatio || 1 },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        device_scale_factor: window.devicePixelRatio || 1,
      },
    };
  }
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      resolve(null);
    }, 1_000);
    const receive = (event: MessageEvent): void => {
      const response = event.data as Partial<FrameResponse>;
      if (
        event.source !== window.parent ||
        response?.marker !== FRAME_MESSAGE ||
        response.kind !== "response" ||
        response.id !== id
      ) {
        return;
      }
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(
        response.bounds &&
          response.viewport &&
          validBounds(response.bounds) &&
          validViewport(response.viewport)
          ? {
              bounds: response.bounds,
              viewport: response.viewport,
            }
          : null,
      );
    };
    window.addEventListener("message", receive);
    window.parent.postMessage(
      {
        marker: FRAME_MESSAGE,
        kind: "request",
        id,
        bounds,
      } satisfies FrameRequest,
      "*",
    );
  });
}

function validBounds(value: unknown): value is RendererCommit["bounds"] {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Record<string, unknown>;
  return (
    ["x", "y", "width", "height", "device_scale_factor"].every(
      (key) => typeof bounds[key] === "number" && Number.isFinite(bounds[key]),
    ) &&
    Number(bounds.width) > 0 &&
    Number(bounds.height) > 0
  );
}

function validViewport(value: unknown): value is {
  width: number;
  height: number;
  device_scale_factor: number;
} {
  if (!value || typeof value !== "object") return false;
  const viewport = value as Record<string, unknown>;
  return ["width", "height", "device_scale_factor"].every(
    (key) =>
      typeof viewport[key] === "number" &&
      Number.isFinite(viewport[key]) &&
      Number(viewport[key]) > 0,
  );
}
