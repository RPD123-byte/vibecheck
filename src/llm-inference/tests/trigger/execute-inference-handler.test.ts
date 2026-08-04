import { describe, expect, it, vi } from "vitest";

import { prepareInferenceJob } from "../../src/core/lifecycle";
import { InferenceJobRegistry } from "../../src/core/registry";
import { valenceArousalLabelDefinition } from "../../src/operations/valence-arousal-label/definition";
import type { ValenceArousalLabelInput } from "../../src/operations/valence-arousal-label/schemas";
import { InMemoryJobStore } from "../../src/testing/in-memory-job-store";
import {
  createJsonMockLanguageModel,
  resolveStaticLanguageModel,
} from "../../src/testing/mock-language-model";
import { EXECUTE_INFERENCE_TASK_RETRY } from "../../src/trigger/contract";
import { executeInferenceTaskHandler } from "../../src/trigger/execute-inference-handler";

const input: ValenceArousalLabelInput = {
  target: {
    url: "https://assets.example.com/target.webp",
    sha256: "c".repeat(64),
    mediaType: "image/webp",
  },
  anchors: [
    {
      image: {
        url: "https://assets.example.com/anchor.webp",
        sha256: "d".repeat(64),
        mediaType: "image/webp",
      },
      valence: -0.4,
      arousal: 0.6,
    },
  ],
};

async function createPreparedFixture(
  resolveLanguageModel: ReturnType<typeof resolveStaticLanguageModel>,
) {
  const repository = new InMemoryJobStore();
  const registry = new InferenceJobRegistry();
  registry.register(valenceArousalLabelDefinition);
  const prepared = await prepareInferenceJob(
    valenceArousalLabelDefinition,
    input,
    repository,
  );
  return {
    prepared,
    dependencies: { repository, registry, resolveLanguageModel },
  };
}

function createFakeModel(generateCandidate: () => Promise<unknown>): {
  readonly resolveLanguageModel: ReturnType<typeof resolveStaticLanguageModel>;
  readonly generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(generateCandidate);
  const resolveLanguageModel = resolveStaticLanguageModel(
    createJsonMockLanguageModel(generate),
  );
  return { resolveLanguageModel, generate };
}

describe("executeInferenceTaskHandler", () => {
  it("correlates the current Trigger run before executing", async () => {
    const { resolveLanguageModel, generate } = createFakeModel(async () => ({
      valence: 0.1,
      arousal: 0.9,
    }));
    const { prepared, dependencies } =
      await createPreparedFixture(resolveLanguageModel);

    const result = await executeInferenceTaskHandler(
      { jobId: prepared.job.id },
      { triggerRunId: "run_123", attemptNumber: 1 },
      dependencies,
    );

    expect(result.output).toEqual({ valence: 0.1, arousal: 0.9 });
    expect(result.job.status).toBe("completed");
    expect(result.job.triggerRunId).toBe("run_123");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("recovers on the second Trigger attempt using the same failed row", async () => {
    let attempt = 0;
    const { resolveLanguageModel, generate } = createFakeModel(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("transient provider failure");
      }
      return { valence: -0.1, arousal: 0.3 };
    });
    const { prepared, dependencies } =
      await createPreparedFixture(resolveLanguageModel);
    const payload = { jobId: prepared.job.id };

    await expect(
      executeInferenceTaskHandler(
        payload,
        { triggerRunId: "run_retry", attemptNumber: 1 },
        dependencies,
      ),
    ).rejects.toThrow("transient provider failure");
    expect(
      await dependencies.repository.getById(prepared.job.id),
    ).toMatchObject({ status: "failed", triggerRunId: "run_retry" });

    const result = await executeInferenceTaskHandler(
      payload,
      { triggerRunId: "run_retry", attemptNumber: 2 },
      dependencies,
    );

    expect(EXECUTE_INFERENCE_TASK_RETRY).toEqual({ maxAttempts: 2 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.job.status).toBe("completed");
    expect(result.output).toEqual({ valence: -0.1, arousal: 0.3 });
  });

  it("retains terminal failure after both configured task attempts fail", async () => {
    const terminalError = new Error("persistent provider failure");
    const { resolveLanguageModel, generate } = createFakeModel(async () => {
      throw terminalError;
    });
    const { prepared, dependencies } =
      await createPreparedFixture(resolveLanguageModel);
    const payload = { jobId: prepared.job.id };

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
      await expect(
        executeInferenceTaskHandler(
          payload,
          { triggerRunId: "run_terminal", attemptNumber },
          dependencies,
        ),
      ).rejects.toBe(terminalError);
    }

    expect(generate).toHaveBeenCalledTimes(
      EXECUTE_INFERENCE_TASK_RETRY.maxAttempts,
    );
    expect(
      await dependencies.repository.getById(prepared.job.id),
    ).toMatchObject({
      status: "failed",
      errorMessage: "persistent provider failure",
      triggerRunId: "run_terminal",
    });
  });

  it("caps layered execution at six Gemini requests by configuration", () => {
    const providerAttemptsPerTaskAttempt =
      valenceArousalLabelDefinition.config.maxRetries + 1;

    expect(
      EXECUTE_INFERENCE_TASK_RETRY.maxAttempts * providerAttemptsPerTaskAttempt,
    ).toBe(6);
  });

  it("rejects a task run that conflicts with stored correlation", async () => {
    const { resolveLanguageModel, generate } = createFakeModel(async () => ({
      valence: 0,
      arousal: 0,
    }));
    const { prepared, dependencies } =
      await createPreparedFixture(resolveLanguageModel);
    await dependencies.repository.attachTriggerRunId(
      prepared.job.id,
      "run_original",
    );

    await expect(
      executeInferenceTaskHandler(
        { jobId: prepared.job.id },
        { triggerRunId: "run_different", attemptNumber: 1 },
        dependencies,
      ),
    ).rejects.toThrow("different Trigger.dev run");
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects malformed task context before execution", async () => {
    const { resolveLanguageModel, generate } = createFakeModel(async () => ({
      valence: 0,
      arousal: 0,
    }));
    const { prepared, dependencies } =
      await createPreparedFixture(resolveLanguageModel);

    await expect(
      executeInferenceTaskHandler(
        { jobId: prepared.job.id },
        { triggerRunId: "", attemptNumber: 0 },
        dependencies,
      ),
    ).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
  });
});
