from __future__ import annotations

from pathlib import Path


def test_production_source_has_no_experiment_or_vendored_dependencies() -> None:
    root = Path(__file__).resolve().parents[2]
    forbidden = ("experimentation/", "emotiefflib_repo/", "../../codex-app-control")
    for path in [root / "pyproject.toml", *(root / "src").rglob("*")]:
        if not path.is_file() or path.suffix == ".pyc":
            continue
        text = path.read_text(errors="ignore")
        assert not any(value in text for value in forbidden), path
