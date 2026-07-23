"""CLI entry point for the complete production expression runtime."""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from uncover.runtime.config import RuntimeConfig
from uncover.runtime.supervisor import RuntimeOwner


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
    parser.add_argument("--threshold", type=float, default=0.30)
    parser.add_argument("--hold-seconds", type=float, default=1.0)
    return parser


def _config_from_args(args: argparse.Namespace) -> RuntimeConfig:
    return RuntimeConfig(
        camera=args.camera,
        mode=args.mode,
        thread_id=args.thread_id,
        manage_codex_gui=not args.no_manage_codex_gui,
        display_entry_threshold=args.threshold,
        display_exit_threshold=max(0.0, args.threshold - 0.05),
        interruption_threshold=args.threshold,
        interruption_hold_seconds=args.hold_seconds,
    )


async def _run(args: argparse.Namespace) -> None:
    config = _config_from_args(args)
    root = Path(__file__).resolve().parents[3]
    owner = RuntimeOwner(
        config,
        python=sys.executable,
        project_root=root,
        headless_notch=args.headless_notch,
        image_paths=args.image,
        interruption_binary=args.interruption_binary,
    )
    await owner.run()


def main() -> None:
    raise SystemExit(asyncio.run(_run(_parser().parse_args())))


if __name__ == "__main__":
    main()
