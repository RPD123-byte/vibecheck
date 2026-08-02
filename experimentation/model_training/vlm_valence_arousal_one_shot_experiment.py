"""Paired zero-shot vs personal one-shot valence/arousal experiment."""

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
DEFAULT_OUTPUT = ROOT / "results" / "vlm_valence_arousal_one_shot.json"

# One human-labeled reference and a different target per non-neutral category.
# Targets are also human-labeled where possible, enabling a six-class scored
# evaluation. Surprise has only one V/A annotation and remains qualitative.
PAIRS = {
    "happiness": {
        "reference": "20260730T220414_802358Z_happiness.jpg",
        "target": "20260730T220421_936293Z_happiness.jpg",
    },
    "surprise": {
        "reference": "20260730T220524_525751Z_surprise.jpg",
        "target": "20260730T220529_938750Z_surprise.jpg",
    },
    "sadness": {
        "reference": "20260730T220632_314443Z_sadness.jpg",
        "target": "20260730T220729_313799Z_sadness.jpg",
    },
    "anger": {
        "reference": "20260730T220754_856766Z_anger.jpg",
        "target": "20260730T220758_916273Z_anger.jpg",
    },
    "contempt": {
        "reference": "20260730T220231_755842Z_contempt.jpg",
        "target": "20260730T220232_957074Z_contempt.jpg",
    },
    "disgust": {
        "reference": "20260730T220932_085362Z_disgust.jpg",
        "target": "20260730T220933_741354Z_disgust.jpg",
    },
    "fear": {
        "reference": "20260730T221116_008542Z_fear.jpg",
        "target": "20260730T221422_184540Z_fear.jpg",
    },
}

RUBRIC = """Score two independent dimensions from -1.0 to +1.0, using increments of 0.1:
- Valence: -1.0 extremely negative/unpleasant; -0.5 clearly negative; 0.0 neutral or mixed; +0.5 clearly positive; +1.0 extremely positive/pleasant.
- Arousal: -1.0 extremely calm/drowsy/deactivated; -0.5 subdued/calm; 0.0 ordinary baseline; +0.5 clearly activated; +1.0 intensely activated/agitated/excited.
Arousal is activation, not positivity and not merely expression-category intensity. Judge only visible facial cues such as brows, eyes, mouth, and muscle tension. Treat fine distinctions as uncertain.

Return exactly one JSON object, with no markdown: {"valence": number, "arousal": number, "confidence": number from 0 to 1, "apparent_expression": "short phrase", "rationale": "one concise sentence about visible facial cues"}"""


def _manifest_by_image() -> dict[str, dict[str, Any]]:
    result = {}
    for line in MANIFEST.read_text().splitlines():
        if line.strip():
            record = json.loads(line)
            result[record["image"]] = record
    return result


def zero_shot_prompt(emotion: str) -> str:
    return f"""The categorical expression is known to be {emotion}. Do not reclassify it.

Inspect the single target image. Estimate the affect this specific person appears to be intentionally communicating through their face. Do not infer their true private emotional state, identity, personality, or circumstances. Ignore clothing and background.

{RUBRIC}"""


def one_shot_prompt(emotion: str, valence: float, arousal: float) -> str:
    return f"""You are calibrating valence and arousal for one specific person's intended {emotion} expressions. The categorical expression of both images is known to be {emotion}; do not reclassify it.

Image 1 is a human-labeled reference for this person:
- reference valence: {valence:+.1f}
- reference arousal: {arousal:+.1f}

Image 2 is the target to label. Estimate the target relative to the reference. If its visible cues appear more or less pleasant or activated than the reference, adjust the corresponding score. Do not automatically copy the reference values. Judge the affect intentionally communicated through the face, not the person's true private emotional state. Ignore clothing and background.

{RUBRIC}"""


def _ollama_request(
    images: list[Path], prompt: str, model: str, endpoint: str
) -> tuple[dict[str, Any], str]:
    body = _post_json(
        endpoint.rstrip("/") + "/api/generate",
        {
            "model": model,
            "prompt": prompt,
            "images": [_encode_image(path) for path in images],
            "stream": False,
            "options": {"temperature": 0},
        },
        {},
    )
    raw = str(body.get("response", "")).strip()
    return _parse_json_object(raw), raw


