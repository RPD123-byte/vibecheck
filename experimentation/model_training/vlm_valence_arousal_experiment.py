"""Compare zero-shot valence/arousal labels from local MiniCPM and Gemini."""

# Prompt literals intentionally preserve the exact text used for recorded runs.
# ruff: noqa: E501

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "human_data" / "rithvik_expressions_v1"
MANIFEST = DATASET / "manifest.jsonl"
DEFAULT_OUTPUT = ROOT / "results" / "vlm_valence_arousal_zero_shot.json"

# Chosen to cover positive/negative and low/high activation without including
# the emotion name anywhere in the prompt or API-visible image metadata.
SELECTED_IMAGES = (
    "20260730T220411_268532Z_happiness.jpg",
    "20260730T220529_938750Z_surprise.jpg",
    "20260730T220650_123657Z_sadness.jpg",
    "20260730T220809_517706Z_anger.jpg",
)

PROMPT = """Inspect only the visible facial expression in this image. Estimate the affect the person appears to be intentionally communicating through their face. Do not infer their true private emotional state, identity, personality, or circumstances. Ignore clothing and background.

Score two independent dimensions from -1.0 to +1.0, using increments of 0.1:
- Valence: -1.0 extremely negative/unpleasant; -0.5 clearly negative; 0.0 neutral or mixed; +0.5 clearly positive; +1.0 extremely positive/pleasant.
- Arousal: -1.0 extremely calm/drowsy/deactivated; -0.5 subdued/calm; 0.0 ordinary baseline; +0.5 clearly activated; +1.0 intensely activated/agitated/excited.
Arousal is activation, not positivity and not merely expression category intensity. Use facial evidence such as brows, eyes, mouth, and muscle tension. Treat fine distinctions as uncertain.

Return exactly one JSON object, with no markdown: {"valence": number, "arousal": number, "confidence": number from 0 to 1, "apparent_expression": "short phrase", "rationale": "one concise sentence about visible facial cues"}"""


def _manifest_by_image() -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    for line in MANIFEST.read_text().splitlines():
        if line.strip():
            record = json.loads(line)
            records[record["image"]] = record
    return records


