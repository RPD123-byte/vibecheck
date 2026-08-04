import { z } from "zod";

import { InferenceJobStateError } from "../core/errors";
import {
  executePreparedInferenceJob,
  type InferenceRunResult,
} from "../core/lifecycle";
import type { InferenceJobRegistry } from "../core/registry";
import type { ResolveLanguageModel } from "../core/model-resolver";
import type { InferenceJobStore } from "../persistence/job-store";
import {
  executeInferenceTaskPayloadSchema,
  type ExecuteInferenceTaskPayload,
} from "./contract";

const executeInferenceTaskContextSchema = z.strictObject({
  triggerRunId: z.string().trim().min(1),
  attemptNumber: z.number().int().positive(),
});

export interface ExecuteInferenceTaskContext {
  readonly triggerRunId: string;
  readonly attemptNumber: number;
}

export interface ExecuteInferenceTaskDependencies {
  readonly registry: InferenceJobRegistry;
  readonly repository: InferenceJobStore;
  readonly resolveLanguageModel: ResolveLanguageModel;
}

export async function executeInferenceTaskHandler(
  rawPayload: ExecuteInferenceTaskPayload,
  rawContext: ExecuteInferenceTaskContext,
  dependencies: ExecuteInferenceTaskDependencies,
): Promise<InferenceRunResult<unknown>> {
  const payload = executeInferenceTaskPayloadSchema.parse(rawPayload);
  const context = executeInferenceTaskContextSchema.parse(rawContext);
  const job = await dependencies.repository.getById(payload.jobId);

  if (job === null) {
    throw new InferenceJobStateError(
      `Inference job does not exist: ${payload.jobId}`,
    );
  }

  if (job.triggerRunId === null) {
    const attached = await dependencies.repository.attachTriggerRunId(
      job.id,
      context.triggerRunId,
    );
    if (attached === null) {
      const current = await dependencies.repository.getById(job.id);
      if (current?.triggerRunId !== context.triggerRunId) {
        throw new InferenceJobStateError(
          `Could not correlate inference job ${job.id} with Trigger.dev run ${context.triggerRunId}`,
        );
      }
    }
  } else if (job.triggerRunId !== context.triggerRunId) {
    throw new InferenceJobStateError(
      `Inference job ${job.id} is already correlated with a different Trigger.dev run`,
    );
  }

  return executePreparedInferenceJob({
    jobId: payload.jobId,
    registry: dependencies.registry,
    repository: dependencies.repository,
    resolveLanguageModel: dependencies.resolveLanguageModel,
  });
}