def _gemini_request(
    images: list[Path], prompt: str, model: str
) -> tuple[dict[str, Any], str]:
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for path in images:
        parts.append(
            {
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": _encode_image(path),
                }
            }
        )
    body = _post_json(
        (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        ),
        {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"maxOutputTokens": 4096},
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
    return _parse_json_object(raw), raw


def _predict(
    backend: str,
    model: str,
    endpoint: str,
    images: list[Path],
    prompt: str,
) -> tuple[dict[str, Any], str]:
    if backend == "minicpm":
        return _ollama_request(images, prompt, model, endpoint)
    return _gemini_request(images, prompt, model)


def _error(
    prediction: dict[str, Any], target: dict[str, Any]
) -> dict[str, float] | None:
    if "valence" not in target or "arousal" not in target:
        return None
    return {
        "valence_absolute_error": abs(
            float(prediction["valence"]) - float(target["valence"])
        ),
        "arousal_absolute_error": abs(
            float(prediction["arousal"]) - float(target["arousal"])
        ),
    }


def _summary(samples: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for condition in ("zero_shot", "one_shot"):
        scored = [
            sample["conditions"][condition]["absolute_error"]
            for sample in samples
            if sample["conditions"][condition]["absolute_error"] is not None
        ]
        result[condition] = {
            "scored_targets": len(scored),
            "valence_mae": sum(
                item["valence_absolute_error"] for item in scored
            )
            / len(scored),
            "arousal_mae": sum(
                item["arousal_absolute_error"] for item in scored
            )
            / len(scored),
        }
    result["one_shot_change"] = {
        "valence_mae": (
            result["one_shot"]["valence_mae"]
            - result["zero_shot"]["valence_mae"]
        ),
        "arousal_mae": (
            result["one_shot"]["arousal_mae"]
            - result["zero_shot"]["arousal_mae"]
        ),
        "interpretation": "negative means one-shot improved",
    }
    return result


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest = _manifest_by_image()
    if args.backend == "minicpm":
        backend, model = "minicpm", args.minicpm_model
    else:
        backend, model = "gemini", args.gemini_model

    samples = []
    for emotion, pair in PAIRS.items():
        reference = manifest[pair["reference"]]
        target = manifest[pair["target"]]
        reference_scores = (
            round(float(reference["valence"]), 1),
            round(float(reference["arousal"]), 1),
        )
        conditions = {}
        condition_specs = (
            (
                "zero_shot",
                [DATASET / pair["target"]],
                zero_shot_prompt(emotion),
            ),
            (
                "one_shot",
                [DATASET / pair["reference"], DATASET / pair["target"]],
                one_shot_prompt(emotion, *reference_scores),
            ),
        )
        for condition, images, prompt in condition_specs:
            prediction, raw = _predict(
                backend, model, args.ollama_endpoint, images, prompt
            )
            conditions[condition] = {
                "prediction": prediction,
                "absolute_error": _error(prediction, target),
                "raw_response": raw,
                "prompt": prompt,
            }
            print(
                f"{backend:7s} {emotion:9s} {condition:9s}: "
                f"V={prediction['valence']:+.1f} "
                f"A={prediction['arousal']:+.1f}",
                flush=True,
            )
        samples.append(
            {
                "emotion": emotion,
                "reference": {
                    "image": pair["reference"],
                    "human_valence_exact": reference["valence"],
                    "human_arousal_exact": reference["arousal"],
                    "prompt_valence": reference_scores[0],
                    "prompt_arousal": reference_scores[1],
                },
                "target": {
                    "image": pair["target"],
                    "human_valence": target.get("valence"),
                    "human_arousal": target.get("arousal"),
                },
                "conditions": conditions,
            }
        )

    return {
        "created_at": datetime.now(UTC).isoformat(),
        "protocol": {
            "kind": "paired category-conditioned zero-shot vs personal one-shot",
            "one_reference_per_emotion": True,
            "neutral_excluded": True,
            "surprise_excluded_from_error_metrics": True,
        },
        "backend": backend,
        "model": model,
        "samples": samples,
        "summary": _summary(samples),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--backend", choices=("minicpm", "gemini"), required=True
    )
    parser.add_argument("--minicpm-model", default="minicpm-v:latest")
    parser.add_argument("--gemini-model", default="gemini-3.6-flash")
    parser.add_argument("--ollama-endpoint", default="http://127.0.0.1:11434")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    result = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result["summary"], indent=2))
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
