import { describe, expect, expectTypeOf, it } from "vitest";

import {
  VALENCE_AROUSAL_LABEL_DEFINITION_VERSION,
  imageReferenceSchema,
  valenceArousalLabelDefinition,
  valenceArousalLabelInputSchema,
  valenceArousalLabelOutputSchema,
  type ValenceArousalLabelInput,
  type ValenceArousalLabelOutput,
} from "../src/operations/valence-arousal-label";
import {
  buildValenceArousalMessages,
  canonicalAnchors,
  VALENCE_AROUSAL_SYSTEM_PROMPT,
} from "../src/operations/valence-arousal-label/prompt";

function imageReference(
  digestCharacter: string,
  filename: string,
  signature: string,
) {
  return imageReferenceSchema.parse({
    url: `https://images.example.test/${filename}?signature=${signature}`,
    sha256: digestCharacter.repeat(64),
    mediaType: "image/jpeg",
  });
}

function labelingInput(): ValenceArousalLabelInput {
  return valenceArousalLabelInputSchema.parse({
    target: imageReference("f", "target.jpg", "target-v1"),
    anchors: [
      {
        image: imageReference("c", "high-arousal.jpg", "anchor-c-v1"),
        valence: -0.25,
        arousal: 0.9,
      },
      {
        image: imageReference("a", "pleasant.jpg", "anchor-a-v1"),
        valence: 0.8,
        arousal: 0.1,
      },
      {
        image: imageReference("b", "unpleasant.jpg", "anchor-b-v1"),
        valence: -0.8,
        arousal: -0.1,
      },
    ],
  });
}

