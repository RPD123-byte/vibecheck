import type { ModelMessage, UserContent } from "ai";

import type { ValenceArousalAnchor, ValenceArousalLabelInput } from "./schemas";

export const VALENCE_AROUSAL_SYSTEM_PROMPT = `You label facial expressions on two continuous affect dimensions.

Valence ranges from -1 to 1:
- -1 is strongly unpleasant or negative.
- 0 is neutral.
- 1 is strongly pleasant or positive.

Arousal ranges from -1 to 1:
- -1 is very calm, inactive, or low-energy.
- 0 is moderate activation.
- 1 is highly activated or high-energy.

Use the labeled anchor images as the calibration scale for this request. Judge the visible facial expression, not identity, attractiveness, scene content, or assumed life circumstances. Return only the requested structured values.`;

export function compareAnchors(
  left: ValenceArousalAnchor,
  right: ValenceArousalAnchor,
): number {
  const digestOrder =
    left.image.sha256 < right.image.sha256
      ? -1
      : left.image.sha256 > right.image.sha256
        ? 1
        : 0;

  return (
    digestOrder || left.valence - right.valence || left.arousal - right.arousal
  );
}

export function canonicalAnchors(
  anchors: readonly ValenceArousalAnchor[],
): readonly ValenceArousalAnchor[] {
  return [...anchors].sort(compareAnchors);
}

export function buildValenceArousalMessages(
  input: ValenceArousalLabelInput,
): readonly ModelMessage[] {
  const anchors = canonicalAnchors(input.anchors);
  const content: UserContent = [
    {
      type: "text",
      text: `Calibrate from these ${anchors.length} labeled anchor image${anchors.length === 1 ? "" : "s"}.`,
    },
  ];

  anchors.forEach((anchor, index) => {
    content.push(
      {
        type: "text",
        text: `Anchor ${index + 1}: valence=${anchor.valence}, arousal=${anchor.arousal}`,
      },
      {
        type: "file",
        data: { type: "url", url: new URL(anchor.image.url) },
        mediaType: anchor.image.mediaType,
      },
    );
  });

  content.push(
    {
      type: "text",
      text: "Now label the facial expression in this target image on the same calibrated scale.",
    },
    {
      type: "file",
      data: { type: "url", url: new URL(input.target.url) },
      mediaType: input.target.mediaType,
    },
  );

  return [{ role: "user", content }];
}
