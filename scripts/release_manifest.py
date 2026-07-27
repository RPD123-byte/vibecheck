#!/usr/bin/env python3
"""Write non-secret release provenance for the final Vibecheck artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("RELEASE_MANIFEST.json"))
    parser.add_argument("--notarization", type=Path)
    parser.add_argument("artifacts", nargs="*", type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    app_package = json.loads((root / "package.json").read_text())
    electron_package = json.loads((root / "src/electron/package.json").read_text())
    model = root / "dist/runtime/vibecheck-runtime/models/enet_b0_8_best_afew.onnx"
    notarization = None
    if args.notarization and args.notarization.is_file():
        notarization = json.loads(args.notarization.read_text()).get("id")
    rust_version = subprocess.run(
        ["rustc", "--version"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    payload = {
        "vibecheck_version": app_package["version"],
        "electron_version": electron_package["devDependencies"]["electron"],
        "python_version": platform.python_version(),
        "rust_version": rust_version,
        "model": {
            "name": "enet_b0_8_best_afew",
            "sha256": sha256(model),
        },
        "architecture": platform.machine(),
        "bundle_identifier": "com.rithvikprakki.vibecheck",
        "team_id": "YU57297F36",
        "notarization_submission_id": notarization,
        "artifacts": {
            str(path): sha256(path) for path in args.artifacts if path.is_file()
        },
    }
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
