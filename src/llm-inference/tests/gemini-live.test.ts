import { createGoogle } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { expect, it } from "vitest";

import {
  valenceArousalLabelDefinition,
  valenceArousalLabelInputSchema,
  valenceArousalLabelOutputSchema,
} from "../src/operations/valence-arousal-label";
import { runInferenceDirect } from "../src/server/public-api";

const liveTest = process.env.RUN_GEMINI_LIVE_TEST === "1" ? it : it.skip;

liveTest(
  "returns schema-valid valence and arousal from the live Gemini operation",
  async () => {
    const input = valenceArousalLabelInputSchema.parse({
      target: {
        url: "https://raw.githubusercontent.com/JustinShenk/fer/master/justin.jpg",
        sha256:
          "2ff0436f963ebba1035bf9f712a9ee54011ee6ebe78372f8e8e40cc45ab29c9d",
        mediaType: "image/jpeg",
      },
      anchors: [
        {
          image: {
            url: "https://raw.githubusercontent.com/ageitgey/face_recognition/master/examples/obama.jpg",
            sha256:
              "0930e3aa8cae5920329c0c8cbc6a2ab70f47b0e67b432875beaa95cbf7e741f6",
            mediaType: "image/jpeg",
          },
          valence: 0.8,
          arousal: 0.5,
        },
        {
          image: {
            url: "https://raw.githubusercontent.com/ageitgey/face_recognition/master/examples/biden.jpg",
            sha256:
              "3c17508bb91554c637a2eabddfae790e5bb1caba93130814fc2ac50be9760c4c",
            mediaType: "image/jpeg",
          },
          valence: -0.1,
          arousal: 0.1,
        },
      ],
    });

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new Error("GEMINI_API_KEY is required");
    }
    const google = createGoogle({ apiKey });
    const providerResult = await generateText({
      model: google(valenceArousalLabelDefinition.config.model),
      messages: [...valenceArousalLabelDefinition.buildMessages(input)],
      output: Output.object({
        schema: valenceArousalLabelOutputSchema,
        name: valenceArousalLabelDefinition.outputName,
        ...(valenceArousalLabelDefinition.outputDescription === undefined
          ? {}
          : {
              description: valenceArousalLabelDefinition.outputDescription,
            }),
      }),
      maxRetries: valenceArousalLabelDefinition.config.maxRetries,
      ...(valenceArousalLabelDefinition.config.temperature === undefined
        ? {}
        : {
            temperature: valenceArousalLabelDefinition.config.temperature,
          }),
      ...(valenceArousalLabelDefinition.config.maxOutputTokens === undefined
        ? {}
        : {
            maxOutputTokens:
              valenceArousalLabelDefinition.config.maxOutputTokens,
          }),
    });
    expect(
      valenceArousalLabelOutputSchema.parse(providerResult.output),
    ).toEqual(providerResult.output);

    const completed = await runInferenceDirect(
      valenceArousalLabelDefinition,
      input,
    );
    expect(valenceArousalLabelOutputSchema.parse(completed.output)).toEqual(
      completed.output,
    );
    expect(completed.job.status).toBe("completed");

    const reused = await runInferenceDirect(valenceArousalLabelDefinition, {
      ...input,
      target: {
        ...input.target,
        url: `${input.target.url}?transport-only=changed`,
      },
    });
    expect(reused).toMatchObject({
      reused: true,
      output: completed.output,
      job: { id: completed.job.id, status: "completed" },
    });
  },
  120_000,
);
