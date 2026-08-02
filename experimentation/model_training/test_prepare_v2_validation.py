from __future__ import annotations

import json

from prepare_v2_validation import prepare, read_manifest


def write_rows(path, rows) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))


def test_prepare_copies_only_complete_va_labels_with_explicit_split(tmp_path) -> None:
    v1 = tmp_path / "rithvik_expressions_v1"
    v2 = tmp_path / "rithvik_expressions_v2"
    v1.mkdir()
    v2.mkdir()
    (v1 / "complete.jpg").write_bytes(b"complete")
    (v1 / "incomplete.jpg").write_bytes(b"incomplete")
    write_rows(
        v1 / "manifest.jsonl",
        [
            {
                "image": "complete.jpg",
                "label": "anger",
                "valence": -0.7,
                "arousal": 0.6,
            },
            {"image": "incomplete.jpg", "label": "neutral", "valence": 0.0},
        ],
    )
    write_rows(
        v2 / "manifest.jsonl",
        [{"image": "training.jpg", "label": "anger", "valence": -1.0, "arousal": 1.0}],
    )

    train_count, validation_count = prepare(v1, v2)

    rows = read_manifest(v2 / "manifest.jsonl")
    assert (train_count, validation_count) == (1, 1)
    assert rows[0]["split"] == "train"
    assert rows[1]["split"] == "validation"
    assert rows[1]["source_dataset"] == "rithvik_expressions_v1"
    assert rows[1]["source_image"] == "complete.jpg"
    assert (v2 / rows[1]["image"]).read_bytes() == b"complete"
