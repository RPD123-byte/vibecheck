import { z } from "zod";

export const VALENCE_AROUSAL_MIN = -1;
export const VALENCE_AROUSAL_MAX = 1;

export const affectValueSchema = z
  .number()
  .min(VALENCE_AROUSAL_MIN)
  .max(VALENCE_AROUSAL_MAX);

export const sha256DigestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hex digest");

export const imageMediaTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const imageReferenceSchema = z.strictObject({
  url: z.url().refine((value) => new URL(value).protocol === "https:", {
    message: "Image references must use HTTPS",
  }),
  sha256: sha256DigestSchema,
  mediaType: imageMediaTypeSchema,
});

export const valenceArousalAnchorSchema = z.strictObject({
  image: imageReferenceSchema,
  valence: affectValueSchema,
  arousal: affectValueSchema,
});

export const valenceArousalLabelInputSchema = z.strictObject({
  target: imageReferenceSchema,
  anchors: z.array(valenceArousalAnchorSchema).min(1).max(8),
});

export const valenceArousalLabelOutputSchema = z.strictObject({
  valence: affectValueSchema.describe(
    "Pleasantness from -1 (very unpleasant) to 1 (very pleasant)",
  ),
  arousal: affectValueSchema.describe(
    "Activation from -1 (very calm) to 1 (very activated)",
  ),
});

export type ImageReference = z.output<typeof imageReferenceSchema>;
export type ValenceArousalAnchor = z.output<typeof valenceArousalAnchorSchema>;
export type ValenceArousalLabelInput = z.output<
  typeof valenceArousalLabelInputSchema
>;
export type ValenceArousalLabelOutput = z.output<
  typeof valenceArousalLabelOutputSchema
>;
