import { defineInferenceJob } from "../../core/definition";
import {
  buildValenceArousalMessages,
  canonicalAnchors,
  VALENCE_AROUSAL_SYSTEM_PROMPT,
} from "./prompt";
import {
  valenceArousalLabelInputSchema,
  valenceArousalLabelOutputSchema,
} from "./schemas";

export const VALENCE_AROUSAL_LABEL_DEFINITION_VERSION = 1;
export const DEFAULT_GEMINI_VALENCE_AROUSAL_MODEL = "gemini-3.6-flash";

export const valenceArousalLabelDefinition = defineInferenceJob({
  jobType: "valence_arousal_label",
  definitionVersion: VALENCE_AROUSAL_LABEL_DEFINITION_VERSION,
  inputSchema: valenceArousalLabelInputSchema,
  outputSchema: valenceArousalLabelOutputSchema,
  config: {
    provider: "google",
    model: DEFAULT_GEMINI_VALENCE_AROUSAL_MODEL,
    temperature: 0,
    maxOutputTokens: 1_024,
    maxRetries: 2,
  },
  instructions: VALENCE_AROUSAL_SYSTEM_PROMPT,
  outputName: "valence_arousal_label",
  outputDescription:
    "Continuous valence and arousal labels calibrated by the supplied anchors.",
  buildMessages: buildValenceArousalMessages,
  semanticIdentity(input) {
    return {
      targetSha256: input.target.sha256,
      anchors: canonicalAnchors(input.anchors).map((anchor) => ({
        sha256: anchor.image.sha256,
        valence: anchor.valence,
        arousal: anchor.arousal,
      })),
    };
  },
});
