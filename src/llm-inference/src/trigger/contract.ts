import { z } from "zod";

export const EXECUTE_INFERENCE_TASK_ID = "execute-llm-inference" as const;

export const EXECUTE_INFERENCE_TASK_RETRY = Object.freeze({
  maxAttempts: 2,
} as const);

export const executeInferenceTaskPayloadSchema = z.strictObject({
  jobId: z.uuid(),
});

export const semanticIdempotencyKeySchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hex digest");

export type ExecuteInferenceTaskPayload = z.output<
  typeof executeInferenceTaskPayloadSchema
>;
