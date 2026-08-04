import { randomUUID } from "node:crypto";

import type { JsonValue } from "../core/json";
import type {
  CreateInferenceJobInput,
  CreateOrGetInferenceJobResult,
  InferenceJobRecord,
  InferenceJobStore,
} from "../persistence/job-store";

export class InMemoryJobStore implements InferenceJobStore {
  readonly #jobs = new Map<string, InferenceJobRecord>();
  readonly #idsBySemanticKey = new Map<string, string>();
  #logicalClock = Date.now();

  async createOrGet(
    input: CreateInferenceJobInput,
  ): Promise<CreateOrGetInferenceJobResult> {
    const existingId = this.#idsBySemanticKey.get(input.semanticIdempotencyKey);
    if (existingId !== undefined) {
      const existing = this.#jobs.get(existingId);
      if (existing === undefined) {
        throw new Error("In-memory job index is inconsistent");
      }
      return { job: existing, created: false };
    }

    const now = this.#now();
    const job: InferenceJobRecord = {
      id: randomUUID(),
      userId: input.userId,
      jobType: input.jobType,
      definitionVersion: input.definitionVersion,
      semanticIdempotencyKey: input.semanticIdempotencyKey,
      status: "queued",
      input: input.input,
      output: null,
      errorMessage: null,
      triggerRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#jobs.set(job.id, job);
    this.#idsBySemanticKey.set(job.semanticIdempotencyKey, job.id);
    return { job, created: true };
  }

  async getById(jobId: string): Promise<InferenceJobRecord | null> {
    return this.#jobs.get(jobId) ?? null;
  }

  async requeueFailed(
    jobId: string,
    input: JsonValue,
  ): Promise<InferenceJobRecord | null> {
    return this.#transition(jobId, ["failed"], {
      status: "queued",
      input,
      output: null,
      errorMessage: null,
      triggerRunId: null,
    });
  }

  async claim(jobId: string): Promise<InferenceJobRecord | null> {
    return this.#transition(jobId, ["queued", "failed"], {
      status: "running",
      errorMessage: null,
    });
  }

  async complete(
    jobId: string,
    claimVersion: string,
    output: JsonValue,
  ): Promise<InferenceJobRecord | null> {
    return this.#transition(
      jobId,
      ["running"],
      {
        status: "completed",
        output,
        errorMessage: null,
      },
      claimVersion,
    );
  }

  async fail(
    jobId: string,
    errorMessage: string,
    claimVersion?: string,
  ): Promise<InferenceJobRecord | null> {
    const current = this.#jobs.get(jobId);
    if (claimVersion === undefined && current?.triggerRunId !== null) {
      return null;
    }
    return this.#transition(
      jobId,
      claimVersion === undefined ? ["queued"] : ["running"],
      {
        status: "failed",
        errorMessage,
      },
      claimVersion,
    );
  }

  async attachTriggerRunId(
    jobId: string,
    triggerRunId: string,
  ): Promise<InferenceJobRecord | null> {
    const current = this.#jobs.get(jobId);
    if (current === undefined) {
      return null;
    }
    if (current.triggerRunId === triggerRunId) return current;
    if (current.triggerRunId !== null) {
      return null;
    }
    const correlated = { ...current, triggerRunId };
    this.#jobs.set(correlated.id, correlated);
    return correlated;
  }

  async seed(job: InferenceJobRecord): Promise<void> {
    this.#jobs.set(job.id, job);
    this.#idsBySemanticKey.set(job.semanticIdempotencyKey, job.id);
  }

  async list(): Promise<readonly InferenceJobRecord[]> {
    return [...this.#jobs.values()];
  }

  #transition(
    jobId: string,
    allowedStatuses: readonly InferenceJobRecord["status"][],
    patch: Partial<InferenceJobRecord>,
    expectedUpdatedAt?: string,
  ): InferenceJobRecord | null {
    const current = this.#jobs.get(jobId);
    if (
      current === undefined ||
      !allowedStatuses.includes(current.status) ||
      (expectedUpdatedAt !== undefined &&
        current.updatedAt !== expectedUpdatedAt)
    ) {
      return null;
    }
    return this.#replace(current, patch);
  }

  #replace(
    current: InferenceJobRecord,
    patch: Partial<InferenceJobRecord>,
  ): InferenceJobRecord {
    const next = {
      ...current,
      ...patch,
      updatedAt: this.#now(),
    };
    this.#jobs.set(next.id, next);
    return next;
  }

  #now(): string {
    this.#logicalClock += 1;
    return new Date(this.#logicalClock).toISOString();
  }
}
