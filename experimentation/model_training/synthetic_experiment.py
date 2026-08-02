"""Generate cheap expression-preserving variants and sweep real/synthetic mixes."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image

try:
    from .metrics import classification_metrics, compact_metric_values
    from .train_head import EMOTIONS, INDEX
except ImportError:
    from metrics import classification_metrics, compact_metric_values
    from train_head import EMOTIONS, INDEX

ROOT = Path(__file__).parent
DEFAULT_DATA = ROOT / "human_data" / "rithvik_expressions_v1"
DEFAULT_REPORT = ROOT / "artifacts" / "rithvik_v1_head_all.json"
DEFAULT_ORIGINAL_CACHE = ROOT / "artifacts" / "rithvik_v1_embeddings.npz"
DEFAULT_SYNTHETIC = ROOT / "synthetic_data" / "cheap_v1"
DEFAULT_SYNTHETIC_CACHE = ROOT / "artifacts" / "rithvik_v1_cheap_embeddings.npz"
DEFAULT_RESULTS = ROOT / "results" / "synthetic_sweep.json"
DEFAULT_CADENCE_RESULTS = ROOT / "results" / "synthetic_cadence.json"
DEFAULT_WEIGHTED_RESULTS = ROOT / "results" / "synthetic_weighted.json"
DEFAULT_EMBEDDING_RESULTS = ROOT / "results" / "embedding_sweep.json"


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))


def seed_for(*parts: object) -> int:
    digest = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(digest[:8], "big")


def affine(image: np.ndarray, rng: np.random.Generator, tier: str) -> np.ndarray:
    height, width = image.shape[:2]
    limits = {
        "mild": (2.0, 0.015, 0.02),
        "medium": (5.0, 0.035, 0.04),
        "aggressive": (9.0, 0.07, 0.07),
    }
    angle_limit, scale_limit, shift_limit = limits[tier]
    angle = rng.uniform(-angle_limit, angle_limit)
    scale = rng.uniform(1.0 - scale_limit, 1.0 + scale_limit)
    center = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, scale)
    matrix[0, 2] += rng.uniform(-shift_limit, shift_limit) * width
    matrix[1, 2] += rng.uniform(-shift_limit, shift_limit) * height
    return cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def photometric(
    image: np.ndarray, rng: np.random.Generator, tier: str
) -> np.ndarray:
    limits = {
        "mild": ((0.85, 1.15), (-12, 12), (0.92, 1.08), 2.0),
        "medium": ((0.70, 1.30), (-24, 24), (0.82, 1.18), 4.0),
        "aggressive": ((0.50, 1.50), (-40, 40), (0.68, 1.32), 7.0),
    }
    gain_range, offset_range, color_range, noise_sigma = limits[tier]
    output = image.astype(np.float32)
    output *= rng.uniform(*gain_range)
    output += rng.uniform(*offset_range)
    output *= rng.uniform(*color_range, size=(1, 1, 3))
    output += rng.normal(0, noise_sigma, output.shape)
    output = np.clip(output, 0, 255).astype(np.uint8)
    if rng.random() < {"mild": 0.15, "medium": 0.35, "aggressive": 0.55}[tier]:
        kernel = int(rng.choice([3, 5]))
        output = cv2.GaussianBlur(output, (kernel, kernel), 0)
    return output


def background_shift(
    image: np.ndarray, rng: np.random.Generator, tier: str
) -> np.ndarray:
    """Cheaply vary the periphery while keeping the central face region intact."""
    height, width = image.shape[:2]
    yy, xx = np.ogrid[:height, :width]
    cx = width * rng.uniform(0.46, 0.54)
    cy = height * rng.uniform(0.43, 0.51)
    rx = width * 0.24
    ry = height * 0.37
    distance = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    foreground = np.clip(1.35 - distance, 0.0, 1.0)[..., None].astype(np.float32)
    if tier == "mild":
        background = cv2.GaussianBlur(image, (21, 21), 0)
    elif tier == "medium":
        background = cv2.GaussianBlur(image, (41, 41), 0).astype(np.float32)
        background *= rng.uniform(0.65, 1.25, size=(1, 1, 3))
        background = np.clip(background, 0, 255).astype(np.uint8)
    else:
        color = rng.integers(25, 230, size=(1, 1, 3), dtype=np.uint8)
        blurred = cv2.GaussianBlur(image, (61, 61), 0)
        background = cv2.addWeighted(
            blurred, 0.35, np.broadcast_to(color, image.shape), 0.65, 0
        )
    return np.clip(
        foreground * image + (1.0 - foreground) * background, 0, 255
    ).astype(np.uint8)


def make_variant(image: np.ndarray, rng: np.random.Generator, tier: str) -> np.ndarray:
    output = affine(image, rng, tier)
    output = photometric(output, rng, tier)
    if rng.random() < {"mild": 0.2, "medium": 0.5, "aggressive": 0.8}[tier]:
        output = background_shift(output, rng, tier)
    quality_ranges = {
        "mild": (88, 98),
        "medium": (72, 94),
        "aggressive": (52, 88),
    }
    quality = int(rng.integers(*quality_ranges[tier]))
    ok, encoded = cv2.imencode(".jpg", output, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("Could not encode augmented image")
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR)


def generate(
    data_dir: Path,
    report_path: Path,
    output_dir: Path,
    per_source: int,
    max_sources_per_class: int,
) -> None:
    rows = read_jsonl(data_dir / "manifest.jsonl")
    validation = set(json.loads(report_path.read_text())["validation_images"])
    train_by_label: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row["image"] not in validation:
            train_by_label[row["label"]].append(row)
    output_dir.mkdir(parents=True, exist_ok=True)
    generated: list[dict] = []
    tiers = ("mild", "medium", "aggressive")
    for label in EMOTIONS:
        sources = sorted(train_by_label[label], key=lambda row: row["image"])
        sources = sources[:max_sources_per_class]
        for source in sources:
            image = cv2.imread(str(data_dir / source["image"]))
            if image is None:
                raise ValueError(f"Could not decode {source['image']}")
            for variant_index in range(per_source):
                tier = tiers[variant_index % len(tiers)]
                rng = np.random.default_rng(
                    seed_for(source["image"], variant_index, tier)
                )
                variant = make_variant(image, rng, tier)
                stem = Path(source["image"]).stem
                filename = f"{stem}__{tier}_{variant_index:02d}.jpg"
                cv2.imwrite(
                    str(output_dir / filename),
                    variant,
                    [cv2.IMWRITE_JPEG_QUALITY, 95],
                )
                generated.append(
                    {
                        "image": filename,
                        "label": label,
                        "source_image": source["image"],
                        "kind": "cheap",
                        "tier": tier,
                        "variant": variant_index,
                    }
                )
    write_jsonl(output_dir / "manifest.jsonl", generated)
    source_count = sum(
        len(value[:max_sources_per_class]) for value in train_by_label.values()
    )
    print(
        f"generated {len(generated)} variants from "
        f"{source_count} real sources into {output_dir}"
    )


def extract(data_dir: Path, cache: Path, model_name: str) -> None:
    from emotiefflib.facial_analysis import EmotiEffLibRecognizer
    from facenet_pytorch import MTCNN

    rows = read_jsonl(data_dir / "manifest.jsonl")
    recognizer = EmotiEffLibRecognizer(
        engine="onnx", model_name=model_name, device="cpu"
    )
    detector = MTCNN(
        keep_all=True, post_process=False, min_face_size=40, device="cpu"
    )
    features: list[np.ndarray] = []
    kept: list[dict] = []
    for index, row in enumerate(rows, 1):
        image = np.asarray(Image.open(data_dir / row["image"]).convert("RGB"))
        boxes, probabilities = detector.detect(image)
        candidates = [
            (box, float(probability))
            for box, probability in zip(
                boxes if boxes is not None else [],
                probabilities if probabilities is not None else [],
                strict=False,
            )
            if probability is not None and float(probability) >= 0.90
        ]
        if not candidates:
            continue
        box, _ = max(
            candidates,
            key=lambda item: (item[0][2] - item[0][0])
            * (item[0][3] - item[0][1]),
        )
        height, width = image.shape[:2]
        x1 = max(0, min(width, int(box[0])))
        y1 = max(0, min(height, int(box[1])))
        x2 = max(0, min(width, int(box[2])))
        y2 = max(0, min(height, int(box[3])))
        face = image[y1:y2, x1:x2]
        if face.size:
            features.append(recognizer.extract_features(face)[0])
            kept.append(row)
        if index % 50 == 0:
            print(f"processed {index}/{len(rows)}")
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache,
        features=np.asarray(features, dtype=np.float32),
        labels=np.asarray([INDEX[row["label"]] for row in kept], dtype=np.int64),
        rows=np.asarray([json.dumps(row) for row in kept]),
    )
    print(f"wrote {len(kept)}/{len(rows)} synthetic embeddings to {cache}")


def load_cache(path: Path) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    payload = np.load(path, allow_pickle=False)
    return (
        payload["features"],
        payload["labels"],
        [json.loads(value) for value in payload["rows"]],
    )


def original_head() -> tuple[torch.Tensor, torch.Tensor]:
    from emotiefflib.facial_analysis import EmotiEffLibRecognizer

    recognizer = EmotiEffLibRecognizer(
        engine="onnx", model_name="enet_b0_8_best_afew", device="cpu"
    )
    return (
        torch.from_numpy(recognizer.classifier_weights.copy()),
        torch.from_numpy(recognizer.classifier_bias.copy()),
    )


def fit_head(
    train_x: np.ndarray,
    train_y: np.ndarray,
    val_x: np.ndarray,
    val_y: np.ndarray,
    base_weight: torch.Tensor,
    base_bias: torch.Tensor,
    seed: int,
    epochs: int = 100,
) -> tuple[dict, int]:
    torch.manual_seed(seed)
    head = torch.nn.Linear(1280, 8)
    with torch.no_grad():
        head.weight.copy_(base_weight)
        head.bias.copy_(base_bias)
    optimizer = torch.optim.AdamW(head.parameters(), lr=2e-3, weight_decay=1e-4)
    x = torch.from_numpy(train_x)
    y = torch.from_numpy(train_y)
    vx = torch.from_numpy(val_x)
    vy = torch.from_numpy(val_y)
    best = -1.0
    best_epoch = 0
    best_metrics = None
    for epoch in range(1, epochs + 1):
        logits = head(x)
        loss = torch.nn.functional.cross_entropy(logits, y)
        anchor = 1e-3 * (
            (head.weight - base_weight).square().mean()
            + (head.bias - base_bias).square().mean()
        )
        (loss + anchor).backward()
        optimizer.step()
        optimizer.zero_grad()
        with torch.no_grad():
            validation_logits = head(vx)
            accuracy = float((validation_logits.argmax(1) == vy).float().mean())
        if accuracy > best:
            best, best_epoch = accuracy, epoch
            best_metrics = classification_metrics(
                validation_logits,
                vy,
                EMOTIONS,
                max_error_records=3,
            )
    assert best_metrics is not None
    return best_metrics, best_epoch


def fit_cadence(
    real_x: np.ndarray,
    real_y: np.ndarray,
    synthetic_x: np.ndarray,
    synthetic_y: np.ndarray,
    val_x: np.ndarray,
    val_y: np.ndarray,
    base_weight: torch.Tensor,
    base_bias: torch.Tensor,
    seed: int,
    real_every: int,
    steps: int,
    batch_size: int = 16,
) -> dict:
    """Train with one real batch after every N synthetic batches."""
    if not len(synthetic_x):
        raise ValueError("Cadence training requires synthetic examples")
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    head = torch.nn.Linear(1280, 8)
    with torch.no_grad():
        head.weight.copy_(base_weight)
        head.bias.copy_(base_bias)
    optimizer = torch.optim.AdamW(head.parameters(), lr=5e-4, weight_decay=1e-4)
    rx = torch.from_numpy(real_x)
    ry = torch.from_numpy(real_y)
    sx = torch.from_numpy(synthetic_x)
    sy = torch.from_numpy(synthetic_y)
    for step in range(steps):
        # real_every=1 gives S,R,S,R; 3 gives S,S,S,R, etc.
        use_real = (step + 1) % (real_every + 1) == 0
        source_x, source_y = (rx, ry) if use_real else (sx, sy)
        indices = rng.integers(0, len(source_y), size=min(batch_size, len(source_y)))
        logits = head(source_x[indices])
        loss = torch.nn.functional.cross_entropy(logits, source_y[indices])
        anchor = 1e-3 * (
            (head.weight - base_weight).square().mean()
            + (head.bias - base_bias).square().mean()
        )
        (loss + anchor).backward()
        optimizer.step()
        optimizer.zero_grad()
    with torch.no_grad():
        return classification_metrics(
            head(torch.from_numpy(val_x)),
            torch.from_numpy(val_y),
            EMOTIONS,
            max_error_records=3,
        )


def fit_weighted(
    real_x: np.ndarray,
    real_y: np.ndarray,
    synthetic_x: np.ndarray,
    synthetic_y: np.ndarray,
    val_x: np.ndarray,
    val_y: np.ndarray,
    base_weight: torch.Tensor,
    base_bias: torch.Tensor,
    seed: int,
    synthetic_weight: float,
    epochs: int = 100,
) -> dict:
    """Keep real loss at full strength and vary only synthetic loss weight."""
    torch.manual_seed(seed)
    head = torch.nn.Linear(1280, 8)
    with torch.no_grad():
        head.weight.copy_(base_weight)
        head.bias.copy_(base_bias)
    optimizer = torch.optim.AdamW(head.parameters(), lr=2e-3, weight_decay=1e-4)
    rx, ry = torch.from_numpy(real_x), torch.from_numpy(real_y)
    sx, sy = torch.from_numpy(synthetic_x), torch.from_numpy(synthetic_y)
    vx, vy = torch.from_numpy(val_x), torch.from_numpy(val_y)
    best = -1.0
    best_metrics = None
    for _ in range(epochs):
        real_loss = torch.nn.functional.cross_entropy(head(rx), ry)
        synthetic_loss = torch.nn.functional.cross_entropy(head(sx), sy)
        anchor = 1e-3 * (
            (head.weight - base_weight).square().mean()
            + (head.bias - base_bias).square().mean()
        )
        (real_loss + synthetic_weight * synthetic_loss + anchor).backward()
        optimizer.step()
        optimizer.zero_grad()
        with torch.no_grad():
            validation_logits = head(vx)
            accuracy = float((validation_logits.argmax(1) == vy).float().mean())
        if accuracy > best:
            best = accuracy
            best_metrics = classification_metrics(
                validation_logits,
                vy,
                EMOTIONS,
                max_error_records=3,
            )
    assert best_metrics is not None
    return best_metrics


def aggregate_run_metrics(runs: list[dict]) -> tuple[dict, dict]:
    compact = [compact_metric_values(run["metrics"]) for run in runs]
    names = sorted(set.intersection(*(set(values) for values in compact)))
    means = {
        name: float(np.mean([values[name] for values in compact])) for name in names
    }
    standard_deviations = {
        name: float(np.std([values[name] for values in compact])) for name in names
    }
    return means, standard_deviations


def select_real(
    features: np.ndarray,
    labels: np.ndarray,
    rows: list[dict],
    validation: set[str],
    per_class: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    rng = random.Random(seed)
    indices: list[int] = []
    for label in range(len(EMOTIONS)):
        candidates = [
            index
            for index, row in enumerate(rows)
            if labels[index] == label and row["image"] not in validation
        ]
        rng.shuffle(candidates)
        indices.extend(candidates[:per_class])
    selected = np.asarray(indices, dtype=np.int64)
    return features[selected], labels[selected], [rows[index] for index in selected]


def matching_synthetic(
    features: np.ndarray,
    labels: np.ndarray,
    rows: list[dict],
    selected_real: list[dict],
    per_real: int,
    tiers: set[str],
    seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    rng = random.Random(seed)
    by_source: dict[str, list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        if row.get("tier") in tiers:
            by_source[row["source_image"]].append(index)
    indices: list[int] = []
    for source in selected_real:
        candidates = by_source[source["image"]][:]
        rng.shuffle(candidates)
        indices.extend(candidates[:per_real])
    if not indices:
        return np.empty((0, 1280), np.float32), np.empty((0,), np.int64)
    selected = np.asarray(indices, dtype=np.int64)
    return features[selected], labels[selected]


def sweep(
    original_cache: Path,
    synthetic_cache: Path,
    report_path: Path,
    output: Path,
    real_counts: list[int],
    synthetic_counts: list[int],
    seeds: list[int],
    tiers: set[str],
) -> None:
    real_x, real_y, real_rows = load_cache(original_cache)
    synthetic_x, synthetic_y, synthetic_rows = load_cache(synthetic_cache)
    validation = set(json.loads(report_path.read_text())["validation_images"])
    val_indices = np.asarray(
        [index for index, row in enumerate(real_rows) if row["image"] in validation],
        dtype=np.int64,
    )
    val_x, val_y = real_x[val_indices], real_y[val_indices]
    base_weight, base_bias = original_head()
    with torch.no_grad():
        original_metrics = classification_metrics(
            torch.from_numpy(val_x) @ base_weight.T + base_bias,
            torch.from_numpy(val_y),
            EMOTIONS,
            max_error_records=3,
        )
    original_accuracy = original_metrics["accuracy"]
    results: list[dict] = []
    for real_per_class in real_counts:
        for synthetic_per_real in synthetic_counts:
            scores = []
            for seed in seeds:
                rx, ry, selected_rows = select_real(
                    real_x,
                    real_y,
                    real_rows,
                    validation,
                    real_per_class,
                    seed,
                )
                sx, sy = matching_synthetic(
                    synthetic_x,
                    synthetic_y,
                    synthetic_rows,
                    selected_rows,
                    synthetic_per_real,
                    tiers,
                    seed,
                )
                train_x = np.concatenate((rx, sx))
                train_y = np.concatenate((ry, sy))
                metrics, best_epoch = fit_head(
                    train_x,
                    train_y,
                    val_x,
                    val_y,
                    base_weight,
                    base_bias,
                    seed,
                )
                scores.append(
                    {
                        "seed": seed,
                        "accuracy": metrics["accuracy"],
                        "best_epoch": best_epoch,
                        "real_examples": len(rx),
                        "synthetic_examples": len(sx),
                        "metrics": metrics,
                    }
                )
            accuracies = [item["accuracy"] for item in scores]
            mean_metrics, std_metrics = aggregate_run_metrics(scores)
            result = {
                "real_per_class": real_per_class,
                "synthetic_per_real": synthetic_per_real,
                "tiers": sorted(tiers),
                "mean_accuracy": float(np.mean(accuracies)),
                "std_accuracy": float(np.std(accuracies)),
                "mean_metrics": mean_metrics,
                "std_metrics": std_metrics,
                "runs": scores,
            }
            results.append(result)
            print(
                f"real/class={real_per_class:2d} "
                f"synthetic/real={synthetic_per_real:2d} "
                f"accuracy={result['mean_accuracy']:.3f}±{result['std_accuracy']:.3f} "
                f"nll={mean_metrics['negative_log_likelihood']:.3f} "
                f"brier={mean_metrics['brier_score']:.3f} "
                f"auc={mean_metrics['roc_auc_ovr_macro']:.3f}"
            )
    document = {
        "validation_examples": len(val_indices),
        "original_head_accuracy": original_accuracy,
        "original_head_metrics": original_metrics,
        "results": results,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, indent=2) + "\n")
    csv_path = output.with_suffix(".csv")
    with csv_path.open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=(
                "real_per_class",
                "synthetic_per_real",
                "mean_accuracy",
                "std_accuracy",
                "mean_negative_log_likelihood",
                "mean_median_negative_log_likelihood",
                "mean_p90_negative_log_likelihood",
                "mean_max_negative_log_likelihood",
                "mean_brier_score",
                "mean_roc_auc_ovr_macro",
                "mean_expected_calibration_error",
                "mean_confidence_when_correct",
                "mean_confidence_when_incorrect",
            ),
        )
        writer.writeheader()
        for row in results:
            writer.writerow(
                {
                    "real_per_class": row["real_per_class"],
                    "synthetic_per_real": row["synthetic_per_real"],
                    "mean_accuracy": row["mean_accuracy"],
                    "std_accuracy": row["std_accuracy"],
                    "mean_negative_log_likelihood": row["mean_metrics"][
                        "negative_log_likelihood"
                    ],
                    "mean_median_negative_log_likelihood": row["mean_metrics"][
                        "median_negative_log_likelihood"
                    ],
                    "mean_p90_negative_log_likelihood": row["mean_metrics"][
                        "p90_negative_log_likelihood"
                    ],
                    "mean_max_negative_log_likelihood": row["mean_metrics"][
                        "max_negative_log_likelihood"
                    ],
                    "mean_brier_score": row["mean_metrics"]["brier_score"],
                    "mean_roc_auc_ovr_macro": row["mean_metrics"][
                        "roc_auc_ovr_macro"
                    ],
                    "mean_expected_calibration_error": row["mean_metrics"][
                        "expected_calibration_error"
                    ],
                    "mean_confidence_when_correct": row["mean_metrics"][
                        "mean_confidence_when_correct"
                    ],
                    "mean_confidence_when_incorrect": row["mean_metrics"].get(
                        "mean_confidence_when_incorrect"
                    ),
                }
            )
    print(f"wrote {output} and {csv_path}")


def cadence(
    original_cache: Path,
    synthetic_cache: Path,
    report_path: Path,
    output: Path,
    real_counts: list[int],
    real_periods: list[int],
    seeds: list[int],
    tiers: set[str],
    synthetic_per_real: int,
    steps: int,
) -> None:
    real_x, real_y, real_rows = load_cache(original_cache)
    synthetic_x, synthetic_y, synthetic_rows = load_cache(synthetic_cache)
    validation = set(json.loads(report_path.read_text())["validation_images"])
    val_indices = np.asarray(
        [index for index, row in enumerate(real_rows) if row["image"] in validation],
        dtype=np.int64,
    )
    val_x, val_y = real_x[val_indices], real_y[val_indices]
    base_weight, base_bias = original_head()
    results: list[dict] = []
    for real_per_class in real_counts:
        for real_every in real_periods:
            runs: list[dict] = []
            for seed in seeds:
                rx, ry, selected_rows = select_real(
                    real_x,
                    real_y,
                    real_rows,
                    validation,
                    real_per_class,
                    seed,
                )
                sx, sy = matching_synthetic(
                    synthetic_x,
                    synthetic_y,
                    synthetic_rows,
                    selected_rows,
                    synthetic_per_real,
                    tiers,
                    seed,
                )
                metrics = fit_cadence(
                    rx,
                    ry,
                    sx,
                    sy,
                    val_x,
                    val_y,
                    base_weight,
                    base_bias,
                    seed,
                    real_every,
                    steps,
                )
                runs.append(
                    {
                        "seed": seed,
                        "accuracy": metrics["accuracy"],
                        "metrics": metrics,
                    }
                )
            mean_metrics, std_metrics = aggregate_run_metrics(runs)
            result = {
                "real_per_class": real_per_class,
                "synthetic_per_real": synthetic_per_real,
                "real_every_n_synthetic_batches": real_every,
                "approximate_real_batch_fraction": 1.0 / (real_every + 1),
                "steps": steps,
                "tiers": sorted(tiers),
                "mean_accuracy": mean_metrics["accuracy"],
                "std_accuracy": std_metrics["accuracy"],
                "mean_metrics": mean_metrics,
                "std_metrics": std_metrics,
                "scores": [run["accuracy"] for run in runs],
                "runs": runs,
            }
            results.append(result)
            print(
                f"real/class={real_per_class:2d} cadence=1:{real_every:<2d} "
                f"real_fraction={result['approximate_real_batch_fraction']:.3f} "
                f"accuracy={result['mean_accuracy']:.3f}±{result['std_accuracy']:.3f} "
                f"nll={mean_metrics['negative_log_likelihood']:.3f} "
                f"auc={mean_metrics['roc_auc_ovr_macro']:.3f}"
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "validation_examples": len(val_indices),
                "schedule": "one real batch after N synthetic batches",
                "results": results,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {output}")


def weighted(
    original_cache: Path,
    synthetic_cache: Path,
    report_path: Path,
    output: Path,
    real_counts: list[int],
    synthetic_weights: list[float],
    seeds: list[int],
    tiers: set[str],
    synthetic_per_real: int,
) -> None:
    real_x, real_y, real_rows = load_cache(original_cache)
    synthetic_x, synthetic_y, synthetic_rows = load_cache(synthetic_cache)
    validation = set(json.loads(report_path.read_text())["validation_images"])
    val_indices = np.asarray(
        [index for index, row in enumerate(real_rows) if row["image"] in validation],
        dtype=np.int64,
    )
    val_x, val_y = real_x[val_indices], real_y[val_indices]
    base_weight, base_bias = original_head()
    results: list[dict] = []
    for real_per_class in real_counts:
        for synthetic_weight in synthetic_weights:
            runs: list[dict] = []
            for seed in seeds:
                rx, ry, selected_rows = select_real(
                    real_x,
                    real_y,
                    real_rows,
                    validation,
                    real_per_class,
                    seed,
                )
                sx, sy = matching_synthetic(
                    synthetic_x,
                    synthetic_y,
                    synthetic_rows,
                    selected_rows,
                    synthetic_per_real,
                    tiers,
                    seed,
                )
                metrics = fit_weighted(
                    rx,
                    ry,
                    sx,
                    sy,
                    val_x,
                    val_y,
                    base_weight,
                    base_bias,
                    seed,
                    synthetic_weight,
                )
                runs.append(
                    {
                        "seed": seed,
                        "accuracy": metrics["accuracy"],
                        "metrics": metrics,
                    }
                )
            mean_metrics, std_metrics = aggregate_run_metrics(runs)
            result = {
                "real_per_class": real_per_class,
                "synthetic_per_real": synthetic_per_real,
                "synthetic_loss_weight": synthetic_weight,
                "tiers": sorted(tiers),
                "mean_accuracy": mean_metrics["accuracy"],
                "std_accuracy": std_metrics["accuracy"],
                "mean_metrics": mean_metrics,
                "std_metrics": std_metrics,
                "scores": [run["accuracy"] for run in runs],
                "runs": runs,
            }
            results.append(result)
            print(
                f"real/class={real_per_class:2d} "
                f"synthetic_weight={synthetic_weight:.2f} "
                f"accuracy={result['mean_accuracy']:.3f}±{result['std_accuracy']:.3f} "
                f"nll={mean_metrics['negative_log_likelihood']:.3f} "
                f"auc={mean_metrics['roc_auc_ovr_macro']:.3f}"
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    document = {"validation_examples": len(val_indices), "results": results}
    output.write_text(
        json.dumps(document, indent=2) + "\n"
    )
    print(f"wrote {output}")


def embedding_variants(
    real_x: np.ndarray,
    real_y: np.ndarray,
    per_real: int,
    noise_scale: float,
    seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Same-class interpolation with small feature-space noise."""
    rng = np.random.default_rng(seed)
    feature_std = np.maximum(real_x.std(axis=0), 1e-4)
    generated_x: list[np.ndarray] = []
    generated_y: list[int] = []
    for label in range(len(EMOTIONS)):
        class_x = real_x[real_y == label]
        if not len(class_x):
            continue
        count = len(class_x) * per_real
        for _ in range(count):
            first = class_x[int(rng.integers(0, len(class_x)))]
            if len(class_x) > 1:
                second = class_x[int(rng.integers(0, len(class_x)))]
                alpha = float(rng.beta(0.4, 0.4))
                point = alpha * first + (1.0 - alpha) * second
            else:
                point = first.copy()
            point = point + rng.normal(0, noise_scale, point.shape) * feature_std
            generated_x.append(point.astype(np.float32))
            generated_y.append(label)
    return np.asarray(generated_x), np.asarray(generated_y, dtype=np.int64)


