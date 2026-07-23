export const PROTOCOL_VERSION = 1;
export const MAX_CONTROL_BYTES = 64 * 1024;

export type AggregateState =
  | "off"
  | "starting"
  | "active"
  | "paused"
  | "needs_permission"
  | "degraded"
  | "failed";

export interface Features {
  revision: number;
  notch_enabled: boolean;
  integrations: {
    codex_enabled: boolean;
  };
  paused: boolean;
}

interface WorkerHealth {
  lifecycle: string;
  ready: boolean;
  restart_count: number;
  pid: number | null;
  stream: string;
  last_error: string | null;
}

export interface RuntimeSnapshot {
  features: Features;
  desired_roles: string[];
  effective_roles: string[];
  aggregate: AggregateState;
  workers: Record<string, WorkerHealth>;
  errors: Array<{ role: string; message: string }>;
}

export interface PublicState {
  aggregate: AggregateState;
  features: Features;
  camera: "off" | "starting" | "active" | "needs_permission";
  canRecover: boolean;
}

export interface Bootstrap {
  version: 1;
  type: "bootstrap";
  runtime_id: string;
  control_socket: string;
  controller_token: string;
}

export interface ControlEnvelope {
  version: 1;
  type: "ack" | "error" | "state_update";
  id?: string | null;
  runtime_id: string;
  state: RuntimeSnapshot;
  error?: { code: string; message: string };
}

export function isBootstrap(value: unknown): value is Bootstrap {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Bootstrap>;
  return (
    item.version === PROTOCOL_VERSION &&
    item.type === "bootstrap" &&
    typeof item.runtime_id === "string" &&
    item.runtime_id.length > 0 &&
    typeof item.control_socket === "string" &&
    item.control_socket.length > 0 &&
    typeof item.controller_token === "string" &&
    item.controller_token.length >= 32
  );
}

export function isControlEnvelope(value: unknown): value is ControlEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ControlEnvelope>;
  return (
    item.version === PROTOCOL_VERSION &&
    (item.type === "ack" ||
      item.type === "error" ||
      item.type === "state_update") &&
    typeof item.runtime_id === "string" &&
    !!item.state &&
    typeof item.state === "object" &&
    !!item.state.features &&
    typeof item.state.features.revision === "number"
  );
}

export function publicProjection(snapshot: RuntimeSnapshot): PublicState {
  const inference = snapshot.workers.inference;
  let camera: PublicState["camera"] = "off";
  if (snapshot.aggregate === "needs_permission") {
    camera = "needs_permission";
  } else if (snapshot.desired_roles.includes("inference")) {
    camera = inference?.ready ? "active" : "starting";
  }
  return {
    aggregate: snapshot.aggregate,
    features: snapshot.features,
    camera,
    canRecover: Object.values(snapshot.workers).some(
      (worker) =>
        worker.lifecycle === "failed" || worker.lifecycle === "exited",
    ),
  };
}
