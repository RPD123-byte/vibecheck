import { InferenceJobRegistry } from "./core/registry";
import {
  eraseInferenceJobDefinition,
  type InferenceJobDefinition,
} from "./core/definition";
import { InferenceJobStateError } from "./core/errors";
import { valenceArousalLabelDefinition } from "./operations/valence-arousal-label";
import type { z } from "zod";

export const REGISTERED_INFERENCE_JOB_DEFINITIONS = Object.freeze([
  valenceArousalLabelDefinition,
] as const);

export const SUPPORTED_INFERENCE_JOB_TYPES = Object.freeze(
  REGISTERED_INFERENCE_JOB_DEFINITIONS.map((definition) => definition.jobType),
);

export type SupportedInferenceJobType =
  (typeof SUPPORTED_INFERENCE_JOB_TYPES)[number];

export function createInferenceJobRegistry(): InferenceJobRegistry {
  const registry = new InferenceJobRegistry();
  for (const definition of REGISTERED_INFERENCE_JOB_DEFINITIONS) {
    registry.register(definition);
  }
  return registry;
}

export function assertRegisteredInferenceDefinition<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
): void {
  const registered = createInferenceJobRegistry().resolve(
    definition.jobType,
    definition.definitionVersion,
  );
  if (registered !== eraseInferenceJobDefinition(definition)) {
    throw new InferenceJobStateError(
      `Production inference definition is not the registered catalog object: ${definition.jobType}@${definition.definitionVersion}`,
    );
  }
}