def embedding_sweep(
    original_cache: Path,
    report_path: Path,
    output: Path,
    real_counts: list[int],
    synthetic_counts: list[int],
    noise_scales: list[float],
    seeds: list[int],
) -> None:
    real_x, real_y, real_rows = load_cache(original_cache)
    validation = set(json.loads(report_path.read_text())["validation_images"])
    val_indices = np.asarray(
        [index for index, row in enumerate(real_rows) if row["image"] in validation],
        dtype=np.int64,
    )
    val_x, val_y = real_x[val_indices], real_y[val_indices]
    base_weight, base_bias = original_head()
    results: list[dict] = []
    for real_per_class in real_counts:
        for synthetic_per_real in synthetic_counts:
            for noise_scale in noise_scales:
                runs: list[dict] = []
                for seed in seeds:
                    rx, ry, _ = select_real(
                        real_x,
                        real_y,
                        real_rows,
                        validation,
                        real_per_class,
                        seed,
                    )
                    if synthetic_per_real:
                        sx, sy = embedding_variants(
                            rx, ry, synthetic_per_real, noise_scale, seed
                        )
                        tx = np.concatenate((rx, sx))
                        ty = np.concatenate((ry, sy))
                    else:
                        tx, ty = rx, ry
                    metrics, best_epoch = fit_head(
                        tx,
                        ty,
                        val_x,
                        val_y,
                        base_weight,
                        base_bias,
                        seed,
                    )
                    runs.append(
                        {
                            "seed": seed,
                            "accuracy": metrics["accuracy"],
                            "best_epoch": best_epoch,
                            "metrics": metrics,
                        }
                    )
                mean_metrics, std_metrics = aggregate_run_metrics(runs)
                result = {
                    "real_per_class": real_per_class,
                    "synthetic_per_real": synthetic_per_real,
                    "noise_scale": noise_scale,
                    "mean_accuracy": mean_metrics["accuracy"],
                    "std_accuracy": std_metrics["accuracy"],
                    "mean_metrics": mean_metrics,
                    "std_metrics": std_metrics,
                    "scores": [run["accuracy"] for run in runs],
                    "runs": runs,
                }
                results.append(result)
                print(
                    f"real/class={real_per_class:2d} "
                    f"feature/real={synthetic_per_real:2d} "
                    f"noise={noise_scale:.3f} "
                    f"accuracy={result['mean_accuracy']:.3f}±"
                    f"{result['std_accuracy']:.3f} "
                    f"nll={mean_metrics['negative_log_likelihood']:.3f} "
                    f"auc={mean_metrics['roc_auc_ovr_macro']:.3f}"
                )
    output.parent.mkdir(parents=True, exist_ok=True)
    document = {"validation_examples": len(val_indices), "results": results}
    output.write_text(
        json.dumps(document, indent=2) + "\n"
    )
    print(f"wrote {output}")


