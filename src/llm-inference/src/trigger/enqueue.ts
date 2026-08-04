import type { InferenceJobDefinition } from "../core/definition";
import type { z } from "zod";
import { boundedErrorMessage, InferenceJobStateError } from "../core/errors";
import {
  prepareInferenceJob,
  type PreparedJobDisposition,
} from "../core/lifecycle";
import type {
  InferenceJobRecord,
  InferenceJobStore,
} from "../persistence/job-store";
import type { InferenceTaskDispatcher } from "./dispatcher";

export interface EnqueueInferenceDependencies {
  readonly repository: InferenceJobStore;
  readonly dispatcher: InferenceTaskDispatcher;
  readonly userId?: string | null;
}

export interface EnqueueInferenceResult<TOutput> {
  readonly job: InferenceJobRecord;
  readonly semanticIdempotencyKey: string;
  readonly disposition: PreparedJobDisposition;
  readonly dispatched: boolean;
  readonly triggerRunId: string | null;
  readonly output?: TOutput;
}

export async function enqueueInference<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  input: z.input<TInputSchema>,
  dependencies: EnqueueInferenceDependencies,
): Promise<EnqueueInferenceResult<z.output<TOutputSchema>>> {
  const prepared = await prepareInferenceJob(
    definition,
    input,
    dependencies.repository,
    {
      ...(dependencies.userId === undefined
        ? {}
        : { userId: dependencies.userId }),
      retryFailed: true,
    },
  );

  const needsDispatch =
    prepared.disposition === "created" ||
    prepared.disposition === "requeued" ||
    (prepared.job.status === "queued" && prepared.job.triggerRunId === null);

  if (!needsDispatch) {
    return {
      job: prepared.job,
      semanticIdempotencyKey: prepared.semanticIdempotencyKey,
      disposition: prepared.disposition,
      dispatched: false,
      triggerRunId: prepared.job.triggerRunId,
      ...(prepared.output === undefined ? {} : { output: prepared.output }),
    };
  }

  let runId: string;
  try {
    ({ runId } = await dependencies.dispatcher.dispatch({
      jobId: prepared.job.id,
      semanticIdempotencyKey: prepared.semanticIdempotencyKey,
    }));
  } catch (error) {
    try {
      await dependencies.repository.fail(
        prepared.job.id,
        boundedErrorMessage(error),
      );
    } catch {
      // Preserve the dispatch failure if recording it also fails.
    }
    throw error;
  }

  const correlated = await dependencies.repository.attachTriggerRunId(
    prepared.job.id,
    runId,
  );
  const current =
    correlated ?? (await dependencies.repository.getById(prepared.job.id));
  if (
    current !== null &&
    current.triggerRunId !== null &&
    current.triggerRunId !== runId
  ) {
    throw new InferenceJobStateError(
      `Inference job ${prepared.job.id} is already correlated with a different Trigger.dev run`,
    );
  }

  return {
    job: current ?? prepared.job,
    semanticIdempotencyKey: prepared.semanticIdempotencyKey,
    disposition: prepared.disposition,
    dispatched: true,
    triggerRunId: runId,
  };
}
