import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineInferenceJob } from "../src/core/definition";
import {
  InferenceJobInProgressError,
  InferenceJobStateError,
} from "../src/core/errors";
import { prepareInferenceJob, runInferenceDirect } from "../src/core/lifecycle";
import type { JsonValue } from "../src/core/json";
import type {
  InferenceJobRecord,
  InferenceJobStore,
} from "../src/persistence/job-store";
import { InMemoryJobStore } from "../src/testing/in-memory-job-store";
import {
  createJsonMockLanguageModel,
  resolveStaticLanguageModel,
} from "../src/testing/mock-language-model";

const testDefinition = defineInferenceJob({
  jobType: "test_lifecycle",
  definitionVersion: 1,
  inputSchema: z.object({ value: z.string() }).strict(),
  outputSchema: z.object({ label: z.string() }).strict(),
  config: { provider: "google", model: "fake", maxRetries: 0 },
  outputName: "test_lifecycle",
  buildMessages: (input) => [
    {
      role: "user",
      content: [{ type: "text", text: input.value }],
    },
  ],
  semanticIdentity: (input) => input,
});

function successfulModelResolver(onCall?: () => void) {
  return resolveStaticLanguageModel(
    createJsonMockLanguageModel(() => {
      onCall?.();
      return { label: "accepted" };
    }),
  );
}

async function onlyJob(
  repository: InMemoryJobStore,
): Promise<InferenceJobRecord> {
  const jobs = await repository.list();
  expect(jobs).toHaveLength(1);
  const job = jobs[0];
  if (job === undefined) {
    throw new Error("Expected one job");
  }
  return job;
}

describe("job preparation", () => {
  it("rejects invalid input before repository side effects", async () => {
    let createCalls = 0;
    const repository: InferenceJobStore = {
      async createOrGet() {
        createCalls += 1;
        throw new Error("should not be called");
      },
      async getById() {
        return null;
      },
      async requeueFailed() {
        return null;
      },
      async claim() {
        return null;
      },
      async complete() {
        return null;
      },
      async fail() {
        return null;
      },
      async attachTriggerRunId() {
        return null;
      },
    };

    await expect(
      prepareInferenceJob(testDefinition, { value: 1 } as never, repository),
    ).rejects.toThrow();
    expect(createCalls).toBe(0);
  });

  it("rejects non-JSON schema output before persistence", async () => {
    const repository = new InMemoryJobStore();
    const nonJsonDefinition = defineInferenceJob({
      jobType: "non_json_input",
      definitionVersion: 1,
      inputSchema: z.object({ capturedAt: z.date() }).strict(),
      outputSchema: z.object({ label: z.string() }).strict(),
      config: { provider: "google", model: "fake" },
      outputName: "non_json_input",
      buildMessages: () => [],
      semanticIdentity: (input) => input,
    });

    await expect(
      prepareInferenceJob(
        nonJsonDefinition,
        { capturedAt: new Date("2026-01-01T00:00:00.000Z") },
        repository,
      ),
    ).rejects.toThrow("must be JSON-compatible");
    expect(await repository.list()).toHaveLength(0);
  });

  it("validates an optional user identity before persistence", async () => {
    const repository = new InMemoryJobStore();

    await expect(
      prepareInferenceJob(testDefinition, { value: "identity" }, repository, {
        userId: "not-a-uuid",
      }),
    ).rejects.toThrow();
    expect(await repository.list()).toHaveLength(0);
  });

  it("returns an existing in-progress identity without a second row", async () => {
    const repository = new InMemoryJobStore();
    const first = await prepareInferenceJob(
      testDefinition,
      { value: "same" },
      repository,
    );
    const second = await prepareInferenceJob(
      testDefinition,
      { value: "same" },
      repository,
    );

    expect(first.disposition).toBe("created");
    expect(second.disposition).toBe("in_progress");
    expect(second.job.id).toBe(first.job.id);
    expect(await repository.list()).toHaveLength(1);
  });
});

