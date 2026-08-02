"""Audit Gemini's one-shot valence/arousal magnitude reasoning."""

# Prompt literals intentionally preserve the exact text used for recorded runs.
# ruff: noqa: E501

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from vlm_valence_arousal_experiment import (
    DATASET,
    MANIFEST,
    _encode_image,
    _gemini_api_key,
    _parse_json_object,
    _post_json,
)

ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "results" / "vlm_valence_arousal_reasoning_audit.json"

# Every target has a human V/A label that remains hidden from Gemini.
PAIRS = {
    "happiness": (
        "20260730T220414_802358Z_happiness.jpg",
        "20260730T220421_936293Z_happiness.jpg",
    ),
    "surprise": (
        "20260730T220523_920275Z_surprise.jpg",
        "20260730T220524_525751Z_surprise.jpg",
    ),
    "sadness": (
        "20260730T220632_314443Z_sadness.jpg",
        "20260730T220729_313799Z_sadness.jpg",
    ),
    "anger": (
        "20260730T220754_856766Z_anger.jpg",
        "20260730T220758_916273Z_anger.jpg",
    ),
    "contempt": (
        "20260730T220231_755842Z_contempt.jpg",
        "20260730T220232_957074Z_contempt.jpg",
    ),
    "disgust": (
        "20260730T220932_085362Z_disgust.jpg",
        "20260730T220933_741354Z_disgust.jpg",
    ),
    "fear": (
        "20260730T221116_008542Z_fear.jpg",
        "20260730T221422_184540Z_fear.jpg",
    ),
}


def _manifest_by_image() -> dict[str, dict[str, Any]]:
    return {
        record["image"]: record
        for record in (
            json.loads(line) for line in MANIFEST.read_text().splitlines() if line
        )
    }


def prompt(emotion: str, reference_v: float, reference_a: float) -> str:
    return f"""You are calibrating valence and arousal for one specific person's intentionally communicated {emotion} expressions.

The two attached images are ordered as follows:
1. Human-labeled reference image: valence {reference_v:+.1f}, arousal {reference_a:+.1f}.
2. Unlabeled target image that you must score.

Both images are known to be {emotion}. Do not reclassify the target. The target may express the same emotion through different facial muscle configurations, so do not confuse a different manifestation with a different intensity. Use the reference as a personal anchor, but do not automatically copy it.

Score the target from -1.0 to +1.0 in increments of 0.1:
- Valence: -1.0 extremely negative/unpleasant, 0.0 neutral or mixed, +1.0 extremely positive/pleasant.
- Arousal: -1.0 extremely calm/deactivated, 0.0 ordinary baseline, +1.0 intensely activated/agitated/excited.

Base the decision only on visible facial evidence: brows, eyelids, eye aperture, mouth shape, jaw opening, cheeks, and muscle tension. Ignore identity, clothing, background, and the person's true private emotional state.

For each dimension, provide a concise decision justification—not hidden chain-of-thought—that:
1. explains why the score is on its chosen positive/negative or activated/calm side;
2. explains the chosen magnitude relative to the reference;
3. explains why a meaningfully higher score (approximately +0.2) is not justified;
4. explains why a meaningfully lower score (approximately -0.2) is not justified.

For valence, numerically higher means more positive and lower means more negative.
For arousal, numerically higher means more activated and lower means calmer.

Return exactly one JSON object with no markdown:
{{
  "valence": number,
  "arousal": number,
  "confidence": number from 0 to 1,
  "apparent_expression": "short phrase",
  "reference_comparison": {{
    "valence": "concise comparison",
    "arousal": "concise comparison"
  }},
  "valence_analysis": {{
    "why_this_side": "visible evidence",
    "why_this_magnitude": "visible evidence and reference comparison",
    "why_not_higher": "why roughly +0.2 is not justified",
    "why_not_lower": "why roughly -0.2 is not justified"
  }},
  "arousal_analysis": {{
    "why_this_side": "visible evidence",
    "why_this_magnitude": "visible evidence and reference comparison",
    "why_not_higher": "why roughly +0.2 is not justified",
    "why_not_lower": "why roughly -0.2 is not justified"
  }},
  "uncertainty": {{
    "main_ambiguity": "most important ambiguity",
    "valence_plausible_range": [number, number],
    "arousal_plausible_range": [number, number]
  }}
}}"""


