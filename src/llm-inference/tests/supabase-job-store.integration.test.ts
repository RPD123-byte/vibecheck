import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { runInferenceDirect } from "../src/core/lifecycle";
import { valenceArousalLabelDefinition } from "../src/operations/valence-arousal-label";
import type { CreateInferenceJobInput } from "../src/persistence/job-store";
import { SupabaseJobStore } from "../src/persistence/supabase-job-store";
import type { Database } from "../../../supabase/database.types";
import {
  createJsonMockLanguageModel,
  resolveStaticLanguageModel,
} from "../src/testing/mock-language-model";

const integrationEnabled = process.env.RUN_SUPABASE_INTEGRATION === "1";

function integrationStore(): SupabaseJobStore {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || serviceRoleKey === undefined) {
    throw new Error(
      "Supabase integration tests require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  const client = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    db: { schema: "public" },
  });
  return new SupabaseJobStore(client);
}

function newJobInput(): CreateInferenceJobInput {
  const digest = randomBytes(32).toString("hex");
  return {
    userId: null,
    jobType: "valence_arousal_label",
    definitionVersion: 1,
    semanticIdempotencyKey: digest,
    input: {
      target: {
        kind: "https",
        url: `https://example.test/${randomUUID()}.png`,
        sha256: digest,
      },
      anchors: [],
    },
  };
}

describe.runIf(integrationEnabled)("SupabaseJobStore", () => {
  it("runs and reuses the typed valence/arousal lifecycle against Postgres", async () => {
    const repository = integrationStore();
    const targetDigest = randomBytes(32).toString("hex");
    const anchorDigest = randomBytes(32).toString("hex");
    const input = {
      target: {
        url: `https://example.test/${randomUUID()}/target.webp?signature=one`,
        sha256: targetDigest,
        mediaType: "image/webp" as const,
      },
      anchors: [
        {
          image: {
            url: `https://example.test/${randomUUID()}/anchor.webp?signature=one`,
            sha256: anchorDigest,
            mediaType: "image/webp" as const,
          },
          valence: -0.2,
          arousal: 0.8,
        },
      ],
    };
    let modelCalls = 0;
    const resolveLanguageModel = resolveStaticLanguageModel(
      createJsonMockLanguageModel(() => {
        modelCalls += 1;
        return { valence: 0.25, arousal: 0.75 };
      }),
    );

    const first = await runInferenceDirect(
      valenceArousalLabelDefinition,
      input,
      { repository, resolveLanguageModel },
    );
    const reused = await runInferenceDirect(
      valenceArousalLabelDefinition,
      {
        ...input,
        target: {
          ...input.target,
          url: `https://different.example.test/target.webp?signature=two`,
        },
      },
      { repository, resolveLanguageModel },
    );

    expect(first).toMatchObject({
      reused: false,
      output: { valence: 0.25, arousal: 0.75 },
      job: { status: "completed" },
    });
    expect(reused).toMatchObject({
      reused: true,
      output: { valence: 0.25, arousal: 0.75 },
      job: { id: first.job.id, status: "completed" },
    });
    expect(modelCalls).toBe(1);
  });

  it("atomically converges concurrent preparation on one logical row", async () => {
    const repository = integrationStore();
    const input = newJobInput();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => repository.createOrGet(input)),
    );

    expect(new Set(results.map(({ job }) => job.id)).size).toBe(1);
    expect(results.filter(({ created }) => created)).toHaveLength(1);
    expect(results.every(({ job }) => job.status === "queued")).toBe(true);
  });

  it("allows exactly one concurrent claim and requires its exact version", async () => {
    const repository = integrationStore();
    const prepared = await repository.createOrGet(newJobInput());
    const claims = await Promise.all(
      Array.from({ length: 20 }, () => repository.claim(prepared.job.id)),
    );
    const winners = claims.filter((job) => job !== null);

    expect(winners).toHaveLength(1);
    const claimed = winners[0];
    expect(claimed).toBeDefined();
    if (claimed === undefined) {
      throw new Error("Expected one claimed job");
    }

    const correlated = await repository.attachTriggerRunId(
      claimed.id,
      `run_${randomUUID()}`,
    );
    expect(correlated).toMatchObject({
      status: "running",
      updatedAt: claimed.updatedAt,
    });

    expect(
      await repository.complete(claimed.id, prepared.job.updatedAt, {
        valence: 0.1,
        arousal: 0.2,
      }),
    ).toBeNull();

    const completed = await repository.complete(claimed.id, claimed.updatedAt, {
      valence: 0.1,
      arousal: 0.2,
    });
    expect(completed?.status).toBe("completed");
    expect(completed?.output).toEqual({ valence: 0.1, arousal: 0.2 });
    expect(completed?.triggerRunId).toBe(correlated?.triggerRunId);

    const reused = await repository.createOrGet({
      ...newJobInput(),
      semanticIdempotencyKey: prepared.job.semanticIdempotencyKey,
      jobType: prepared.job.jobType,
      definitionVersion: prepared.job.definitionVersion,
    });
    expect(reused.created).toBe(false);
    expect(reused.job.id).toBe(prepared.job.id);
    expect(reused.job.status).toBe("completed");
  });

  it("bounds failures, rejects stale owners, and explicitly requeues", async () => {
    const repository = integrationStore();
    const prepared = await repository.createOrGet(newJobInput());
    const attached = await repository.attachTriggerRunId(
      prepared.job.id,
      `run_${randomUUID()}`,
    );
    expect(attached).not.toBeNull();

    const attachedAgain = await repository.attachTriggerRunId(
      prepared.job.id,
      attached?.triggerRunId ?? "missing",
    );
    expect(attachedAgain?.updatedAt).toBe(attached?.updatedAt);
    expect(
      await repository.attachTriggerRunId(
        prepared.job.id,
        `different_${randomUUID()}`,
      ),
    ).toBeNull();

    const claimed = await repository.claim(prepared.job.id);
    expect(claimed).not.toBeNull();
    if (claimed === null) {
      throw new Error("Expected job claim");
    }

    expect(await repository.fail(claimed.id, "unclaimed failure")).toBeNull();

    const failed = await repository.fail(
      claimed.id,
      "x".repeat(3_000),
      claimed.updatedAt,
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.errorMessage).toHaveLength(2_048);

    expect(
      await repository.complete(claimed.id, claimed.updatedAt, {
        valence: 0,
        arousal: 0,
      }),
    ).toBeNull();

    const refreshedInput = { refreshed: true };
    const requeued = await repository.requeueFailed(claimed.id, refreshedInput);
    expect(requeued).toMatchObject({
      status: "queued",
      input: refreshedInput,
      output: null,
      errorMessage: null,
      triggerRunId: null,
    });

    const secondClaim = await repository.claim(claimed.id);
    expect(secondClaim).not.toBeNull();
    if (secondClaim === null) {
      throw new Error("Expected retried claim");
    }
    expect(
      await repository.complete(secondClaim.id, claimed.updatedAt, {
        valence: 0,
        arousal: 0,
      }),
    ).toBeNull();
    expect(
      await repository.complete(secondClaim.id, secondClaim.updatedAt, {
        valence: -0.4,
        arousal: 0.7,
      }),
    ).toMatchObject({ status: "completed" });
  });
});
