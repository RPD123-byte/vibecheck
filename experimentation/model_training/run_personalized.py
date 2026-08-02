"""Run the production inference stream with a locally personalized linear head."""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from vibecheck.emotion.schema import EmotionReading
from vibecheck.inference.adapters.base import EmotionAdapter
from vibecheck.inference.permission import CameraPermission, request_camera_permission
from vibecheck.inference.process import (
    CameraFrameSource,
    ImageSequenceFrameSource,
    InferenceEventStream,
    InferenceService,
)
from vibecheck.stream.protocol import DEFAULT_FRESHNESS_SECONDS
from vibecheck.stream.publisher import SnapshotPublisher

DEFAULT_HEAD = Path(__file__).parent / "artifacts" / "rithvik_v2_multitask_head.pt"


@dataclass(frozen=True)
class PersonalizedHeads:
    emotion_weight: np.ndarray
    emotion_bias: np.ndarray
    emotions: tuple[str, ...]
    affect_weight: np.ndarray | None
    affect_bias: np.ndarray | None


def load_head(path: Path) -> PersonalizedHeads:
    """Load and validate a head checkpoint without constructing the base model."""
    import torch

    if not path.is_file():
        raise FileNotFoundError(
            f"Personalized head not found: {path}. Run train_head.py train first."
        )
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    required = {"weight", "bias", "emotions"}
    missing = required - set(checkpoint)
    if missing:
        raise ValueError(f"Head checkpoint is missing fields: {sorted(missing)}")
    weight = np.asarray(checkpoint["weight"], dtype=np.float32)
    bias = np.asarray(checkpoint["bias"], dtype=np.float32)
    emotions = tuple(str(value) for value in checkpoint["emotions"])
    if weight.shape != (8, 1280):
        raise ValueError(f"Expected head weight shape (8, 1280), got {weight.shape}")
    if bias.shape != (8,):
        raise ValueError(f"Expected head bias shape (8,), got {bias.shape}")
    expected = (
        "anger",
        "contempt",
        "disgust",
        "fear",
        "happiness",
        "neutral",
        "sadness",
        "surprise",
    )
    if emotions != expected:
        raise ValueError(
            f"Checkpoint emotion order {emotions!r} does not match {expected!r}"
        )
    affect_weight = None
    affect_bias = None
    if "affect_weight" in checkpoint or "affect_bias" in checkpoint:
        if "affect_weight" not in checkpoint or "affect_bias" not in checkpoint:
            raise ValueError(
                "Checkpoint must contain both affect_weight and affect_bias"
            )
        affect_weight = np.asarray(checkpoint["affect_weight"], dtype=np.float32)
        affect_bias = np.asarray(checkpoint["affect_bias"], dtype=np.float32)
        if affect_weight.shape != (2, 1280):
            raise ValueError(
                f"Expected affect weight shape (2, 1280), got {affect_weight.shape}"
            )
        if affect_bias.shape != (2,):
            raise ValueError(
                f"Expected affect bias shape (2,), got {affect_bias.shape}"
            )
        dimensions = tuple(
            str(value)
            for value in checkpoint.get("affect_dimensions", ("valence", "arousal"))
        )
        if dimensions != ("valence", "arousal"):
            raise ValueError(
                "Checkpoint affect dimension order must be ('valence', 'arousal')"
            )
    return PersonalizedHeads(weight, bias, emotions, affect_weight, affect_bias)


