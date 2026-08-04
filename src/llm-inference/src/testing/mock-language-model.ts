import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import type { ResolveLanguageModel } from "../core/model-resolver";

export function createJsonMockLanguageModel(
  generateCandidate: () => unknown | Promise<unknown>,
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    supportedUrls: {
      "image/*": [/^https:\/\//u],
    },
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(await generateCandidate()),
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 0,
          noCache: 0,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 0,
          text: 0,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  });
}

export function resolveStaticLanguageModel(
  model: LanguageModel,
): ResolveLanguageModel {
  return () => model;
}
