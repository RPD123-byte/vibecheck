import type { ModelMessage } from "ai";
import { z } from "zod";

import { inferenceConfigSchema, type InferenceConfig } from "./config";

const jobTypeSchema = z
  .string()
  .trim()
  .max(63)
  .regex(/^[a-z][a-z0-9_]*$/, "jobType must be snake_case");

const definitionVersionSchema = z.number().int().positive();

export interface InferenceJobDefinition<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  readonly jobType: TJobType;
  readonly definitionVersion: number;
  /** Validation-only schema whose parsed value is JSON-native. */
  readonly inputSchema: TInputSchema;
  /** Validation-only schema whose parsed value is JSON-native. */
  readonly outputSchema: TOutputSchema;
  readonly config: Readonly<InferenceConfig>;
  readonly instructions?: string;
  readonly outputName: string;
  readonly outputDescription?: string;
  readonly buildMessages: (
    input: z.output<TInputSchema>,
  ) => readonly ModelMessage[];
  readonly semanticIdentity: (input: z.output<TInputSchema>) => unknown;
}

export interface DefineInferenceJobOptions<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  readonly jobType: TJobType;
  readonly definitionVersion: number;
  /**
   * Must produce JSON-native data and must not use transforms, pipes, or
   * codecs. Perform domain conversion outside the persisted job definition.
   */
  readonly inputSchema: TInputSchema;
  /**
   * Must produce JSON-native data and must not use transforms, pipes, or
   * codecs. Perform domain conversion outside the persisted job definition.
   */
  readonly outputSchema: TOutputSchema;
  readonly config: z.input<typeof inferenceConfigSchema>;
  readonly instructions?: string;
  readonly outputName: string;
  readonly outputDescription?: string;
  readonly buildMessages: (
    input: z.output<TInputSchema>,
  ) => readonly ModelMessage[];
  readonly semanticIdentity: (input: z.output<TInputSchema>) => unknown;
}

export type AnyInferenceJobDefinition = InferenceJobDefinition<
  string,
  z.ZodType,
  z.ZodType
>;

export type InferJobInput<TDefinition> =
  TDefinition extends InferenceJobDefinition<
    string,
    infer TInputSchema,
    z.ZodType
  >
    ? z.output<TInputSchema>
    : never;

export type InferJobOutput<TDefinition> =
  TDefinition extends InferenceJobDefinition<
    string,
    z.ZodType,
    infer TOutputSchema
  >
    ? z.output<TOutputSchema>
    : never;

export function defineInferenceJob<
  const TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  options: DefineInferenceJobOptions<TJobType, TInputSchema, TOutputSchema>,
): InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema> {
  const jobType = jobTypeSchema.parse(options.jobType) as TJobType;
  const definitionVersion = definitionVersionSchema.parse(
    options.definitionVersion,
  );
  const config = Object.freeze(inferenceConfigSchema.parse(options.config));
  const instructions =
    options.instructions === undefined
      ? undefined
      : z.string().trim().min(1).parse(options.instructions);
  const outputName = z.string().trim().min(1).parse(options.outputName);

  return Object.freeze({
    jobType,
    definitionVersion,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    config,
    ...(instructions === undefined ? {} : { instructions }),
    outputName,
    ...(options.outputDescription === undefined
      ? {}
      : { outputDescription: options.outputDescription }),
    buildMessages: options.buildMessages,
    semanticIdentity: options.semanticIdentity,
  });
}

export function eraseInferenceJobDefinition<
  TJobType extends string,
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  definition: InferenceJobDefinition<TJobType, TInputSchema, TOutputSchema>,
): AnyInferenceJobDefinition {
  return definition as unknown as AnyInferenceJobDefinition;
}
