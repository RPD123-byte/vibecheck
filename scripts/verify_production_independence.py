#!/usr/bin/env python3
"""Reject prototype and local-development paths in production inputs/artifacts."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

FORBIDDEN = (
    b"experi" + b"mentation/",
    b"emotiefflib" + b"_repo/",
    b"/Users/" + b"computer/",
)
TEXT_SUFFIXES = {
    ".cjs",
    ".css",
    ".html",
    ".js",
    ".json",
    ".map",
    ".mjs",
    ".plist",
    ".py",
    ".rs",
    ".sh",
    ".swift",
    ".toml",
    ".ts",
    ".yaml",
    ".yml",
}


def tracked_production_files(root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    candidates = []
    for relative in result.stdout.splitlines():
        path = root / relative
        if not path.is_file():
            continue
        if relative.startswith(("experi" + "mentation/", "openspec/", ".codex/")):
            continue
        if relative in {"README.md", "tests/unit/test_source_guard.py"}:
            continue
        if relative.startswith(("src/", "scripts/", "tests/fixtures/")) or relative in {
            "package.json",
            "package-lock.json",
            "pyproject.toml",
            "Cargo.toml",
            "Cargo.lock",
        }:
            candidates.append(path)
    return candidates


def artifact_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return [candidate for candidate in path.rglob("*") if candidate.is_file()]


def violations(paths: list[Path]) -> list[tuple[Path, bytes]]:
    found = []
    for path in paths:
        if path.suffix and path.suffix not in TEXT_SUFFIXES:
            data = path.read_bytes()
        else:
            data = path.read_bytes()
        for forbidden in FORBIDDEN:
            if forbidden in data:
                found.append((path, forbidden))
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", nargs="*", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    paths = tracked_production_files(root)
    for artifact in args.artifact:
        paths.extend(artifact_files(artifact.resolve()))
    found = violations(paths)
    for path, value in found:
        print(f"forbidden production path {value!r}: {path}")
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())
