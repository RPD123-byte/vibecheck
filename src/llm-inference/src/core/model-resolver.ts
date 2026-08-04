import type { LanguageModel } from "ai";

import type { InferenceConfig } from "./config";

export type ResolveLanguageModel = (
  config: Readonly<InferenceConfig>,
) => LanguageModel;