def parse_ints(value: str) -> list[int]:
    return [int(item) for item in value.split(",") if item]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("generate", "extract", "sweep", "cadence", "weighted", "embedding"),
    )
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--original-cache", type=Path, default=DEFAULT_ORIGINAL_CACHE)
    parser.add_argument("--synthetic-dir", type=Path, default=DEFAULT_SYNTHETIC)
    parser.add_argument("--synthetic-cache", type=Path, default=DEFAULT_SYNTHETIC_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_RESULTS)
    parser.add_argument("--model", default="enet_b0_8_best_afew")
    parser.add_argument("--per-source", type=int, default=9)
    parser.add_argument("--max-sources-per-class", type=int, default=10)
    parser.add_argument(
        "--real-counts", type=parse_ints, default=parse_ints("1,2,4,6,8,10")
    )
    parser.add_argument(
        "--synthetic-counts", type=parse_ints, default=parse_ints("0,1,3,6,9")
    )
    parser.add_argument("--seeds", type=parse_ints, default=parse_ints("7,23,47"))
    parser.add_argument("--tiers", default="mild,medium,aggressive")
    parser.add_argument(
        "--real-periods", type=parse_ints, default=parse_ints("1,3,7,15,31")
    )
    parser.add_argument("--cadence-synthetic-per-real", type=int, default=9)
    parser.add_argument("--steps", type=int, default=400)
    parser.add_argument(
        "--synthetic-weights",
        type=lambda value: [float(item) for item in value.split(",") if item],
        default=[0.05, 0.1, 0.25, 0.5, 1.0],
    )
    parser.add_argument(
        "--noise-scales",
        type=lambda value: [float(item) for item in value.split(",") if item],
        default=[0.0, 0.01, 0.03, 0.1],
    )
    args = parser.parse_args()
    if args.command == "generate":
        generate(
            args.data,
            args.report,
            args.synthetic_dir,
            args.per_source,
            args.max_sources_per_class,
        )
    elif args.command == "extract":
        extract(args.synthetic_dir, args.synthetic_cache, args.model)
    elif args.command == "sweep":
        sweep(
            args.original_cache,
            args.synthetic_cache,
            args.report,
            args.output,
            args.real_counts,
            args.synthetic_counts,
            args.seeds,
            set(args.tiers.split(",")),
        )
    elif args.command == "cadence":
        output = (
            args.output
            if args.output != DEFAULT_RESULTS
            else DEFAULT_CADENCE_RESULTS
        )
        cadence(
            args.original_cache,
            args.synthetic_cache,
            args.report,
            output,
            args.real_counts,
            args.real_periods,
            args.seeds,
            set(args.tiers.split(",")),
            args.cadence_synthetic_per_real,
            args.steps,
        )
    elif args.command == "weighted":
        output = (
            args.output
            if args.output != DEFAULT_RESULTS
            else DEFAULT_WEIGHTED_RESULTS
        )
        weighted(
            args.original_cache,
            args.synthetic_cache,
            args.report,
            output,
            args.real_counts,
            args.synthetic_weights,
            args.seeds,
            set(args.tiers.split(",")),
            args.cadence_synthetic_per_real,
        )
    else:
        output = (
            args.output
            if args.output != DEFAULT_RESULTS
            else DEFAULT_EMBEDDING_RESULTS
        )
        embedding_sweep(
            args.original_cache,
            args.report,
            output,
            args.real_counts,
            args.synthetic_counts,
            args.noise_scales,
            args.seeds,
        )


if __name__ == "__main__":
    main()