def _validate_response(parsed: dict[str, Any]) -> None:
    for section in (
        "reference_comparison",
        "valence_analysis",
        "arousal_analysis",
        "uncertainty",
    ):
        if not isinstance(parsed.get(section), dict):
            raise ValueError(f"Gemini response missing object section {section!r}")
    for dimension in ("valence", "arousal"):
        analysis = parsed[f"{dimension}_analysis"]
        for field in (
            "why_this_side",
            "why_this_magnitude",
            "why_not_higher",
            "why_not_lower",
        ):
            if not str(analysis.get(field, "")).strip():
                raise ValueError(f"Gemini response missing {dimension}.{field}")


def _request_gemini(
    model: str, text: str, reference: Path, target: Path
) -> tuple[dict[str, Any], str]:
    parts = [
        {"text": text},
        {
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": _encode_image(reference),
            }
        },
        {
            "inlineData": {
                "mimeType": "image/jpeg",
                "data": _encode_image(target),
            }
        },
    ]
    body = _post_json(
        (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        ),
        {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"maxOutputTokens": 8192},
        },
        {"x-goog-api-key": _gemini_api_key()},
    )
    candidates = body.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini returned no candidates: {body}")
    raw = "".join(
        str(part.get("text", ""))
        for part in candidates[0]["content"]["parts"]
    ).strip()
    parsed = _parse_json_object(raw)
    _validate_response(parsed)
    return parsed, raw


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest = _manifest_by_image()
    samples = []
    for emotion, (reference_name, target_name) in PAIRS.items():
        reference = manifest[reference_name]
        target = manifest[target_name]
        for record, role in ((reference, "reference"), (target, "target")):
            if record["label"] != emotion:
                raise ValueError(
                    f"{role} for {emotion} is labeled {record['label']}"
                )
            if "valence" not in record or "arousal" not in record:
                raise ValueError(f"{role} for {emotion} lacks a human V/A label")

        text = prompt(emotion, reference["valence"], reference["arousal"])
        prediction, raw = _request_gemini(
            args.gemini_model,
            text,
            DATASET / reference_name,
            DATASET / target_name,
        )
        errors = {
            "valence": round(
                float(prediction["valence"]) - float(target["valence"]), 3
            ),
            "arousal": round(
                float(prediction["arousal"]) - float(target["arousal"]), 3
            ),
        }
        samples.append(
            {
                "emotion": emotion,
                "reference": {
                    "image": reference_name,
                    "human_valence": reference["valence"],
                    "human_arousal": reference["arousal"],
                },
                "target": {
                    "image": target_name,
                    "human_valence": target["valence"],
                    "human_arousal": target["arousal"],
                },
                "gemini": prediction,
                "signed_error": errors,
                "raw_response": raw,
                "prompt": text,
            }
        )
        print(
            f"{emotion:9s} human=({target['valence']:+.1f},{target['arousal']:+.1f}) "
            f"gemini=({prediction['valence']:+.1f},{prediction['arousal']:+.1f}) "
            f"error=({errors['valence']:+.1f},{errors['arousal']:+.1f})",
            flush=True,
        )

    valence_mae = sum(abs(s["signed_error"]["valence"]) for s in samples) / len(
        samples
    )
    arousal_mae = sum(abs(s["signed_error"]["arousal"]) for s in samples) / len(
        samples
    )
    return {
        "created_at": datetime.now(UTC).isoformat(),
        "model": args.gemini_model,
        "protocol": {
            "one_human_reference_per_emotion": True,
            "every_target_human_labeled": True,
            "target_labels_hidden_from_model": True,
            "neutral_excluded": True,
            "reasoning_is_concise_decision_justification": True,
        },
        "samples": samples,
        "summary": {
            "sample_count": len(samples),
            "valence_mae": valence_mae,
            "arousal_mae": arousal_mae,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gemini-model", default="gemini-3.6-flash")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    result = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["summary"], indent=2))
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
