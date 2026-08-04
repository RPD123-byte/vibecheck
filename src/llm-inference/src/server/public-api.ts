import type { z } from "zod";

import { assertRegisteredInferenceDefinition } from "../catalog";
import { parseTriggerServerEnvironment } from "../core/config";
import type { InferenceJobDefinition } from "../core/definition";
import {
  runInferenceDirect as runInferenceDirectWithDependencies,
  type InferenceRunResult,
} from "../core/lifecycle";
import {
  enqueueInference as enqueueInferenceWithDependencies,
  type EnqueueInferenceResult,
} from "../trigger/enqueue";
import { TriggerDevInferenceTaskDispatcher } from "../trigger/dispatcher";
import { createProductionInferenceDependencies } from "./production-dependencies";

export interface InferenceInvocationOptions {
  readonly userId?: string | null;
}

export async function runInferenceDirect<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  input: z.input<TInputSchema>,
  options: InferenceInvocationOptions = {},
): Promise<InferenceRunResult<z.output<TOutputSchema>>> {
  definition.inputSchema.parse(input);
  assertRegisteredInferenceDefinition(definition);
  const dependencies = createProductionInferenceDependencies();
  return runInferenceDirectWithDependencies(definition, input, {
    repository: dependencies.repository,
    resolveLanguageModel: dependencies.resolveLanguageModel,
    ...(options.userId === undefined ? {} : { userId: options.userId }),
  });
}

export async function enqueueInference<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  input: z.input<TInputSchema>,
  options: InferenceInvocationOptions = {},
): Promise<EnqueueInferenceResult<z.output<TOutputSchema>>> {
  definition.inputSchema.parse(input);
  assertRegisteredInferenceDefinition(definition);
  parseTriggerServerEnvironment(process.env);
  const dependencies = createProductionInferenceDependencies();
  return enqueueInferenceWithDependencies(definition, input, {
    repository: dependencies.repository,
    dispatcher: new TriggerDevInferenceTaskDispatcher(),
    ...(options.userId === undefined ? {} : { userId: options.userId }),
  });
}
