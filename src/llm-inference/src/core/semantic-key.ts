import { createHash } from "node:crypto";
import type { z } from "zod";

import type { InferenceJobDefinition } from "./definition";
import { canonicalizeJson, normalizeJsonValue, type JsonValue } from "./json";

export interface SemanticKeyMaterial {
  readonly jobType: string;
  readonly definitionVersion: number;
  readonly identity: JsonValue;
}

export function semanticKeyMaterial<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  input: z.output<TInputSchema>,
): SemanticKeyMaterial {
  return {
    jobType: definition.jobType,
    definitionVersion: definition.definitionVersion,
    identity: normalizeJsonValue(definition.semanticIdentity(input)),
  };
}

export function createSemanticIdempotencyKey<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
  input: z.output<TInputSchema>,
): string {
  const canonical = canonicalizeJson(
    normalizeJsonValue(semanticKeyMaterial(definition, input)),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
