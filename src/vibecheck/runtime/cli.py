"""CLI entry point for the complete production expression runtime."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from vibecheck.runtime.config import RuntimeConfig
from vibecheck.runtime.feature_state import FeatureState
from vibecheck.runtime.supervisor import RuntimeOwner


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("normal", "demo", "dry-run", "display-only"),
        default="normal",
    )
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--image", type=Path, action="append", default=[])
    parser.add_argument("--headless-notch", action="store_true")
    parser.add_argument("--interruption-binary", type=Path)
    parser.add_argument("--thread-id")
    parser.add_argument("--no-manage-codex-gui", action="store_true")
    parser.add_argument("--threshold", type=float, default=0.50)
    parser.add_argument("--surprise-threshold", type=float, default=0.30)
    parser.add_argument("--interruption-threshold", type=float, default=0.30)
    parser.add_argument("--hold-seconds", type=float, default=1.0)
    parser.add_argument(
        "--controller",
        action="store_true",
        help="start disabled and accept feature state over the private control socket",
    )
    return parser


def _config_from_args(args: argparse.Namespace) -> RuntimeConfig:
    return RuntimeConfig(
        camera=args.camera,
        mode=args.mode,
        thread_id=args.thread_id,
        manage_codex_gui=not args.no_manage_codex_gui,
        display_entry_threshold=args.threshold,
        display_exit_threshold=max(0.0, args.threshold - 0.05),
        surprise_display_entry_threshold=args.surprise_threshold,
        surprise_display_exit_threshold=max(0.0, args.surprise_threshold - 0.05),
        interruption_threshold=args.interruption_threshold,
        interruption_hold_seconds=args.hold_seconds,
    )


async def _run(args: argparse.Namespace) -> None:
    config = _config_from_args(args)
    if getattr(sys, "frozen", False):
        root = Path(sys.executable).resolve().parent
        model = root / "models" / f"{config.model}.onnx"
        if not model.is_file():
            raise FileNotFoundError(f"bundled model is missing: {model}")
        os.environ.setdefault("VIBECHECK_MODEL_PATH", str(model))
        bundled_interruption = root / "vibecheck-expression-interruption"
        if args.interruption_binary is None:
            args.interruption_binary = bundled_interruption
    else:
        root = Path(__file__).resolve().parents[3]
    owner = RuntimeOwner(
        config,
        python=sys.executable,
        project_root=root,
        headless_notch=args.headless_notch,
        image_paths=args.image,
        interruption_binary=args.interruption_binary,
        controller_mode=args.controller,
        initial_features=None if not args.controller else FeatureState(),
    )
    await owner.run()


def main() -> None:
    raise SystemExit(asyncio.run(_run(_parser().parse_args())))


if __name__ == "__main__":
    main()
