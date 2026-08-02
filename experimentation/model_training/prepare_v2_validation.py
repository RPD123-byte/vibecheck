"""Copy complete V/A-labeled v1 records into v2 as an external holdout."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
V1 = ROOT / "human_data" / "rithvik_expressions_v1"
V2 = ROOT / "human_data" / "rithvik_expressions_v2"


def read_manifest(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_manifest(path: Path, rows: list[dict]) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text("".join(json.dumps(row) + "\n" for row in rows))
    temporary.replace(path)


def prepare(v1: Path = V1, v2: Path = V2) -> tuple[int, int]:
    """Create an idempotent explicit train/validation manifest in v2."""
    v2.mkdir(parents=True, exist_ok=True)
    training = [
        {**row, "split": "train"}
        for row in read_manifest(v2 / "manifest.jsonl")
        if row.get("split", "train") != "validation"
    ]
    validation = []
    for source_index, row in enumerate(read_manifest(v1 / "manifest.jsonl"), 1):
        if "valence" not in row or "arousal" not in row:
            continue
        source = v1 / str(row["image"])
        if not source.is_file():
            raise FileNotFoundError(source)
        destination_name = f"validation_v1_{source_index:03d}_{source.name}"
        destination = v2 / destination_name
        shutil.copy2(source, destination)
        validation.append(
            {
                **row,
                "image": destination_name,
                "split": "validation",
                "source_dataset": v1.name,
                "source_image": source.name,
                "source_manifest_index": source_index,
            }
        )
    write_manifest(v2 / "manifest.jsonl", [*training, *validation])
    return len(training), len(validation)


def main() -> None:
    training, validation = prepare()
    print(f"v2 training records: {training}")
    print(f"copied v1 validation records: {validation}")


if __name__ == "__main__":
    main()
