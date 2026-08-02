#!/usr/bin/env python3
"""Reject packaged copies of Tapback artwork rendered from the installed OS."""

from __future__ import annotations

import base64
import json
import mmap
from pathlib import Path
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_no_packaged_tapback_artwork.py APP_PATH")

    app_path = Path(sys.argv[1]).resolve()
    companion = (
        app_path
        / "Contents"
        / "Resources"
        / "component-reactions"
        / "vibecheck-component-companion"
    )
    if not companion.is_file():
        raise SystemExit(f"component companion is missing: {companion}")

    copied_names = [
        path
        for path in app_path.rglob("*")
        if path.is_file() and path.name.lower().startswith("ackfunction-")
    ]
    if copied_names:
        joined = "\n".join(str(path) for path in copied_names)
        raise SystemExit(f"packaged Tapback resource names found:\n{joined}")

    request = b'{"version":1,"id":"release-assets","type":"tapback_assets"}\n'
    response = subprocess.run(
        [str(companion)],
        input=request,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
        timeout=10,
    )
    frame = response.stdout.splitlines()[0]
    decoded = json.loads(frame)
    assets = decoded.get("result", {}).get("tapback_assets", {})
    rendered_pngs = [
        base64.b64decode(value.removeprefix("data:image/png;base64,"), validate=True)
        for value in assets.values()
        if isinstance(value, str) and value.startswith("data:image/png;base64,")
    ]
    if not rendered_pngs:
        return 0

    for path in app_path.rglob("*"):
        if not path.is_file() or path == companion:
            continue
        try:
            with path.open("rb") as handle:
                if path.stat().st_size == 0:
                    continue
                with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as contents:
                    if any(contents.find(png) >= 0 for png in rendered_pngs):
                        raise SystemExit(
                            f"packaged copy of installed Tapback artwork found: {path}"
                        )
        except (OSError, ValueError):
            continue
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