def _encode_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> Any:
    encoded = json.dumps(payload).encode("utf-8")
    for attempt, delay in enumerate((0, 2, 4, 8, 16), start=1):
        if delay:
            time.sleep(delay)
        request = urllib.request.Request(
            url,
            data=encoded,
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code in (429, 503) and attempt < 5:
                continue
            raise RuntimeError(
                f"HTTP {error.code} from {url}: {detail[:1000]}"
            ) from error
    raise AssertionError("retry loop exhausted")


def _parse_json_object(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start = cleaned.find("{")
    if start < 0:
        raise ValueError(f"No JSON object in model response: {text!r}")
    object_text = re.sub(r"(?<=[:\[,\s])\+(?=\d)", "", cleaned[start:])
    # Repair common small-model key typos without altering predicted values.
    object_text = re.sub(
        r'([,{]\s*)/?([A-Za-z_]\w*)"?\s*:',
        r'\1"\2":',
        object_text,
    )
    try:
        # raw_decode accepts harmless prose or an extra brace after the object.
        parsed, _ = json.JSONDecoder().raw_decode(object_text)
    except json.JSONDecodeError as first_error:
        # Gemini occasionally omits only the final closing brace despite JSON mode.
        missing_braces = object_text.count("{") - object_text.count("}")
        if missing_braces <= 0:
            raise ValueError(f"Malformed JSON model response: {text!r}") from first_error
        try:
            parsed, _ = json.JSONDecoder().raw_decode(
                object_text + ("}" * missing_braces)
            )
        except json.JSONDecodeError as second_error:
            raise ValueError(
                f"Malformed JSON model response: {text!r}"
            ) from second_error
    if not isinstance(parsed, dict):
        raise ValueError(f"Expected an object, received: {type(parsed).__name__}")
    for key in ("valence", "arousal"):
        value = float(parsed[key])
        if not -1.0 <= value <= 1.0:
            raise ValueError(f"{key} outside [-1, 1]: {value}")
        parsed[key] = value
    parsed["confidence"] = float(parsed["confidence"])
    if not 0.0 <= parsed["confidence"] <= 1.0:
        raise ValueError(f"confidence outside [0, 1]: {parsed['confidence']}")
    return parsed


def label_with_ollama(
    image_path: Path, model: str, endpoint: str
) -> tuple[dict[str, Any], str]:
    body = _post_json(
        endpoint.rstrip("/") + "/api/generate",
        {
            "model": model,
            "prompt": PROMPT,
            "images": [_encode_image(image_path)],
            "stream": False,
            "options": {"temperature": 0},
        },
        {},
    )
    raw = str(body.get("response", "")).strip()
    return _parse_json_object(raw), raw


def _dotenv_value(path: Path, name: str) -> str | None:
    if not path.exists():
        return None
    prefix = name + "="
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if line.startswith(prefix):
            value = line[len(prefix) :].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value or None
    return None


def _gemini_api_key() -> str:
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        if value := os.environ.get(name):
            return value
    for dotenv in (ROOT.parents[1] / ".env", Path.home() / ".env"):
        for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
            if value := _dotenv_value(dotenv, name):
                return value
    raise RuntimeError("No GEMINI_API_KEY or GOOGLE_API_KEY was found")


def label_with_gemini(image_path: Path, model: str) -> tuple[dict[str, Any], str]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
    )
    body = _post_json(
        url,
        {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": PROMPT},
                        {
                            "inlineData": {
                                "mimeType": "image/jpeg",
                                "data": _encode_image(image_path),
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {
                # Gemini's internal reasoning tokens count against this budget.
                "maxOutputTokens": 4096,
            },
        },
        {"x-goog-api-key": _gemini_api_key()},
    )
    candidates = body.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini returned no candidates: {body}")
    parts = candidates[0]["content"]["parts"]
    raw = "".join(str(part.get("text", "")) for part in parts).strip()
    return _parse_json_object(raw), raw


def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest = _manifest_by_image()
    backends = (
        ("minicpm", args.minicpm_model)
        if args.backend == "minicpm"
        else ("gemini", args.gemini_model)
        if args.backend == "gemini"
        else None
    )
    selected_backends = [backends] if backends else [
        ("minicpm", args.minicpm_model),
        ("gemini", args.gemini_model),
    ]

    runs = []
    for backend, model in selected_backends:
        samples = []
        for image_name in SELECTED_IMAGES:
            image_path = DATASET / image_name
            if backend == "minicpm":
                parsed, raw = label_with_ollama(
                    image_path, model, args.ollama_endpoint
                )
            else:
                parsed, raw = label_with_gemini(image_path, model)
            record = manifest[image_name]
            samples.append(
                {
                    "sample_id": f"image_{SELECTED_IMAGES.index(image_name) + 1:02d}",
                    "image": image_name,
                    "human_expression_label": record["label"],
                    "human_valence": record.get("valence"),
                    "human_arousal": record.get("arousal"),
                    "prediction": parsed,
                    "raw_response": raw,
                }
            )
            print(
                f"{backend:7s} {samples[-1]['sample_id']}: "
                f"V={parsed['valence']:+.1f} A={parsed['arousal']:+.1f} "
                f"confidence={parsed['confidence']:.2f}"
            )
        runs.append({"backend": backend, "model": model, "samples": samples})

    return {
        "created_at": datetime.now(UTC).isoformat(),
        "protocol": {
            "kind": "single-pass zero-shot",
            "one_image_per_request": True,
            "prompt": PROMPT,
        },
        "runs": runs,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--backend", choices=("all", "minicpm", "gemini"), default="all"
    )
    parser.add_argument("--minicpm-model", default="minicpm-v:latest")
    parser.add_argument("--gemini-model", default="gemini-3.1-pro-preview")
    parser.add_argument("--ollama-endpoint", default="http://127.0.0.1:11434")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    result = run(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
