import type {
  ReactionOutcome,
  RendererHostEvent,
  TapbackAssetMap,
} from "../component-reactions/types";

export interface ContentReady {
  kind: "document_ready";
  document_id: string;
  title: string;
  url: string;
}

export interface ContentEvent {
  kind: "renderer_event";
  document_id: string;
  event: RendererHostEvent;
  viewport?: {
    width: number;
    height: number;
    device_scale_factor: number;
  };
}

export type ContentToBackground = ContentReady | ContentEvent;

export interface ContentState {
  kind: "state";
  document_id: string;
  enabled: boolean;
  capture_session_id: string | null;
  recents: string[];
  tapback_assets: TapbackAssetMap;
}

export interface ContentSettlement {
  kind: "settle";
  document_id: string;
  event_id: string;
  outcome: ReactionOutcome;
}

export interface ContentDispose {
  kind: "dispose";
  document_id: string;
}

export interface ContentProbe {
  kind: "probe";
}

export type BackgroundToContent =
  ContentState | ContentSettlement | ContentDispose | ContentProbe;
