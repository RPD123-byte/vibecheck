from __future__ import annotations

import sys
from pathlib import Path

import pytest

from vibecheck.inference.process import _parser as inference_parser
from vibecheck.notch.process import _display_policy_from_args, _parser
from vibecheck.runtime.config import RuntimeConfig
from vibecheck.runtime.supervisor import RuntimeOwner


def test_worker_arguments_build_the_real_display_policy() -> None:
    args = _parser().parse_args(
        [
            "--emotion-socket",
            "/tmp/emotion.sock",
            "--entry-threshold",
            "0.6",
            "--exit-threshold",
            "0.55",
            "--surprise-entry-threshold",
            "0.4",
            "--surprise-exit-threshold",
            "0.35",
            "--confirmations",
            "3",
        ]
    )

    policy = _display_policy_from_args(args)

    assert policy.entry_threshold == 0.6
    assert policy.exit_threshold == 0.55
    assert policy.surprise_entry_threshold == 0.4
    assert policy.surprise_exit_threshold == 0.35
    assert policy.confirmations == 3


def test_standalone_workers_share_the_1_5_second_freshness_default() -> None:
    notch_args = _parser().parse_args(["--emotion-socket", "/tmp/emotion.sock"])
    inference_args = inference_parser().parse_args(["--socket", "/tmp/emotion.sock"])

    assert notch_args.freshness == 1.5
    assert inference_args.freshness == 1.5


def test_runtime_owner_propagates_both_threshold_pairs(tmp_path: Path) -> None:
    config = RuntimeConfig(
        mode="display-only",
        display_entry_threshold=0.6,
        display_exit_threshold=0.55,
        surprise_display_entry_threshold=0.4,
        surprise_display_exit_threshold=0.35,
    )
    owner = RuntimeOwner(config, python=sys.executable, project_root=tmp_path)
    owner.runtime_dir = tmp_path

    command = owner.configure_workers()["notch"].command

    def value(flag: str) -> str:
        return command[command.index(flag) + 1]

    assert value("--entry-threshold") == "0.6"
    assert value("--exit-threshold") == "0.55"
    assert value("--surprise-entry-threshold") == "0.4"
    assert value("--surprise-exit-threshold") == "0.35"


def test_frozen_owner_dispatches_workers_without_interpreter_mode(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    owner = RuntimeOwner(
        RuntimeConfig(mode="display-only"),
        python="/Applications/Vibecheck.app/runtime/vibecheck-runtime",
        project_root=tmp_path,
    )
    owner.runtime_dir = tmp_path

    workers = owner.configure_workers()

    assert workers["inference"].command[:3] == [
        owner.python,
        "--frozen-worker",
        "inference",
    ]
    assert workers["notch"].command[:3] == [
        owner.python,
        "--frozen-worker",
        "notch",
    ]
    assert "-m" not in workers["inference"].command
    assert "-m" not in workers["notch"].command


def test_electron_controller_is_the_single_codex_gui_launch_owner(
    tmp_path: Path,
) -> None:
    interruption = tmp_path / "vibecheck-expression-interruption"
    interruption.write_bytes(b"fixture")
    interruption.chmod(0o755)
    owner = RuntimeOwner(
        RuntimeConfig(manage_codex_gui=True),
        python=sys.executable,
        project_root=tmp_path,
        interruption_binary=interruption,
        controller_mode=True,
    )
    owner.runtime_dir = tmp_path

    command = owner.configure_workers()["interruption"].command

    assert "--ensure-daemon" in command
    assert "--no-manage-gui" in command
    assert "--manage-gui" not in command
