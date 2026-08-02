#!/usr/bin/env python3
"""Collect the facial-expression research corpus described by source-catalog.tsv."""

from __future__ import annotations

import csv
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
CATALOG = ROOT / "source-catalog.tsv"
RAW = ROOT / "raw"
MANIFEST = ROOT / "manifest.json"
USER_AGENT = "Vibecheck research collector/1.0 (evidence archive)"


def source_dir(kind: str, slug: str) -> Path:
    folder = "hubs" if kind == "hubs" else kind
    return RAW / folder / slug


def extract_html(path: Path) -> str:
    lynx = shutil.which("lynx")
    if lynx is None:
        return re.sub(r"<[^>]+>", " ", path.read_text(errors="replace"))
    result = subprocess.run(
        [lynx, "-dump", "-nolist", "-width=120", str(path)],
        check=False,
        capture_output=True,
        text=True,
        errors="replace",
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "lynx extraction failed")
    return result.stdout


def extract_pdf(path: Path, output: Path) -> str:
    pdftotext = shutil.which("pdftotext")
    if pdftotext is None:
        raise RuntimeError("pdftotext is required to extract PDF evidence")
    result = subprocess.run(
        [pdftotext, "-layout", str(path), str(output)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "pdftotext extraction failed")
    return output.read_text(errors="replace")


def fetch(row: dict[str, str]) -> dict[str, object]:
    directory = source_dir(row["kind"], row["slug"])
    directory.mkdir(parents=True, exist_ok=True)
    images_path = directory / "images.json"
    images_path.write_text("[]\n")
    fmt = row["format"]
    extension = {"pdf": ".pdf", "html": ".html", "text": ".txt"}[fmt]
    source_path = directory / f"source{extension}"
    text_path = directory / "article.txt"
    markdown_path = directory / "article.md"

    entry: dict[str, object] = {
        "slug": row["slug"],
        "url": row["url"],
        "title": row["title"].strip(),
        "kind": row["kind"],
        "status": "error",
        "wordCount": 0,
        "sourceDir": str(directory.relative_to(ROOT)),
        "sourcePath": str(source_path.relative_to(ROOT)),
        "htmlPath": (
            str(source_path.relative_to(ROOT)) if fmt == "html" else None
        ),
        "pdfPath": str(source_path.relative_to(ROOT)) if fmt == "pdf" else None,
        "markdownPath": str(markdown_path.relative_to(ROOT)),
        "textPath": str(text_path.relative_to(ROOT)),
        "imageManifestPath": str(images_path.relative_to(ROOT)),
        "imageCount": 0,
        "discoveredFrom": row["discoveredFrom"],
        "notes": row["notes"],
        "error": None,
    }

    try:
        response = requests.get(
            row["url"],
            headers={"User-Agent": USER_AGENT},
            timeout=60,
            allow_redirects=True,
        )
        response.raise_for_status()
        source_path.write_bytes(response.content)

        if fmt == "pdf":
            if not response.content.startswith(b"%PDF"):
                raise RuntimeError(
                    f"expected PDF but received {response.headers.get('content-type')}"
                )
            text = extract_pdf(source_path, text_path)
        elif fmt == "html":
            text = extract_html(source_path)
            text_path.write_text(text)
        else:
            text = response.text
            text_path.write_text(text)

        words = re.findall(r"\b[\w'-]+\b", text)
        entry["wordCount"] = len(words)
        entry["status"] = "ok" if len(words) >= 350 else "thin"
        markdown_path.write_text(
            f"# {entry['title']}\n\n"
            f"- Source: {row['url']}\n"
            f"- Collected from: {response.url}\n"
            f"- Evidence status: {entry['status']}\n\n"
            f"{text}"
        )
    except Exception as exc:  # collection failures belong in the manifest
        entry["error"] = str(exc)
        if not text_path.exists():
            text_path.write_text("")
        if not markdown_path.exists():
            markdown_path.write_text(
                f"# {entry['title']}\n\n"
                f"- Source: {row['url']}\n"
                "- Evidence status: error\n\n"
                f"Collection failed: {exc}\n"
            )
    return entry


def main() -> int:
    if not CATALOG.exists():
        print(f"missing catalog: {CATALOG}", file=sys.stderr)
        return 2
    with CATALOG.open(newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter="\t"))
    requested = set(sys.argv[1:])
    previous: dict[str, dict[str, object]] = {}
    if requested and MANIFEST.exists():
        previous = {
            str(entry["slug"]): entry
            for entry in json.loads(MANIFEST.read_text())
        }
    manifest = [
        fetch(row)
        if not requested or row["slug"] in requested
        else previous[row["slug"]]
        for row in rows
    ]
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    counts: dict[str, int] = {}
    for entry in manifest:
        status = str(entry["status"])
        counts[status] = counts.get(status, 0) + 1
    print(json.dumps({"sources": len(manifest), "statuses": counts}, indent=2))
    return 1 if counts.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())
