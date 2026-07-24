import { describe, expect, it } from "vitest";
import { publicProjection, RuntimeSnapshot } from "./protocol";

function snapshot(): RuntimeSnapshot {
  return {
    aggregate: "active",
    features: {
      revision: 2,
      notch_enabled: true,
      integrations: { codex_enabled: false },
      paused: false,
    },
    desired_roles: ["inference", "notch"],
    effective_roles: ["inference", "notch"],
    workers: {
      inference: {
        lifecycle: "running",
        ready: true,
        restart_count: 0,
        pid: 123,
        stream: "fresh",
        last_error: null,
      },
    },
    errors: [],
  };
}

describe("publicProjection", () => {
  it("exposes controls and aggregate state without private runtime data", () => {
    const value = snapshot();
    Object.assign(value, {
      expression: "disgust",
      confidence: 0.93,
      frame: "pixels",
      conversation: "secret",
    });
    const projected = publicProjection(value);
    expect(projected.camera).toBe("active");
    expect(JSON.stringify(projected)).not.toContain("disgust");
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(JSON.stringify(projected)).not.toContain("123");
  });

  it("projects permission and recovery states", () => {
    const value = snapshot();
    value.aggregate = "needs_permission";
    value.workers.inference!.lifecycle = "failed";
    expect(publicProjection(value)).toMatchObject({
      camera: "needs_permission",
      canRecover: true,
    });
  });
});
