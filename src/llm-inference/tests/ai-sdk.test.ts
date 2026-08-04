import { describe, expect, it, vi } from "vitest";

import { runInferenceDirect } from "../src/core/lifecycle";
import {
  valenceArousalLabelDefinition,
  type ValenceArousalLabelInput,
} from "../src/operations/valence-arousal-label";
import { InMemoryJobStore } from "../src/testing/in-memory-job-store";
import { createJsonMockLanguageModel } from "../src/testing/mock-language-model";

const input: ValenceArousalLabelInput = {
  target: {
    url: "https://images.example.test/target.jpg?signature=target",
    sha256: "f".repeat(64),
    mediaType: "image/jpeg",
  },
  anchors: [
    {
      image: {
        url: "https://images.example.test/anchor.webp?signature=anchor",
        sha256: "a".repeat(64),
        mediaType: "image/webp",
      },
      valence: -0.75,
      arousal: 0.5,
    },
  ],
};

describe("native AI SDK execution", () => {
  it("resolves an AI SDK model and forwards structured-output settings", async () => {
    const repository = new InMemoryJobStore();
    const model = createJsonMockLanguageModel(() => ({
      valence: 0.25,
      arousal: -0.5,
    }));
    const resolveLanguageModel = vi.fn(() => model);

    const result = await runInferenceDirect(
      valenceArousalLabelDefinition,
      input,
      { repository, resolveLanguageModel },
    );

    expect(result.output).toEqual({ valence: 0.25, arousal: -0.5 });
    expect(resolveLanguageModel).toHaveBeenCalledWith(
      valenceArousalLabelDefinition.config,
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]).toMatchObject({
      temperature: 0,
      maxOutputTokens: 1_024,
      responseFormat: {
        type: "json",
        name: "valence_arousal_label",
        description:
          "Continuous valence and arousal labels calibrated by the supplied anchors.",
      },
    });
  });

  it("lets AI SDK schema validation reject malformed model output", async () => {
    const repository = new InMemoryJobStore();
    const model = createJsonMockLanguageModel(() => ({ confidence: 0.99 }));

    await expect(
      runInferenceDirect(valenceArousalLabelDefinition, input, {
        repository,
        resolveLanguageModel: () => model,
      }),
    ).rejects.toThrow();

    expect(await repository.list()).toEqual([
      expect.objectContaining({ status: "failed", output: null }),
    ]);
  });
});
