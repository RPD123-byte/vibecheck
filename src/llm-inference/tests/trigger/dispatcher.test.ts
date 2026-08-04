import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { TriggerDevInferenceTaskDispatcher } from "../../src/trigger/dispatcher";
import type { TriggerDevSdkAdapter } from "../../src/trigger/dispatcher";

const semanticKey = "a".repeat(64);

describe("TriggerDevInferenceTaskDispatcher", () => {
  it("dispatches only the job ID with globally scoped semantic idempotency", async () => {
    const createIdempotencyKey = vi.fn(async () => "trigger-key");
    const triggerTask = vi.fn(async () => ({ id: "run_123" }));
    const sdk: TriggerDevSdkAdapter = {
      createIdempotencyKey,
      triggerTask,
    };
    const dispatcher = new TriggerDevInferenceTaskDispatcher(sdk);
    const jobId = randomUUID();

    await expect(
      dispatcher.dispatch({
        jobId,
        semanticIdempotencyKey: semanticKey,
      }),
    ).resolves.toEqual({ runId: "run_123" });

    expect(createIdempotencyKey).toHaveBeenCalledWith(semanticKey, {
      scope: "global",
    });
    expect(triggerTask).toHaveBeenCalledWith(
      { jobId },
      { idempotencyKey: "trigger-key" },
    );
  });

  it("rejects malformed identifiers before touching Trigger.dev", async () => {
    const createIdempotencyKey = vi.fn(async () => "trigger-key");
    const triggerTask = vi.fn(async () => ({ id: "run_123" }));
    const dispatcher = new TriggerDevInferenceTaskDispatcher({
      createIdempotencyKey,
      triggerTask,
    });

    await expect(
      dispatcher.dispatch({
        jobId: "not-a-uuid",
        semanticIdempotencyKey: semanticKey,
      }),
    ).rejects.toThrow();
    await expect(
      dispatcher.dispatch({
        jobId: randomUUID(),
        semanticIdempotencyKey: "not-a-semantic-key",
      }),
    ).rejects.toThrow();

    expect(createIdempotencyKey).not.toHaveBeenCalled();
    expect(triggerTask).not.toHaveBeenCalled();
  });

  it("rejects an invalid run handle", async () => {
    const dispatcher = new TriggerDevInferenceTaskDispatcher({
      createIdempotencyKey: async () => "trigger-key",
      triggerTask: async () => ({ id: " " }),
    });

    await expect(
      dispatcher.dispatch({
        jobId: randomUUID(),
        semanticIdempotencyKey: semanticKey,
      }),
    ).rejects.toThrow("Trigger.dev returned an invalid run ID");
  });
});