describe("valence/arousal schemas", () => {
  it("accepts the closed [-1, 1] output interval and infers exact types", () => {
    const lower = valenceArousalLabelOutputSchema.parse({
      valence: -1,
      arousal: -1,
    });
    const upper = valenceArousalLabelOutputSchema.parse({
      valence: 1,
      arousal: 1,
    });

    expectTypeOf(lower).toEqualTypeOf<ValenceArousalLabelOutput>();
    expect(lower).toEqual({ valence: -1, arousal: -1 });
    expect(upper).toEqual({ valence: 1, arousal: 1 });
  });

  it.each([
    { valence: -1.000_001, arousal: 0 },
    { valence: 1.000_001, arousal: 0 },
    { valence: 0, arousal: -1.000_001 },
    { valence: 0, arousal: 1.000_001 },
    { valence: Number.NaN, arousal: 0 },
  ])("rejects an invalid output: %j", (candidate) => {
    expect(valenceArousalLabelOutputSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it("rejects extra output fields and incomplete or unsafe input", () => {
    expect(
      valenceArousalLabelOutputSchema.safeParse({
        valence: 0,
        arousal: 0,
        confidence: 0.99,
      }).success,
    ).toBe(false);
    expect(
      valenceArousalLabelInputSchema.safeParse({
        target: imageReference("f", "target.jpg", "target"),
        anchors: [],
      }).success,
    ).toBe(false);
    expect(
      imageReferenceSchema.safeParse({
        url: "http://images.example.test/target.jpg",
        sha256: "f".repeat(64),
        mediaType: "image/jpeg",
      }).success,
    ).toBe(false);
    expect(
      imageReferenceSchema.safeParse({
        url: "https://images.example.test/target.jpg",
        sha256: "F".repeat(64),
        mediaType: "image/jpeg",
      }).success,
    ).toBe(false);
  });

  it("accepts at most eight anchors", () => {
    const anchors = Array.from({ length: 9 }, (_, index) => ({
      image: imageReference(
        index.toString(16),
        `anchor-${index}.jpg`,
        `anchor-${index}`,
      ),
      valence: 0,
      arousal: 0,
    }));
    const target = imageReference("f", "target.jpg", "target");

    expect(
      valenceArousalLabelInputSchema.safeParse({
        target,
        anchors: anchors.slice(0, 8),
      }).success,
    ).toBe(true);
    expect(
      valenceArousalLabelInputSchema.safeParse({ target, anchors }).success,
    ).toBe(false);
  });
});

describe("valence/arousal prompt construction", () => {
  it("orders anchors by immutable semantic fields without mutating input", () => {
    const input = labelingInput();
    const originalDigests = input.anchors.map((anchor) => anchor.image.sha256);
    const sorted = canonicalAnchors(input.anchors);
    const messages = buildValenceArousalMessages(input);

    expect(sorted.map((anchor) => anchor.image.sha256[0])).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(input.anchors.map((anchor) => anchor.image.sha256)).toEqual(
      originalDigests,
    );
    expect(messages).toHaveLength(1);
    expect(valenceArousalLabelDefinition.instructions).toBe(
      VALENCE_AROUSAL_SYSTEM_PROMPT,
    );

    const userMessage = messages[0];
    expect(userMessage?.role).toBe("user");
    if (userMessage?.role !== "user") {
      throw new Error("Expected a user message");
    }

    expect(userMessage.content).toEqual([
      {
        type: "text",
        text: "Calibrate from these 3 labeled anchor images.",
      },
      { type: "text", text: "Anchor 1: valence=0.8, arousal=0.1" },
      {
        type: "file",
        data: {
          type: "url",
          url: new URL(
            "https://images.example.test/pleasant.jpg?signature=anchor-a-v1",
          ),
        },
        mediaType: "image/jpeg",
      },
      { type: "text", text: "Anchor 2: valence=-0.8, arousal=-0.1" },
      {
        type: "file",
        data: {
          type: "url",
          url: new URL(
            "https://images.example.test/unpleasant.jpg?signature=anchor-b-v1",
          ),
        },
        mediaType: "image/jpeg",
      },
      { type: "text", text: "Anchor 3: valence=-0.25, arousal=0.9" },
      {
        type: "file",
        data: {
          type: "url",
          url: new URL(
            "https://images.example.test/high-arousal.jpg?signature=anchor-c-v1",
          ),
        },
        mediaType: "image/jpeg",
      },
      {
        type: "text",
        text: "Now label the facial expression in this target image on the same calibrated scale.",
      },
      {
        type: "file",
        data: {
          type: "url",
          url: new URL(
            "https://images.example.test/target.jpg?signature=target-v1",
          ),
        },
        mediaType: "image/jpeg",
      },
    ]);
  });
});

describe("valence/arousal job definition", () => {
  it("owns its stable type, version, Gemini settings, and typed schemas", () => {
    expect(valenceArousalLabelDefinition.jobType).toBe("valence_arousal_label");
    expect(valenceArousalLabelDefinition.definitionVersion).toBe(
      VALENCE_AROUSAL_LABEL_DEFINITION_VERSION,
    );
    expect(valenceArousalLabelDefinition.config).toMatchObject({
      provider: "google",
      temperature: 0,
      maxOutputTokens: 1_024,
      maxRetries: 2,
    });

    expectTypeOf(
      valenceArousalLabelDefinition.inputSchema.parse(labelingInput()),
    ).toEqualTypeOf<ValenceArousalLabelInput>();
    expectTypeOf(
      valenceArousalLabelDefinition.outputSchema.parse({
        valence: 0,
        arousal: 0,
      }),
    ).toEqualTypeOf<ValenceArousalLabelOutput>();
  });

  it("canonicalizes anchor order and excludes transport URLs from semantic identity", () => {
    const first = labelingInput();
    const second = valenceArousalLabelInputSchema.parse({
      target: {
        ...first.target,
        url: "https://cdn.example.test/target.jpg?signature=target-v2&credential=secret",
        mediaType: "image/png",
      },
      anchors: [...first.anchors].reverse().map((anchor, index) => ({
        ...anchor,
        image: {
          ...anchor.image,
          url: `https://cdn.example.test/anchor-${index}.jpg?signature=v2&credential=secret`,
          mediaType: "image/webp",
        },
      })),
    });

    const firstIdentity = valenceArousalLabelDefinition.semanticIdentity(first);
    const secondIdentity =
      valenceArousalLabelDefinition.semanticIdentity(second);

    expect(secondIdentity).toEqual(firstIdentity);
    const serialized = JSON.stringify(secondIdentity);
    expect(serialized).not.toContain("url");
    expect(serialized).not.toContain("signature");
    expect(serialized).not.toContain("credential");
    expect(serialized).not.toContain("mediaType");
    expect(serialized).not.toContain("base64");
  });

  it.each([
    [
      "target digest",
      (input: ValenceArousalLabelInput) => ({
        ...input,
        target: { ...input.target, sha256: "e".repeat(64) },
      }),
    ],
    [
      "anchor digest",
      (input: ValenceArousalLabelInput) => ({
        ...input,
        anchors: input.anchors.map((anchor, index) =>
          index === 0
            ? {
                ...anchor,
                image: { ...anchor.image, sha256: "d".repeat(64) },
              }
            : anchor,
        ),
      }),
    ],
    [
      "anchor valence",
      (input: ValenceArousalLabelInput) => ({
        ...input,
        anchors: input.anchors.map((anchor, index) =>
          index === 0 ? { ...anchor, valence: 0.5 } : anchor,
        ),
      }),
    ],
    [
      "anchor arousal",
      (input: ValenceArousalLabelInput) => ({
        ...input,
        anchors: input.anchors.map((anchor, index) =>
          index === 0 ? { ...anchor, arousal: -0.5 } : anchor,
        ),
      }),
    ],
  ] as const)("changes semantic identity when %s changes", (_, mutate) => {
    const input = labelingInput();
    const changed = valenceArousalLabelInputSchema.parse(mutate(input));

    expect(valenceArousalLabelDefinition.semanticIdentity(changed)).not.toEqual(
      valenceArousalLabelDefinition.semanticIdentity(input),
    );
  });
});
