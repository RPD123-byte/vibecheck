import {
  eraseInferenceJobDefinition,
  type AnyInferenceJobDefinition,
  type InferenceJobDefinition,
} from "./definition";
import type { z } from "zod";

export class DuplicateInferenceJobTypeError extends Error {
  constructor(jobType: string) {
    super(`Inference job type is already registered: ${jobType}`);
    this.name = "DuplicateInferenceJobTypeError";
  }
}

export class UnknownInferenceJobDefinitionError extends Error {
  constructor(jobType: string, definitionVersion?: number) {
    super(
      definitionVersion === undefined
        ? `Unknown inference job type: ${jobType}`
        : `Unknown inference job definition: ${jobType}@${definitionVersion}`,
    );
    this.name = "UnknownInferenceJobDefinitionError";
  }
}

export class InferenceJobRegistry {
  readonly #definitions = new Map<string, AnyInferenceJobDefinition>();

  constructor(definitions: readonly AnyInferenceJobDefinition[] = []) {
    for (const definition of definitions) {
      this.registerErased(definition);
    }
  }

  register<
    TJobType extends string,
    TInputSchema extends z.ZodType,
    TOutputSchema extends z.ZodType,
  >(
    definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  ): InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema> {
    this.registerErased(eraseInferenceJobDefinition(definition));
    return definition;
  }

  resolve(
    jobType: string,
    definitionVersion?: number,
  ): AnyInferenceJobDefinition {
    const definition = this.#definitions.get(jobType);
    if (
      definition === undefined ||
      (definitionVersion !== undefined &&
        definition.definitionVersion !== definitionVersion)
    ) {
      throw new UnknownInferenceJobDefinitionError(jobType, definitionVersion);
    }
    return definition;
  }

  listJobTypes(): readonly string[] {
    return Object.freeze([...this.#definitions.keys()].sort());
  }

  private registerErased(definition: AnyInferenceJobDefinition): void {
    if (this.#definitions.has(definition.jobType)) {
      throw new DuplicateInferenceJobTypeError(definition.jobType);
    }
    this.#definitions.set(definition.jobType, definition);
  }
}
