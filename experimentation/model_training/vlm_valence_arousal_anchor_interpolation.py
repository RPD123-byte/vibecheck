"""Compare direct scores with anchor-relative V/A choices using Gemini."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    from .vlm_valence_arousal_experiment import (
        _encode_image,
        _gemini_api_key,
        _parse_json_object,
        _post_json,
    )
except ImportError:
    from vlm_valence_arousal_experiment import (
        _encode_image,
        _gemini_api_key,
        _parse_json_object,
        _post_json,
    )


ROOT = Path(__file__).resolve().parent
V1 = ROOT / "human_data" / "rithvik_expressions_v1"
V2 = ROOT / "human_data" / "rithvik_expressions_v2"
DEFAULT_OUTPUT = ROOT / "results" / "vlm_va_anchor_interpolation_gemini.json"
DEFAULT_REPORT = ROOT / "results" / "vlm_va_anchor_interpolation_gemini.md"
DEFAULT_VISUALS = ROOT / "results" / "vlm_va_anchor_interpolation_visuals"
EMOTIONS = (
    "anger",
    "contempt",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
)


def read_manifest(dataset: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in (dataset / "manifest.jsonl").read_text().splitlines()
        if line.strip()
    ]


def refresh_target_labels(result: dict[str, Any]) -> None:
    """Rescore cached Gemini outputs against the current v1 human labels."""
    by_image = {row["image"]: row for row in read_manifest(V1)}
    for sample in result["samples"]:
        target = sample["target"]
        current = by_image[target["image"]]
        target["human_expression"] = current["label"]
        target["human_valence"] = current.get("valence")
        target["human_arousal"] = current.get("arousal")
    result["summary"] = score(result["samples"])
    result["labels_refreshed_at"] = datetime.now(UTC).isoformat()


def select_targets(
    records: list[dict[str, Any]], per_expression: int = 3
) -> dict[str, list[dict[str, Any]]]:
    """Prefer human-scored targets, then add deterministic unlabeled examples."""
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["label"]].append(record)
    selected: dict[str, list[dict[str, Any]]] = {}
    for emotion in EMOTIONS:
        labeled = [
            row for row in grouped[emotion] if "valence" in row and "arousal" in row
        ]
        # For categories with extra annotations, retain label-space diversity.
        if len(labeled) > per_expression:
            labeled = _farthest_affect_points(labeled, per_expression)
        chosen = list(labeled[:per_expression])
        unlabeled = [row for row in grouped[emotion] if row not in chosen]
        if len(chosen) < per_expression and unlabeled:
            # Pick from the center rather than another immediately adjacent first frame.
            needed = per_expression - len(chosen)
            positions = [
                round((index + 1) * (len(unlabeled) + 1) / (needed + 1)) - 1
                for index in range(needed)
            ]
            chosen.extend(
                unlabeled[max(0, min(position, len(unlabeled) - 1))]
                for position in positions
            )
        if len(chosen) != per_expression:
            raise ValueError(f"Need {per_expression} v1 targets for {emotion}")
        selected[emotion] = chosen
    return selected


def _farthest_affect_points(
    records: list[dict[str, Any]], count: int
) -> list[dict[str, Any]]:
    ordered = sorted(
        records, key=lambda row: (row["valence"], row["arousal"], row["image"])
    )
    chosen = [ordered[0]]
    while len(chosen) < count:
        remaining = [row for row in ordered if row not in chosen]
        chosen.append(
            max(
                remaining,
                key=lambda row: min(
                    (float(row["valence"]) - float(other["valence"])) ** 2
                    + (float(row["arousal"]) - float(other["arousal"])) ** 2
                    for other in chosen
                ),
            )
        )
    return sorted(chosen, key=lambda row: row["image"])


def training_anchors(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        if record.get("split") == "train":
            if "valence" not in record or "arousal" not in record:
                raise ValueError(f"V2 anchor lacks V/A: {record['image']}")
            grouped[record["label"]].append(record)
    for emotion in EMOTIONS:
        if not grouped[emotion]:
            raise ValueError(f"V2 has no training anchors for {emotion}")
    return dict(grouped)


def _mean_anchor_value(
    anchors: list[dict[str, Any]], dimension: str, fragment: str
) -> float:
    values = [float(row[dimension]) for row in anchors if fragment in row["anchor"]]
    if not values:
        raise ValueError(f"No {dimension} anchors matched {fragment!r}")
    return round(sum(values) / len(values), 1)


def _interpolate(low: float, high: float, fraction: float) -> float:
    return round(low + (high - low) * fraction, 1)


def _dedupe_options(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[float] = set()
    result = []
    for option in options:
        value = float(option["value"])
        if value not in seen:
            result.append(option)
            seen.add(value)
    return result


def choice_options(
    emotion: str, anchors: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    """Build categorical ladders whose values are resolved outside Gemini."""
    arousal_high = _mean_anchor_value(anchors, "arousal", "arousal_high")
    arousal_low = _mean_anchor_value(anchors, "arousal", "arousal_low")
    arousal = _dedupe_options(
        [
            {
                "id": "A_HIGH_SAME",
                "description": "same activation as the high-arousal anchor group",
                "value": arousal_high,
            },
            {
                "id": "A_HIGH_SLIGHTLY_LOWER",
                "description": "slightly less activated than the high-arousal anchors",
                "value": _interpolate(arousal_high, arousal_low, 0.25),
            },
            {
                "id": "A_MIDDLE",
                "description": (
                    "approximately midway between the high- and low-arousal anchors"
                ),
                "value": _interpolate(arousal_high, arousal_low, 0.5),
            },
            {
                "id": "A_BASELINE",
                "description": "ordinary zero-arousal baseline",
                "value": 0.0,
            },
            {
                "id": "A_LOW_SLIGHTLY_HIGHER",
                "description": "slightly more activated than the low-arousal anchors",
                "value": _interpolate(arousal_high, arousal_low, 0.75),
            },
            {
                "id": "A_LOW_SAME",
                "description": "same activation as the low-arousal anchor group",
                "value": arousal_low,
            },
        ]
    )

    if emotion == "neutral":
        valence = [
            {
                "id": "V_NEUTRAL",
                "description": "neutral valence like the neutral anchors",
                "value": 0.0,
            }
        ]
    elif emotion == "surprise":
        negative_high = _mean_anchor_value(anchors, "valence", "valence_negative_high")
        negative_low = _mean_anchor_value(anchors, "valence", "valence_negative_low")
        positive_high = _mean_anchor_value(anchors, "valence", "valence_positive_high")
        positive_low = _mean_anchor_value(anchors, "valence", "valence_positive_low")
        valence = _dedupe_options(
            _negative_valence_options(negative_high, negative_low)
            + [
                {
                    "id": "V_NEUTRAL",
                    "description": "neutral or evenly mixed valence",
                    "value": 0.0,
                }
            ]
            + _positive_valence_options(positive_low, positive_high)
        )
    elif emotion == "happiness":
        positive_high = _mean_anchor_value(anchors, "valence", "valence_positive_high")
        positive_low = _mean_anchor_value(anchors, "valence", "valence_positive_low")
        valence = [
            {"id": "V_NEUTRAL", "description": "neutral valence", "value": 0.0},
            *_positive_valence_options(positive_low, positive_high),
        ]
    else:
        negative_high = _mean_anchor_value(anchors, "valence", "valence_negative_high")
        negative_low = _mean_anchor_value(anchors, "valence", "valence_negative_low")
        valence = [
            *_negative_valence_options(negative_high, negative_low),
            {"id": "V_NEUTRAL", "description": "neutral valence", "value": 0.0},
        ]
    return {"valence": valence, "arousal": arousal}


def _negative_valence_options(high: float, low: float) -> list[dict[str, Any]]:
    return [
        {
            "id": "V_NEG_HIGH_SAME",
            "description": (
                "same strongly negative valence as the more-negative anchor group"
            ),
            "value": high,
        },
        {
            "id": "V_NEG_HIGH_SLIGHTLY_LESS",
            "description": "slightly less negative than the more-negative anchors",
            "value": _interpolate(high, low, 0.25),
        },
        {
            "id": "V_NEG_MIDDLE",
            "description": "midway between the more-negative and less-negative anchors",
            "value": _interpolate(high, low, 0.5),
        },
        {
            "id": "V_NEG_LOW_SLIGHTLY_MORE",
            "description": "slightly more negative than the less-negative anchors",
            "value": _interpolate(high, low, 0.75),
        },
        {
            "id": "V_NEG_LOW_SAME",
            "description": (
                "same mildly negative valence as the less-negative anchor group"
            ),
            "value": low,
        },
    ]


def _positive_valence_options(low: float, high: float) -> list[dict[str, Any]]:
    return [
        {
            "id": "V_POS_LOW_SAME",
            "description": (
                "same mildly positive valence as the less-positive anchor group"
            ),
            "value": low,
        },
        {
            "id": "V_POS_LOW_SLIGHTLY_MORE",
            "description": "slightly more positive than the less-positive anchors",
            "value": _interpolate(low, high, 0.25),
        },
        {
            "id": "V_POS_MIDDLE",
            "description": "midway between the less-positive and more-positive anchors",
            "value": _interpolate(low, high, 0.5),
        },
        {
            "id": "V_POS_HIGH_SLIGHTLY_LESS",
            "description": "slightly less positive than the more-positive anchors",
            "value": _interpolate(low, high, 0.75),
        },
        {
            "id": "V_POS_HIGH_SAME",
            "description": (
                "same strongly positive valence as the more-positive anchor group"
            ),
            "value": high,
        },
    ]


def direct_prompt(emotion: str) -> str:
    return "\n\n".join(
        [
            (
                "You are calibrating valence and arousal for one specific "
                f"person's intentionally communicated {emotion} expressions."
            ),
            (
                "The attached anchor images are human-labeled ground truth for "
                "this person. Each anchor's exact expression, valence, and "
                "arousal appears immediately before its image. The final image "
                f"is the target. The target is known to be {emotion}; do not "
                "reclassify it."
            ),
            (
                "Interpolate the target independently along the personal valence "
                "and arousal scales demonstrated by the anchors. Different facial "
                "muscle configurations can express the same intensity, so compare "
                "total visible activation and pleasantness instead of matching one "
                "stereotyped geometry. Treat the human labels as authoritative even "
                "if they differ from population-average expectations."
            ),
            (
                "For valence, numerically lower means more negative and higher means "
                "more positive. For arousal, numerically lower means calmer or "
                "deactivated and higher means more activated. Use increments of 0.1 "
                "in [-1.0, 1.0]."
            ),
            (
                "Return only this JSON with no markdown or explanation: "
                '{"valence": number, "arousal": number}'
            ),
        ]
    )


def choice_prompt(emotion: str, options: dict[str, list[dict[str, Any]]]) -> str:
    def render(dimension: str) -> str:
        return "\n".join(
            f"- {option['id']}: {option['description']}"
            for option in options[dimension]
        )

    return "\n\n".join(
        [
            (
                "You are calibrating valence and arousal for one specific "
                f"person's intentionally communicated {emotion} expressions."
            ),
            (
                "The attached anchor images are human-labeled ground truth for "
                "this person. Each anchor's exact expression, valence, and arousal "
                "appears immediately before its image. The final image is the target. "
                f"The target is known to be {emotion}; do not reclassify it."
            ),
            (
                "Compare the target against the anchor groups and choose exactly one "
                "qualitative position for each dimension. Different muscle "
                "configurations can express the same intensity. Judge total "
                "pleasantness and activation rather than demanding a stereotyped "
                "visual match. For valence, more negative is numerically lower; for "
                "arousal, more activated is numerically higher."
            ),
            f"VALENCE OPTIONS:\n{render('valence')}",
            f"AROUSAL OPTIONS:\n{render('arousal')}",
            (
                "Return only this JSON with no markdown, explanation, or numeric "
                'scores: {"valence_option": "OPTION_ID", '
                '"arousal_option": "OPTION_ID"}'
            ),
        ]
    )


def request_parts(
    prompt: str,
    emotion: str,
    anchors: list[dict[str, Any]],
    target: dict[str, Any],
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for index, anchor in enumerate(anchors, start=1):
        parts.extend(
            [
                {
                    "text": (
                        f"ANCHOR {index}: expression={emotion}; "
                        f"valence={float(anchor['valence']):+.1f}; "
                        f"arousal={float(anchor['arousal']):+.1f}; "
                        f"role={anchor['anchor']}"
                    )
                },
                {
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": _encode_image(V2 / anchor["image"]),
                    }
                },
            ]
        )
    parts.extend(
        [
            {
                "text": (
                    f"TARGET: known expression={emotion}; "
                    "valence and arousal are hidden"
                )
            },
            {
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": _encode_image(V1 / target["image"]),
                }
            },
        ]
    )
    return parts


def request_gemini(
    model: str, parts: list[dict[str, Any]]
) -> tuple[dict[str, Any], str]:
    last_error: Exception | None = None
    last_raw = ""
    for _ in range(2):
        body = _post_json(
            (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent"
            ),
            {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {
                    "temperature": 0,
                    # Keep reasoning bounded; the parser repairs a missing final brace.
                    "maxOutputTokens": 1024,
                    "responseMimeType": "application/json",
                },
            },
            {"x-goog-api-key": _gemini_api_key()},
        )
        candidates = body.get("candidates") or []
        if not candidates:
            last_error = RuntimeError(f"Gemini returned no candidates: {body}")
            continue
        last_raw = "".join(
            str(part.get("text", "")) for part in candidates[0]["content"]["parts"]
        ).strip()
        try:
            return _parse_json_object_relaxed(last_raw), last_raw
        except (json.JSONDecodeError, KeyError, ValueError) as error:
            last_error = error
    raise RuntimeError(
        f"Gemini failed to return complete JSON after 2 attempts: {last_raw!r}"
    ) from last_error


def _parse_json_object_relaxed(raw: str) -> dict[str, Any]:
    try:
        return _parse_json_object(raw)
    except (KeyError, ValueError):
        cleaned = (
            raw.strip()
            .removeprefix("```json")
            .removeprefix("```")
            .removesuffix("```")
            .strip()
        )
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            # JSON-mode responses occasionally omit only the final quote/brace.
            options = {
                key: match.group(1)
                for key in ("valence_option", "arousal_option")
                if (match := re.search(rf'"{key}"\s*:\s*"([A-Z0-9_]+)', cleaned))
            }
            if set(options) == {"valence_option", "arousal_option"}:
                return options
            numbers = {
                key: float(match.group(1))
                for key in ("valence", "arousal")
                if (match := re.search(rf'"{key}"\s*:\s*(-?\d+(?:\.\d+)?)', cleaned))
            }
            if set(numbers) == {"valence", "arousal"}:
                return numbers
            raise
        if not isinstance(parsed, dict):
            raise ValueError("Gemini response must be a JSON object") from None
        return parsed


def resolve_choice(
    prediction: dict[str, Any], options: dict[str, list[dict[str, Any]]]
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for dimension in ("valence", "arousal"):
        option_id = str(prediction[f"{dimension}_option"])
        by_id = {option["id"]: option for option in options[dimension]}
        if option_id not in by_id:
            raise ValueError(f"Unknown {dimension} option from Gemini: {option_id}")
        result[f"{dimension}_option"] = option_id
        result[dimension] = float(by_id[option_id]["value"])
    return result


def score(samples: list[dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for condition in ("direct", "choices"):
        labeled = [
            sample
            for sample in samples
            if sample["target"]["human_valence"] is not None
            and sample["target"]["human_arousal"] is not None
        ]
        errors: dict[str, list[float]] = {"valence": [], "arousal": []}
        signed: dict[str, list[float]] = {"valence": [], "arousal": []}
        for sample in labeled:
            prediction = sample["conditions"][condition]["prediction"]
            for dimension in ("valence", "arousal"):
                difference = float(prediction[dimension]) - float(
                    sample["target"][f"human_{dimension}"]
                )
                signed[dimension].append(difference)
                errors[dimension].append(abs(difference))
        summary[condition] = {
            "scored_targets": len(labeled),
            **{
                f"{dimension}_mae": sum(errors[dimension]) / len(labeled)
                for dimension in ("valence", "arousal")
            },
            **{
                f"{dimension}_mean_signed_error": sum(signed[dimension]) / len(labeled)
                for dimension in ("valence", "arousal")
            },
            **{
                f"{dimension}_within_0.2": sum(
                    error <= 0.2000001 for error in errors[dimension]
                )
                / len(labeled)
                for dimension in ("valence", "arousal")
            },
        }
    return summary


def run(args: argparse.Namespace) -> dict[str, Any]:
    anchors_by_emotion = training_anchors(read_manifest(V2))
    targets_by_emotion = select_targets(read_manifest(V1), args.targets_per_expression)
    samples: list[dict[str, Any]] = []
    completed: dict[tuple[str, str], dict[str, Any]] = {}
    if args.resume and args.output.exists():
        previous = json.loads(args.output.read_text())
        completed = {
            (sample["emotion"], sample["target"]["image"]): sample
            for sample in previous.get("samples", [])
        }

    for emotion in EMOTIONS:
        anchors = anchors_by_emotion[emotion]
        options = choice_options(emotion, anchors)
        for target in targets_by_emotion[emotion]:
            key = (emotion, target["image"])
            if key in completed:
                samples.append(completed[key])
                continue
            conditions: dict[str, Any] = {}
            for condition, prompt in (
                ("direct", direct_prompt(emotion)),
                ("choices", choice_prompt(emotion, options)),
            ):
                prediction, raw = request_gemini(
                    args.gemini_model,
                    request_parts(prompt, emotion, anchors, target),
                )
                if condition == "direct":
                    prediction = {
                        "valence": round(float(prediction["valence"]), 1),
                        "arousal": round(float(prediction["arousal"]), 1),
                    }
                    for value in prediction.values():
                        if not -1.0 <= value <= 1.0:
                            raise ValueError(
                                f"Direct prediction outside [-1, 1]: {prediction}"
                            )
                else:
                    prediction = resolve_choice(prediction, options)
                conditions[condition] = {
                    "prediction": prediction,
                    "raw_response": raw,
                    "prompt": prompt,
                }
                print(
                    f"{emotion:9s} {target['image']} {condition:7s} "
                    f"V={prediction['valence']:+.1f} A={prediction['arousal']:+.1f}",
                    flush=True,
                )
            sample = {
                "emotion": emotion,
                "anchors": [
                    {
                        "image": anchor["image"],
                        "anchor": anchor["anchor"],
                        "human_valence": anchor["valence"],
                        "human_arousal": anchor["arousal"],
                    }
                    for anchor in anchors
                ],
                "target": {
                    "image": target["image"],
                    "human_expression": target["label"],
                    "human_valence": target.get("valence"),
                    "human_arousal": target.get("arousal"),
                },
                "choice_options": options,
                "conditions": conditions,
            }
            samples.append(sample)
            _write_result(args.output, args.gemini_model, samples)
            if args.limit and len(samples) >= args.limit:
                return _write_result(args.output, args.gemini_model, samples)
    return _write_result(args.output, args.gemini_model, samples)


def _write_result(
    output: Path, model: str, samples: list[dict[str, Any]]
) -> dict[str, Any]:
    result = {
        "created_at": datetime.now(UTC).isoformat(),
        "model": model,
        "protocol": {
            "targets_per_expression": 3,
            "v2_training_anchors_only": True,
            "target_labels_hidden_from_gemini": True,
            "paired_prompt_conditions": ["direct", "choices"],
        },
        "samples": samples,
        "summary": score(samples) if samples else {},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _short_anchor_role(anchor: str) -> str:
    if anchor.startswith("valence_neutral"):
        valence = "V 0"
    elif "valence_negative_high" in anchor:
        valence = "V- HI"
    elif "valence_negative_low" in anchor:
        valence = "V- LO"
    elif "valence_positive_high" in anchor:
        valence = "V+ HI"
    else:
        valence = "V+ LO"
    arousal = "A HI" if "arousal_high" in anchor else "A LO"
    return f"{valence} / {arousal}"


def create_visuals(result: dict[str, Any], directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    by_emotion: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for sample in result["samples"]:
        by_emotion[sample["emotion"]].append(sample)
    for emotion in EMOTIONS:
        if emotion not in by_emotion:
            continue
        samples = by_emotion[emotion]
        anchors = samples[0]["anchors"]
        canvas = Image.new("RGB", (1680, 980), "white")
        draw = ImageDraw.Draw(canvas)
        draw.text(
            (30, 20),
            f"{emotion.upper()} — V2 HUMAN ANCHORS",
            fill="black",
            font=_font(30),
        )
        anchor_width = 200
        for index, anchor in enumerate(anchors):
            x = 30 + index * anchor_width
            image = Image.open(V2 / anchor["image"]).convert("RGB")
            image = ImageOps.fit(image, (180, 180))
            canvas.paste(image, (x, 70))
            label = (
                f"A{index + 1}  V={anchor['human_valence']:+.1f}\n"
                f"A={anchor['human_arousal']:+.1f}\n"
                f"{_short_anchor_role(anchor['anchor'])}"
            )
            draw.multiline_text(
                (x, 258), label, fill="black", font=_font(16), spacing=3
            )
        draw.line((20, 370, 1660, 370), fill="#999999", width=2)
        draw.text(
            (30, 390), "V1 TARGETS — HUMAN VS GEMINI", fill="black", font=_font(30)
        )
        for index, sample in enumerate(samples):
            x = 30 + index * 550
            target = sample["target"]
            image = Image.open(V1 / target["image"]).convert("RGB")
            image = ImageOps.fit(image, (500, 380))
            canvas.paste(image, (x, 440))
            human = (
                "unlabeled"
                if target["human_valence"] is None
                else (
                    f"V={target['human_valence']:+.1f} A={target['human_arousal']:+.1f}"
                )
            )
            direct = sample["conditions"]["direct"]["prediction"]
            choices = sample["conditions"]["choices"]["prediction"]
            label = (
                f"T{index + 1} HUMAN {human}\n"
                f"DIRECT  V={direct['valence']:+.1f} A={direct['arousal']:+.1f}\n"
                f"CHOICE  V={choices['valence']:+.1f} A={choices['arousal']:+.1f}"
            )
            draw.multiline_text(
                (x, 832), label, fill="black", font=_font(21), spacing=4
            )
        path = directory / f"{emotion}_results.png"
        canvas.save(path)
        paths.append(path)
    return paths


def write_report(result: dict[str, Any], output: Path, visuals: list[Path]) -> None:
    summary = result["summary"]
    lines = [
        "# Gemini V/A anchor interpolation",
        "",
        (
            f"Model: `{result['model']}`. Each condition used the same v2 human "
            "anchors and the same v1 target; target V/A labels were hidden from "
            "Gemini."
        ),
        "",
        "| Prompt | Valence MAE | Arousal MAE | V within 0.2 | A within 0.2 |",
        "|---|---:|---:|---:|---:|",
    ]
    for condition in ("direct", "choices"):
        row = summary[condition]
        lines.append(
            f"| {condition} | {row['valence_mae']:.3f} | {row['arousal_mae']:.3f} | "
            f"{row['valence_within_0.2']:.1%} | {row['arousal_within_0.2']:.1%} |"
        )
    lines.extend(
        [
            "",
            "## Per-expression MAE",
            "",
            "| Expression | Scored | Direct V | Direct A | Choice V | Choice A |",
            "|---|---:|---:|---:|---:|---:|",
        ]
    )
    for emotion in EMOTIONS:
        labeled = [
            sample
            for sample in result["samples"]
            if sample["emotion"] == emotion
            and sample["target"]["human_valence"] is not None
        ]
        metrics = score(labeled)
        lines.append(
            f"| {emotion} | {len(labeled)} | "
            f"{metrics['direct']['valence_mae']:.3f} | "
            f"{metrics['direct']['arousal_mae']:.3f} | "
            f"{metrics['choices']['valence_mae']:.3f} | "
            f"{metrics['choices']['arousal_mae']:.3f} |"
        )
    lines.extend(
        [
            "",
            "The direct prompt performed better overall. The choice ladder improved "
            "both dimensions for surprise and arousal for contempt, but it also made "
            "large endpoint-selection errors. One disgust target labeled A=+0.8 was "
            "mapped to the low-arousal anchor at A=-0.5.",
            "",
            "A source-label audit corrected one contempt target from V=+0.3 to "
            "V=-0.5. The displayed metrics and sheets use the corrected label; "
            "Gemini's stored predictions were not rerun or altered.",
            "",
            "## Image-level results",
            "",
        ]
    )
    for path in visuals:
        relative_path = path.relative_to(output.parent)
        lines.extend(
            [
                f"### {path.stem.title()}",
                "",
                f"![{path.stem}]({relative_path})",
                "",
            ]
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gemini-model", default="gemini-3.6-flash")
    parser.add_argument("--targets-per-expression", type=int, default=3)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--visuals", type=Path, default=DEFAULT_VISUALS)
    parser.add_argument("--resume", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--limit", type=int, help="Stop after this many paired targets")
    parser.add_argument("--render-only", action="store_true")
    args = parser.parse_args()
    result = json.loads(args.output.read_text()) if args.render_only else run(args)
    if args.render_only:
        refresh_target_labels(result)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    if len(result["samples"]) == len(EMOTIONS) * args.targets_per_expression:
        visuals = create_visuals(result, args.visuals)
        write_report(result, args.report, visuals)
        print(json.dumps(result["summary"], indent=2))
        print(f"Saved {args.output}, {args.report}, and {len(visuals)} visual sheets")


if __name__ == "__main__":
    main()
