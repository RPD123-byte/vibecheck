import { randomBytes } from "node:crypto";
import type { TargetApplication, TargetRecord } from "./types";

const FIRST_DEBUG_PORT = 43_000;
const LAST_DEBUG_PORT = 49_999;

export class TargetRegistry {
  private readonly records = new Map<string, TargetRecord>();
  private readonly usedPorts = new Set<number>();
  private readonly managedPorts = new Map<number, string>();

  prepare(targets: TargetApplication[]): void {
    for (const target of targets) {
      const port = validManagedPort(target.managed_debug_port);
      const marker = validManagedMarker(target.managed_ownership_marker);
      if (
        port === null ||
        marker === null ||
        (this.usedPorts.has(port) &&
          this.managedPorts.get(port) !== target.bundle_id)
      ) {
        continue;
      }
      this.usedPorts.add(port);
      this.managedPorts.set(port, target.bundle_id);
    }
  }

  observe(target: TargetApplication): TargetRecord {
    const existing = this.records.get(target.bundle_id);
    if (existing) {
      existing.name = target.name;
      existing.bundle_path = target.bundle_path;
      existing.pid = target.pid;
      return existing;
    }
    const candidateManagedPort = validManagedPort(target.managed_debug_port);
    const managedPort =
      candidateManagedPort !== null &&
      (!this.usedPorts.has(candidateManagedPort) ||
        this.managedPorts.get(candidateManagedPort) === target.bundle_id)
        ? candidateManagedPort
        : null;
    const managedMarker = validManagedMarker(target.managed_ownership_marker);
    const inheritedManagedLaunch =
      managedPort !== null && managedMarker !== null;
    if (managedPort !== null) {
      this.usedPorts.add(managedPort);
      this.managedPorts.set(managedPort, target.bundle_id);
    }
    const record: TargetRecord = {
      ...target,
      debug_port: managedPort ?? this.allocatePort(),
      ownership_marker: managedMarker ?? randomBytes(16).toString("hex"),
      enrolled: false,
      attached: false,
      status: inheritedManagedLaunch ? "managed" : "discovered",
      last_error: null,
    };
    this.records.set(target.bundle_id, record);
    return record;
  }

  enroll(bundleId: string): TargetRecord {
    const record = this.require(bundleId);
    record.enrolled = true;
    return record;
  }

  mark(
    bundleId: string,
    status: TargetRecord["status"],
    error: string | null = null,
  ): TargetRecord {
    const record = this.require(bundleId);
    record.status = status;
    record.attached = status === "attached";
    record.last_error = error;
    return record;
  }

  reconcileRunning(bundleIds: ReadonlySet<string>): void {
    for (const record of this.records.values()) {
      if (
        bundleIds.has(record.bundle_id) ||
        record.status === "relaunching" ||
        record.status === "attaching"
      ) {
        continue;
      }
      record.status = "stopped";
      record.attached = false;
      record.last_error = null;
    }
  }

  enrolled(): TargetRecord[] {
    return [...this.records.values()].filter((record) => record.enrolled);
  }

  all(): TargetRecord[] {
    return [...this.records.values()];
  }

  get(bundleId: string): TargetRecord | undefined {
    return this.records.get(bundleId);
  }

  private require(bundleId: string): TargetRecord {
    const record = this.records.get(bundleId);
    if (!record) throw new Error(`unknown target bundle ${bundleId}`);
    return record;
  }

  private allocatePort(): number {
    for (let port = FIRST_DEBUG_PORT; port <= LAST_DEBUG_PORT; port += 1) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error("no component debugging ports remain");
  }
}

function validManagedPort(value: unknown): number | null {
  return Number.isInteger(value) &&
    Number(value) >= FIRST_DEBUG_PORT &&
    Number(value) <= LAST_DEBUG_PORT
    ? Number(value)
    : null;
}

function validManagedMarker(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value)
    ? value
    : null;
}
