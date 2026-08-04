import { z } from "zod";

export const serverHttpUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  { message: "Expected an HTTP or HTTPS URL" },
);

export const inferenceConfigSchema = z
  .object({
    provider: z.literal("google"),
    model: z.string().trim().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    maxRetries: z.number().int().min(0).max(10).default(2),
  })
  .strict();

export type InferenceConfig = z.output<typeof inferenceConfigSchema>;

const inferenceEnvironmentSchema = z
  .object({
    GEMINI_API_KEY: z.string().trim().min(1),
    SUPABASE_URL: serverHttpUrlSchema,
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1),
  })
  .strict();

const triggerEnvironmentSchema = z
  .object({
    TRIGGER_PROJECT_REF: z.string().trim().min(1),
    TRIGGER_SECRET_KEY: z.string().trim().min(1),
  })
  .strict();

export type InferenceServerEnvironment = z.output<
  typeof inferenceEnvironmentSchema
>;

export type TriggerServerEnvironment = z.output<
  typeof triggerEnvironmentSchema
>;

export function parseInferenceServerEnvironment(
  environment: NodeJS.ProcessEnv,
): InferenceServerEnvironment {
  return inferenceEnvironmentSchema.parse({
    GEMINI_API_KEY: environment.GEMINI_API_KEY,
    SUPABASE_URL: environment.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export function parseTriggerServerEnvironment(
  environment: NodeJS.ProcessEnv,
): TriggerServerEnvironment {
  return triggerEnvironmentSchema.parse({
    TRIGGER_PROJECT_REF: environment.TRIGGER_PROJECT_REF,
    TRIGGER_SECRET_KEY: environment.TRIGGER_SECRET_KEY,
  });
}
