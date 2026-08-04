import type { JsonValue } from "../core/json";

export type InferenceJobStatus = "queued" | "running" | "completed" | "failed";

export interface InferenceJobRecord {
  readonly id: string;
  readonly userId: string | null;
  readonly jobType: string;
  readonly definitionVersion: number;
  readonly semanticIdempotencyKey: string;
  readonly status: InferenceJobStatus;
  readonly input: JsonValue;
  readonly output: JsonValue | null;
  readonly errorMessage: string | null;
  readonly triggerRunId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateInferenceJobInput {
  readonly userId: string | null;
  readonly jobType: string;
  readonly definitionVersion: number;
  readonly semanticIdempotencyKey: string;
  readonly input: JsonValue;
}

export interface CreateOrGetInferenceJobResult {
  readonly job: InferenceJobRecord;
  readonly created: boolean;
}

export interface InferenceJobStore {
  createOrGet(
    input: CreateInferenceJobInput,
  ): Promise<CreateOrGetInferenceJobResult>;
  getById(jobId: string): Promise<InferenceJobRecord | null>;
  requeueFailed(
    jobId: string,
    input: JsonValue,
  ): Promise<InferenceJobRecord | null>;
  claim(jobId: string): Promise<InferenceJobRecord | null>;
  complete(
    jobId: string,
    claimVersion: string,
    output: JsonValue,
  ): Promise<InferenceJobRecord | null>;
  fail(
    jobId: string,
    errorMessage: string,
    claimVersion?: string,
  ): Promise<InferenceJobRecord | null>;
  attachTriggerRunId(
    jobId: string,
    triggerRunId: string,
  ): Promise<InferenceJobRecord | null>;
}