describe("direct inference lifecycle", () => {
  it("validates output and completes a governed job", async () => {
    const repository = new InMemoryJobStore();
    const result = await runInferenceDirect(
      testDefinition,
      { value: "hello" },
      { repository, resolveLanguageModel: successfulModelResolver() },
    );

    expect(result.output).toEqual({ label: "accepted" });
    expect(result.reused).toBe(false);
    expect(result.job.status).toBe("completed");
    expect((await onlyJob(repository)).output).toEqual({
      label: "accepted",
    });
  });

  it("reuses schema-valid completed output without invoking the model", async () => {
    const repository = new InMemoryJobStore();
    let modelCalls = 0;
    const resolveLanguageModel = successfulModelResolver(() => {
      modelCalls += 1;
    });

    await runInferenceDirect(
      testDefinition,
      { value: "same" },
      {
        repository,
        resolveLanguageModel,
      },
    );
    const reused = await runInferenceDirect(
      testDefinition,
      { value: "same" },
      { repository, resolveLanguageModel },
    );

    expect(reused.reused).toBe(true);
    expect(reused.output).toEqual({ label: "accepted" });
    expect(modelCalls).toBe(1);
  });

  it("records malformed output as a bounded failed job", async () => {
    const repository = new InMemoryJobStore();
    const resolveLanguageModel = resolveStaticLanguageModel(
      createJsonMockLanguageModel(() => ({ wrong: true })),
    );

    await expect(
      runInferenceDirect(
        testDefinition,
        { value: "bad" },
        {
          repository,
          resolveLanguageModel,
        },
      ),
    ).rejects.toThrow();
    const failed = await onlyJob(repository);
    expect(failed.status).toBe("failed");
    expect(failed.errorMessage).toBeTruthy();
    expect(failed.errorMessage?.length).toBeLessThanOrEqual(2_048);
  });

  it("records provider failures and explicitly requeues on retry", async () => {
    const repository = new InMemoryJobStore();
    let calls = 0;
    const resolveLanguageModel = resolveStaticLanguageModel(
      createJsonMockLanguageModel(() => {
        calls += 1;
        if (calls === 1) {
          throw new Error("transient provider failure");
        }
        return { label: "recovered" };
      }),
    );

    await expect(
      runInferenceDirect(
        testDefinition,
        { value: "retry" },
        {
          repository,
          resolveLanguageModel,
        },
      ),
    ).rejects.toThrow("transient provider failure");
    expect((await onlyJob(repository)).status).toBe("failed");

    const retried = await runInferenceDirect(
      testDefinition,
      { value: "retry" },
      { repository, resolveLanguageModel },
    );
    expect(retried.output).toEqual({ label: "recovered" });
    expect(retried.job.status).toBe("completed");
    expect(calls).toBe(2);
    expect(await repository.list()).toHaveLength(1);
  });

  it("preserves a completion persistence failure and leaves a failed job", async () => {
    class RejectingCompletionStore extends InMemoryJobStore {
      override async complete(
        _jobId: string,
        _claimVersion: string,
        _output: JsonValue,
      ): Promise<null> {
        return null;
      }
    }

    const repository = new RejectingCompletionStore();
    await expect(
      runInferenceDirect(
        testDefinition,
        { value: "persist" },
        {
          repository,
          resolveLanguageModel: successfulModelResolver(),
        },
      ),
    ).rejects.toThrow(InferenceJobStateError);
    expect((await onlyJob(repository)).status).toBe("failed");
  });

  it("allows only one concurrent executor to invoke the model", async () => {
    const repository = new InMemoryJobStore();
    let calls = 0;
    let releaseProvider: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const resolveLanguageModel = resolveStaticLanguageModel(
      createJsonMockLanguageModel(async () => {
        calls += 1;
        await gate;
        return { label: "once" };
      }),
    );

    const first = runInferenceDirect(
      testDefinition,
      { value: "concurrent" },
      { repository, resolveLanguageModel },
    );
    const second = runInferenceDirect(
      testDefinition,
      { value: "concurrent" },
      { repository, resolveLanguageModel },
    );
    const settledPromise = Promise.allSettled([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseProvider?.();

    const settled = await settledPromise;
    expect(calls).toBe(1);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = settled.find((item) => item.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(InferenceJobInProgressError),
    });
  });

  it("rejects stale completion ownership after a failed job is reclaimed", async () => {
    const repository = new InMemoryJobStore();
    const prepared = await prepareInferenceJob(
      testDefinition,
      { value: "ownership" },
      repository,
    );
    const firstClaim = await repository.claim(prepared.job.id);
    expect(firstClaim).not.toBeNull();
    if (firstClaim === null) return;

    await repository.fail(firstClaim.id, "retry", firstClaim.updatedAt);
    const secondClaim = await repository.claim(prepared.job.id);
    expect(secondClaim).not.toBeNull();
    if (secondClaim === null) return;

    await expect(
      repository.complete(firstClaim.id, firstClaim.updatedAt, {
        label: "stale",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.complete(secondClaim.id, secondClaim.updatedAt, {
        label: "owner",
      }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("does not invalidate a claim when Trigger correlation arrives concurrently", async () => {
    const repository = new InMemoryJobStore();
    const prepared = await prepareInferenceJob(
      testDefinition,
      { value: "correlation-race" },
      repository,
    );
    const claimed = await repository.claim(prepared.job.id);
    expect(claimed).not.toBeNull();
    if (claimed === null) return;

    const correlated = await repository.attachTriggerRunId(
      claimed.id,
      "run_concurrent",
    );
    expect(correlated).toMatchObject({
      status: "running",
      triggerRunId: "run_concurrent",
      updatedAt: claimed.updatedAt,
    });
    await expect(
      repository.complete(claimed.id, claimed.updatedAt, { label: "owner" }),
    ).resolves.toMatchObject({
      status: "completed",
      triggerRunId: "run_concurrent",
    });
  });
});