class PersonalizedAdapter(EmotionAdapter):
    """EmotiEffLib's normal detector/backbone with a replaced linear head."""

    def __init__(
        self,
        *,
        head_path: Path,
        model_name: str,
        face_threshold: float,
        minimum_face_size: int,
        print_readings: bool,
    ) -> None:
        # Deliberately delayed until after the stream heartbeat has started.
        from vibecheck.inference.adapters.emotiefflib import EmotiEffLibAdapter

        heads = load_head(head_path)
        self.base = EmotiEffLibAdapter(
            model_name=model_name,
            face_threshold=face_threshold,
            minimum_face_size=minimum_face_size,
        )
        recognizer = self.base.recognizer
        expected_base_shape = (
            (10, 1280) if heads.affect_weight is not None else (8, 1280)
        )
        if recognizer.classifier_weights.shape != expected_base_shape:
            raise ValueError(
                "Personalized head is incompatible with the base model: "
                f"expected base classifier {expected_base_shape}, got "
                f"{recognizer.classifier_weights.shape}"
            )
        self.heads = heads
        self.name = f"personalized:{head_path.stem}"
        self.base.name = self.name
        self.print_readings = print_readings

    def analyze_frame(self, frame: Any) -> EmotionReading | None:
        import cv2

        from vibecheck.inference.adapters.emotiefflib import (
            normalize_low_light_frame,
            select_largest_face_box,
        )

        started = time.perf_counter()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        boxes, probabilities = self.base.detector.detect(rgb)
        height, width = rgb.shape[:2]
        face_box = select_largest_face_box(
            boxes,
            probabilities,
            width=width,
            height=height,
            confidence_threshold=self.base.face_threshold,
        )
        if face_box is None:
            normalized = normalize_low_light_frame(frame)
            if normalized is not None:
                normalized_rgb = cv2.cvtColor(normalized, cv2.COLOR_BGR2RGB)
                boxes, probabilities = self.base.detector.detect(normalized_rgb)
                normalized_height, normalized_width = normalized_rgb.shape[:2]
                face_box = select_largest_face_box(
                    boxes,
                    probabilities,
                    width=normalized_width,
                    height=normalized_height,
                    confidence_threshold=self.base.face_threshold,
                )
                if face_box is not None:
                    rgb = normalized_rgb
        if face_box is None:
            return None
        x1, y1, x2, y2 = face_box
        face = rgb[y1:y2, x1:x2]
        embedding = np.asarray(
            self.base.recognizer.extract_features(face)[0], dtype=np.float32
        )
        emotion_logits = self.heads.emotion_weight @ embedding + self.heads.emotion_bias
        shifted = emotion_logits - emotion_logits.max()
        emotion_probabilities = np.exp(shifted) / np.exp(shifted).sum()
        reading = EmotionReading.from_provider(
            provider=self.name,
            provider_scores=dict(
                zip(
                    self.heads.emotions,
                    emotion_probabilities.tolist(),
                    strict=True,
                )
            ),
            face_box=face_box,
            inference_ms=(time.perf_counter() - started) * 1000.0,
        )
        if self.print_readings:
            payload = reading.to_payload()
            if (
                self.heads.affect_weight is not None
                and self.heads.affect_bias is not None
            ):
                affect = np.clip(
                    self.heads.affect_weight @ embedding + self.heads.affect_bias,
                    -1.0,
                    1.0,
                )
                payload["valence"] = float(affect[0])
                payload["arousal"] = float(affect[1])
            print(json.dumps(payload), flush=True)
        return reading

    def close(self) -> None:
        self.base.close()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--socket", type=Path, required=True)
    result.add_argument("--head", type=Path, default=DEFAULT_HEAD)
    result.add_argument("--model", default="enet_b0_8_va_mtl")
    result.add_argument("--camera", type=int, default=0)
    result.add_argument("--interval", type=float, default=0.16)
    result.add_argument("--freshness", type=float, default=DEFAULT_FRESHNESS_SECONDS)
    result.add_argument("--face-threshold", type=float, default=0.90)
    result.add_argument("--minimum-face-size", type=int, default=40)
    result.add_argument("--no-face-timeout", type=float, default=0.8)
    result.add_argument("--image", type=Path, action="append", default=[])
    result.add_argument(
        "--print-readings",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="print each personalized probability distribution as JSON",
    )
    return result


async def run(args: argparse.Namespace) -> int:
    publisher = SnapshotPublisher(
        args.socket, current_ttl_ms=round(args.freshness * 1000)
    )
    event_stream = InferenceEventStream(publisher, freshness_seconds=args.freshness)
    # Preserve the startup invariant: bind the stream and publish loading before
    # camera permission, camera opening, provider imports, or model construction.
    await event_stream.start_loading()
    print(
        json.dumps(
            {
                "type": "worker_health",
                "role": "personalized-inference",
                "ready": False,
                "stream": "loading",
                "head": str(args.head),
            }
        ),
        flush=True,
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for name in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(name, stop.set)

    frames = None
    adapter = None
    try:
        if args.image:
            frames = await asyncio.to_thread(ImageSequenceFrameSource, args.image)
        else:
            permission = await asyncio.to_thread(request_camera_permission)
            if permission is not CameraPermission.GRANTED:
                await event_stream.publish_state(permission.value)
                return 2
            frames = await asyncio.to_thread(CameraFrameSource, args.camera)
            if not frames.opened:
                await event_stream.publish_state("camera-unavailable")
                return 2
        adapter = await asyncio.to_thread(
            PersonalizedAdapter,
            head_path=args.head,
            model_name=args.model,
            face_threshold=args.face_threshold,
            minimum_face_size=args.minimum_face_size,
            print_readings=args.print_readings,
        )
        service = InferenceService(
            publisher=publisher,
            adapter=adapter,
            frames=frames,
            interval_seconds=args.interval,
            no_face_timeout_seconds=args.no_face_timeout,
            freshness_seconds=args.freshness,
            event_stream=event_stream,
        )
        await service.run(stop)
        frames = None
        adapter = None
        return 0
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
        print(json.dumps({"type": "inference-error", "detail": detail}), flush=True)
        await event_stream.publish_state("inference-error", detail)
        return 2
    finally:
        if frames is not None:
            await asyncio.to_thread(frames.close)
        if adapter is not None:
            await asyncio.to_thread(adapter.close)
        await event_stream.close()


def main() -> None:
    raise SystemExit(asyncio.run(run(parser().parse_args())))


if __name__ == "__main__":
    main()
