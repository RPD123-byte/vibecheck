import { describe, expect, it, vi } from "vitest";

import { InferenceJobRegistry } from "../../src/core/registry";
import {
  executePreparedInferenceJob,
  prepareInferenceJob,
} from "../../src/core/lifecycle";
import { valenceArousalLabelDefinition } from "../../src/operations/valence-arousal-label/definition";
import type { ValenceArousalLabelInput } from "../../src/operations/valence-arousal-label/schemas";
import { InMemoryJobStore } from "../../src/testing/in-memory-job-store";
import {
  createJsonMockLanguageModel,
  resolveStaticLanguageModel,
} from "../../src/testing/mock-language-model";
import { enqueueInference } from "../../src/trigger/enqueue";

const input: ValenceArousalLabelInput = {
  target: {
    url: "https://assets.example.com/target.png?signature=temporary",
    sha256: "a".repeat(64),
    mediaType: "image/png",
  },
  anchors: [
    {
      image: {
        url: "https://assets.example.com/anchor.png?signature=temporary",
        sha256: "b".repeat(64),
        mediaType: "image/png",
      },
      valence: 0.5,
      arousal: -0.25,
    },
  ],
};

describe("enqueueInference", () => {
  it("prepares, dispatches, and correlates a new job", async () => {
    const repository = new InMemoryJobStore();
    const dispatch = vi.fn(async () => ({ runId: "run_123" }));

    const result = await enqueueInference(
      valenceArousalLabelDefinition,
      input,
      { repository, dispatcher: { dispatch } },
    );

    expect(result.disposition).toBe("created");
    expect(result.dispatched).toBe(true);
    expect(result.triggerRunId).toBe("run_123");
    expect(result.job.triggerRunId).toBe("run_123");
    expect(dispatch).toHaveBeenCalledWith({
      jobId: result.job.id,
      semanticIdempotencyKey: result.semanticIdempotencyKey,
    });
  });

  it("does not dispatch a duplicate queued job", async () => {
    const repository = new InMemoryJobStore();
    const dispatch = vi.fn(async () => ({ runId: "run_123" }));

    const first = await enqueueInference(valenceArousalLabelDefinition, input, {
      repository,
      dispatcher: { dispatch },
    });
    const duplicate = await enqueueInference(
      valenceArousalLabelDefinition,
      input,
      { repository, dispatcher: { dispatch } },
    );

    expect(first.job.id).toBe(duplicate.job.id);
    expect(duplicate.disposition).toBe("in_progress");
    expect(duplicate.dispatched).toBe(false);
    expect(duplicate.triggerRunId).toBe("run_123");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("recovers a queued job left undispatched by a prior process crash", async () => {
    const repository = new InMemoryJobStore();
    const prepared = await prepareInferenceJob(
      valenceArousalLabelDefinition,
      input,
      repository,
    );
    expect(prepared.job).toMatchObject({
      status: "queued",
      triggerRunId: null,
    });
    const dispatch = vi.fn(async () => ({ runId: "run_recovered" }));

    const recovered = await enqueueInference(
      valenceArousalLabelDefinition,
      input,
      { repository, dispatcher: { dispatch } },
    );

    expect(recovered.job.id).toBe(prepared.job.id);
    expect(recovered.disposition).toBe("in_progress");
    expect(recovered.dispatched).toBe(true);
    expect(recovered.triggerRunId).toBe("run_recovered");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("returns a completed result without another dispatch", async () => {
    const repository = new InMemoryJobStore();
    const registry = new InferenceJobRegistry();
    registry.register(valenceArousalLabelDefinition);
    const dispatch = vi.fn(async () => ({ runId: "run_123" }));
    const resolveLanguageModel = resolveStaticLanguageModel(
      createJsonMockLanguageModel(() => ({
        valence: 0.2,
        arousal: 0.8,
      })),
    );
    const first = await enqueueInference(valenceArousalLabelDefinition, input, {
      repository,
      dispatcher: { dispatch },
    });

    await executePreparedInferenceJob({
      jobId: first.job.id,
      registry,
      repository,
      resolveLanguageModel,
    });
    const duplicate = await enqueueInference(
      valenceArousalLabelDefinition,
      input,
      { repository, dispatcher: { dispatch } },
    );

    expect(duplicate.disposition).toBe("completed");
    expect(duplicate.dispatched).toBe(false);
    expect(duplicate.output).toEqual({ valence: 0.2, arousal: 0.8 });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("marks a prepared job failed when dispatch fails", async () => {
    const repository = new InMemoryJobStore();
    const dispatchError = new Error("Trigger.dev is unavailable");

    await expect(
      enqueueInference(valenceArousalLabelDefinition, input, {
        repository,
        dispatcher: {
          dispatch: async () => {
            throw dispatchError;
          },
        },
      }),
    ).rejects.toBe(dispatchError);

    const [job] = await repository.list();
    expect(job?.status).toBe("failed");
    expect(job?.errorMessage).toBe("Trigger.dev is unavailable");
  });

  it("does not overwrite a running job when dispatch acceptance is ambiguous", async () => {
    const repository = new InMemoryJobStore();
    const responseLost = new Error("Trigger.dev response was lost");

    await expect(
      enqueueInference(valenceArousalLabelDefinition, input, {
        repository,
        dispatcher: {
          dispatch: async ({ jobId }) => {
            // Models Trigger.dev accepting the task and the task claiming the
            // job before the publisher observes a failed HTTP response.
            await repository.claim(jobId);
            throw responseLost;
          },
        },
      }),
    ).rejects.toBe(responseLost);

    const [job] = await repository.list();
    expect(job?.status).toBe("running");
    expect(job?.errorMessage).toBeNull();
  });

  it("does not fail a queued job already correlated by an accepted task", async () => {
    const repository = new InMemoryJobStore();
    const responseLost = new Error("Trigger.dev response was lost");

    await expect(
      enqueueInference(valenceArousalLabelDefinition, input, {
        repository,
        dispatcher: {
          dispatch: async ({ jobId }) => {
            await repository.attachTriggerRunId(jobId, "run_accepted");
            throw responseLost;
          },
        },
      }),
    ).rejects.toBe(responseLost);

    const [job] = await repository.list();
    expect(job).toMatchObject({
      status: "queued",
      triggerRunId: "run_accepted",
      errorMessage: null,
    });
  });
});
