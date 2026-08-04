import type {
  AnyInferenceJobDefinition,
  InferenceJobDefinition,
} from "./definition";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  boundedErrorMessage,
  InferenceJobInProgressError,
  InferenceJobStateError,
} from "./errors";
import { normalizeJsonValue } from "./json";
import type { ResolveLanguageModel } from "./model-resolver";
import type { InferenceJobRegistry } from "./registry";
import { createSemanticIdempotencyKey } from "./semantic-key";
import type {
  InferenceJobRecord,
  InferenceJobStore,
} from "../persistence/job-store";

export type PreparedJobDisposition =
  "created" | "requeued" | "completed" | "in_progress" | "failed";

export interface PreparedInferenceJob<TInput, TOutput> {
  readonly job: InferenceJobRecord;
  readonly input: TInput;
  readonly semanticIdempotencyKey: string;
  readonly disposition: PreparedJobDisposition;
  readonly output?: TOutput;
}

export interface PrepareInferenceJobOptions {
  readonly userId?: string | null;
  readonly retryFailed?: boolean;
}

export interface InferenceRunResult<TOutput> {
  readonly job: InferenceJobRecord;
  readonly output: TOutput;
  readonly reused: boolean;
}

function parseCompletedOutput<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  job: InferenceJobRecord,
): z.output<TOutputSchema> {
  if (job.output === null) {
    throw new InferenceJobStateError(
      `Completed inference job has no output: ${job.id}`,
    );
  }
  return definition.outputSchema.parse(job.output);
}

export async function prepareInferenceJob<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  rawInput: z.input<TInputSchema>,
  repository: InferenceJobStore,
  options: PrepareInferenceJobOptions = {},
): Promise<
  PreparedInferenceJob<z.output<TInputSchema>, z.output<TOutputSchema>>
> {
  const input = definition.inputSchema.parse(rawInput);
  const normalizedInput = normalizeJsonValue(input);
  const userId = z
    .uuid()
    .nullable()
    .parse(options.userId ?? null);
  const semanticIdempotencyKey = createSemanticIdempotencyKey(
    definition,
    input,
  );
  const prepared = await repository.createOrGet({
    userId,
    jobType: definition.jobType,
    definitionVersion: definition.definitionVersion,
    semanticIdempotencyKey,
    input: normalizedInput,
  });

  if (
    prepared.job.semanticIdempotencyKey !== semanticIdempotencyKey ||
    prepared.job.jobType !== definition.jobType ||
    prepared.job.definitionVersion !== definition.definitionVersion
  ) {
    throw new InferenceJobStateError(
      `Inference job identity does not match its registered definition: ${prepared.job.id}`,
    );
  }

  if (prepared.created) {
    return {
      job: prepared.job,
      input,
      semanticIdempotencyKey,
      disposition: "created",
    };
  }

  if (prepared.job.status === "completed") {
    return {
      job: prepared.job,
      input,
      semanticIdempotencyKey,
      disposition: "completed",
      output: parseCompletedOutput(definition, prepared.job),
    };
  }

  if (prepared.job.status === "failed") {
    if (options.retryFailed === false) {
      return {
        job: prepared.job,
        input,
        semanticIdempotencyKey,
        disposition: "failed",
      };
    }
    const requeued = await repository.requeueFailed(
      prepared.job.id,
      normalizedInput,
    );
    if (requeued !== null) {
      return {
        job: requeued,
        input,
        semanticIdempotencyKey,
        disposition: "requeued",
      };
    }
  }

  const current = (await repository.getById(prepared.job.id)) ?? prepared.job;
  return {
    job: current,
    input,
    semanticIdempotencyKey,
    disposition: current.status === "completed" ? "completed" : "in_progress",
    ...(current.status === "completed"
      ? { output: parseCompletedOutput(definition, current) }
      : {}),
  };
}

async function executeWithDefinition<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  job: InferenceJobRecord,
  repository: InferenceJobStore,
  resolveLanguageModel: ResolveLanguageModel,
): Promise<InferenceRunResult<z.output<TOutputSchema>>> {
  if (job.status === "completed") {
    return {
      job,
      output: parseCompletedOutput(definition, job),
      reused: true,
    };
  }

  if (job.status === "running") {
    throw new InferenceJobInProgressError(job.id);
  }

  const claimed = await repository.claim(job.id);
  if (claimed === null) {
    const current = await repository.getById(job.id);
    if (current?.status === "completed") {
      return {
        job: current,
        output: parseCompletedOutput(definition, current),
        reused: true,
      };
    }
    throw new InferenceJobInProgressError(job.id);
  }

  try {
    const input = definition.inputSchema.parse(claimed.input);
    const result = await generateText({
      model: resolveLanguageModel(definition.config),
      messages: [...definition.buildMessages(input)],
      ...(definition.instructions === undefined
        ? {}
        : { instructions: definition.instructions }),
      output: Output.object({
        schema: definition.outputSchema,
        name: definition.outputName,
        ...(definition.outputDescription === undefined
          ? {}
          : { description: definition.outputDescription }),
      }),
      maxRetries: definition.config.maxRetries,
      ...(definition.config.temperature === undefined
        ? {}
        : { temperature: definition.config.temperature }),
      ...(definition.config.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: definition.config.maxOutputTokens }),
    });
    const output = definition.outputSchema.parse(result.output);
    const completed = await repository.complete(
      claimed.id,
      claimed.updatedAt,
      normalizeJsonValue(output),
    );
    if (completed === null) {
      throw new InferenceJobStateError(
        `Could not complete claimed inference job: ${claimed.id}`,
      );
    }
    return { job: completed, output, reused: false };
  } catch (error) {
    try {
      await repository.fail(
        claimed.id,
        boundedErrorMessage(error),
        claimed.updatedAt,
      );
    } catch {
      // Preserve the original provider, validation, or completion error.
    }
    throw error;
  }
}

export async function runInferenceDirect<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  input: z.input<TInputSchema>,
  dependencies: {
    readonly repository: InferenceJobStore;
    readonly resolveLanguageModel: ResolveLanguageModel;
    readonly userId?: string | null;
  },
): Promise<InferenceRunResult<z.output<TOutputSchema>>> {
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

  if (prepared.disposition === "completed" && prepared.output !== undefined) {
    return { job: prepared.job, output: prepared.output, reused: true };
  }

  return executeWithDefinition(
    definition,
    prepared.job,
    dependencies.repository,
    dependencies.resolveLanguageModel,
  );
}

export async function executePreparedInferenceJob(dependencies: {
  readonly jobId: string;
  readonly registry: InferenceJobRegistry;
  readonly repository: InferenceJobStore;
  readonly resolveLanguageModel: ResolveLanguageModel;
}): Promise<InferenceRunResult<unknown>> {
  const job = await dependencies.repository.getById(dependencies.jobId);
  if (job === null) {
    throw new InferenceJobStateError(
      `Inference job does not exist: ${dependencies.jobId}`,
    );
  }
  const definition: AnyInferenceJobDefinition = dependencies.registry.resolve(
    job.jobType,
    job.definitionVersion,
  );
  return executeWithDefinition(
    definition,
    job,
    dependencies.repository,
    dependencies.resolveLanguageModel,
  );
}
