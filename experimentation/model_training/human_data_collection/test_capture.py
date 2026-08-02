from __future__ import annotations

import json

import cv2
import numpy as np
from capture import (
    AROUSAL_SLIDER,
    DELETE_RECT,
    EMOTIONS,
    HEADER_HEIGHT,
    VALENCE_SLIDER,
    Collector,
    affect_from_x,
    anchor_is_available,
    anchors_for_emotion,
    read_manifest,
    snap_affect,
    snap_manifest_affect_values,
    write_manifest,
)


def test_affect_slider_maps_endpoints_and_midpoint() -> None:
    slider = (100, 10, 300, 10)
    assert affect_from_x(100, slider) == -1.0
    assert affect_from_x(200, slider) == 0.0
    assert affect_from_x(300, slider) == 1.0
    assert affect_from_x(0, slider) == -1.0
    assert affect_from_x(400, slider) == 1.0
    assert affect_from_x(255, slider) == 0.6


def test_categorical_valence_anchor_availability() -> None:
    negative_only = ("anger", "contempt", "disgust", "fear", "sadness")
    for emotion in negative_only:
        assert anchor_is_available(emotion, "valence_negative_high_arousal_high")
        assert anchor_is_available(emotion, "valence_negative_low_arousal_low")
        assert not anchor_is_available(emotion, "valence_positive_high_arousal_high")

    assert anchor_is_available("happiness", "valence_positive_high_arousal_low")
    assert not anchor_is_available("happiness", "valence_negative_low_arousal_high")
    assert anchor_is_available("surprise", "valence_negative_high_arousal_low")
    assert anchor_is_available("surprise", "valence_positive_low_arousal_high")
    assert anchor_is_available("neutral", "valence_neutral_arousal_high")
    assert anchor_is_available("neutral", "valence_neutral_arousal_low")
    assert not anchor_is_available("neutral", "valence_negative_high_arousal_high")


def test_joint_anchor_cartesian_products_are_complete() -> None:
    anger = {value for _label, value in anchors_for_emotion("anger")}
    assert anger == {
        "valence_negative_high_arousal_high",
        "valence_negative_low_arousal_high",
        "valence_negative_high_arousal_low",
        "valence_negative_low_arousal_low",
    }
    surprise = {value for _label, value in anchors_for_emotion("surprise")}
    assert len(surprise) == 8
    assert {anchor.split("_")[1] for anchor in surprise} == {"negative", "positive"}


def test_draw_only_exposes_compatible_anchor_buttons(tmp_path) -> None:
    collector = Collector(
        tmp_path / "human_data" / "rithvik_expressions_v2",
        0,
        open_camera=False,
    )

    expected_anchor_counts = {
        "anger": 4,
        "contempt": 4,
        "disgust": 4,
        "fear": 4,
        "happiness": 4,
        "neutral": 2,
        "sadness": 4,
        "surprise": 8,
    }
    for emotion, expected_count in expected_anchor_counts.items():
        collector.selected = emotion
        collector.draw()
        anchors = {anchor for anchor, _rect in collector.anchor_rects}
        assert len(anchors) == expected_count
    collector.close()


def test_affect_values_snap_to_nearest_tenth() -> None:
    assert snap_affect(0.496) == 0.5
    assert snap_affect(0.699) == 0.7
    assert snap_affect(-0.304) == -0.3
    assert snap_affect(-0.05) == -0.1
    assert snap_affect(0.04) == 0.0
    assert snap_affect(4.0) == 1.0


def test_manifest_snap_only_changes_existing_affect_values() -> None:
    records = [
        {"image": "one.jpg", "label": "surprise", "valence": -0.304, "arousal": 0.699},
        {"image": "two.jpg", "label": "neutral"},
    ]
    changed = snap_manifest_affect_values(records)
    assert changed == 2
    assert records == [
        {"image": "one.jpg", "label": "surprise", "valence": -0.3, "arousal": 0.7},
        {"image": "two.jpg", "label": "neutral"},
    ]
    assert snap_manifest_affect_values(records) == 0


def test_manifest_rewrite_preserves_records_and_adds_affect(tmp_path) -> None:
    path = tmp_path / "manifest.jsonl"
    original = [
        {"image": "one.jpg", "label": "neutral", "session": "s1"},
        {"image": "two.jpg", "label": "anger", "custom": {"keep": True}},
    ]
    write_manifest(path, original)
    records = read_manifest(path)
    records[0]["label"] = "sadness"
    records[0]["valence"] = -0.6
    records[0]["arousal"] = -0.2
    write_manifest(path, records)

    updated = read_manifest(path)
    assert updated[0] == {
        "image": "one.jpg",
        "label": "sadness",
        "session": "s1",
        "valence": -0.6,
        "arousal": -0.2,
    }
    assert updated[1]["custom"] == {"keep": True}
    assert not path.with_name("manifest.jsonl.tmp").exists()
    assert len([json.loads(line) for line in path.read_text().splitlines()]) == 2


def test_review_mouse_edits_persist_without_touching_other_fields(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v1"
    output.mkdir(parents=True)
    image = np.full((480, 640, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(output / "one.jpg"), image)
    assert cv2.imwrite(str(output / "two.jpg"), image)
    write_manifest(
        output / "manifest.jsonl",
        [
            {"image": "one.jpg", "label": "neutral", "session": "one"},
            {"image": "two.jpg", "label": "anger", "session": "two"},
        ],
    )
    collector = Collector(output, 0, open_camera=False)
    collector.draw()

    happiness_rect = dict(collector.label_rects)["happiness"]
    hx = (happiness_rect[0] + happiness_rect[2]) // 2
    hy = (happiness_rect[1] + happiness_rect[3]) // 2
    collector.mouse(cv2.EVENT_LBUTTONDOWN, hx, hy, 0, None)
    after_emotion = read_manifest(output / "manifest.jsonl")
    assert after_emotion[0]["label"] == "happiness"
    assert "valence" not in after_emotion[0]
    assert "arousal" not in after_emotion[0]

    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        VALENCE_SLIDER[2],
        VALENCE_SLIDER[1],
        cv2.EVENT_FLAG_LBUTTON,
        None,
    )
    collector.mouse(
        cv2.EVENT_LBUTTONUP,
        VALENCE_SLIDER[2],
        VALENCE_SLIDER[1],
        0,
        None,
    )
    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        AROUSAL_SLIDER[0],
        AROUSAL_SLIDER[1],
        cv2.EVENT_FLAG_LBUTTON,
        None,
    )
    collector.mouse(
        cv2.EVENT_LBUTTONUP,
        AROUSAL_SLIDER[0],
        AROUSAL_SLIDER[1],
        0,
        None,
    )
    collector._navigate(1)

    updated = read_manifest(output / "manifest.jsonl")
    assert updated[0]["valence"] == 1.0
    assert updated[0]["arousal"] == -1.0
    assert updated[0]["session"] == "one"
    assert collector.review_index == 1
    assert collector.selected == "anger"
    assert set(EMOTIONS) == {label for label, _rect in collector.label_rects}
    collector.close()


def test_v2_capture_allows_optional_anchor_metadata(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    collector = Collector(output, 0, open_camera=False)
    collector.live = True
    collector.frame = np.full((240, 320, 3), 120, dtype=np.uint8)

    collector.save_capture()
    records = read_manifest(output / "manifest.jsonl")
    assert len(records) == 1
    assert "anchor" not in records[0]

    collector.selected = "anger"
    collector.draw()
    anchor = "valence_negative_high_arousal_high"
    rect = dict(collector.anchor_rects)[anchor]
    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        (rect[0] + rect[2]) // 2,
        (rect[1] + rect[3]) // 2,
        0,
        None,
    )
    assert collector.selected_anchor == anchor
    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        (rect[0] + rect[2]) // 2,
        (rect[1] + rect[3]) // 2,
        0,
        None,
    )
    assert collector.selected_anchor is None
    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        (rect[0] + rect[2]) // 2,
        (rect[1] + rect[3]) // 2,
        0,
        None,
    )
    collector.valence = -0.3
    collector.arousal = 0.7
    collector.save_capture()

    records = read_manifest(output / "manifest.jsonl")
    assert len(records) == 2
    assert records[1]["anchor"] == anchor
    assert records[1]["valence"] == -0.3
    assert records[1]["arousal"] == 0.7
    assert (output / records[1]["image"]).is_file()
    collector.close()


def test_clicking_live_preview_captures_after_anchor_is_selected(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    collector = Collector(output, 0, open_camera=False)
    collector.live = True
    collector.frame = np.full((240, 320, 3), 120, dtype=np.uint8)
    collector.selected_anchor = "valence_neutral_arousal_low"

    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        500,
        HEADER_HEIGHT + 100,
        0,
        None,
    )

    assert len(read_manifest(output / "manifest.jsonl")) == 1
    collector.close()


def test_changing_emotion_removes_incompatible_historical_anchor(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    output.mkdir(parents=True)
    image = np.full((240, 320, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(output / "one.jpg"), image)
    write_manifest(
        output / "manifest.jsonl",
        [
            {
                "image": "one.jpg",
                "label": "surprise",
                "anchor": "valence_negative_high_arousal_high",
                "valence": -1.0,
                "arousal": 0.5,
            }
        ],
    )
    collector = Collector(output, 0, open_camera=False)
    collector.draw()

    happiness_rect = dict(collector.label_rects)["happiness"]
    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        (happiness_rect[0] + happiness_rect[2]) // 2,
        (happiness_rect[1] + happiness_rect[3]) // 2,
        0,
        None,
    )

    record = read_manifest(output / "manifest.jsonl")[0]
    assert record["label"] == "happiness"
    assert "anchor" not in record
    assert collector.selected_anchor is None
    collector.close()


def test_reclicking_historical_anchor_removes_it_from_manifest(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    output.mkdir(parents=True)
    image = np.full((240, 320, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(output / "one.jpg"), image)
    anchor = "valence_negative_high_arousal_high"
    write_manifest(
        output / "manifest.jsonl",
        [
            {
                "image": "one.jpg",
                "label": "anger",
                "anchor": anchor,
                "valence": -1.0,
                "arousal": 1.0,
            }
        ],
    )
    collector = Collector(output, 0, open_camera=False)
    collector.draw()
    rect = dict(collector.anchor_rects)[anchor]

    collector.mouse(
        cv2.EVENT_LBUTTONDOWN,
        (rect[0] + rect[2]) // 2,
        (rect[1] + rect[3]) // 2,
        0,
        None,
    )

    record = read_manifest(output / "manifest.jsonl")[0]
    assert "anchor" not in record
    assert collector.selected_anchor is None
    collector.close()


def test_delete_requires_confirmation_and_moves_record_to_trash(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    output.mkdir(parents=True)
    image = np.full((240, 320, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(output / "one.jpg"), image)
    assert cv2.imwrite(str(output / "two.jpg"), image)
    records = [
        {
            "image": "one.jpg",
            "label": "surprise",
            "anchor": "valence_negative_high_arousal_high",
            "valence": -1.0,
            "arousal": 0.5,
        },
        {
            "image": "two.jpg",
            "label": "happiness",
            "anchor": "valence_positive_high_arousal_high",
            "valence": 1.0,
            "arousal": 0.6,
        },
    ]
    write_manifest(output / "manifest.jsonl", records)
    collector = Collector(output, 0, open_camera=False)
    delete_x = (DELETE_RECT[0] + DELETE_RECT[2]) // 2
    delete_y = (DELETE_RECT[1] + DELETE_RECT[3]) // 2

    collector.mouse(cv2.EVENT_LBUTTONDOWN, delete_x, delete_y, 0, None)
    assert len(read_manifest(output / "manifest.jsonl")) == 2
    assert collector.delete_armed_image == "one.jpg"
    assert (output / "one.jpg").is_file()

    collector.mouse(cv2.EVENT_LBUTTONDOWN, delete_x, delete_y, 0, None)
    active = read_manifest(output / "manifest.jsonl")
    deleted = read_manifest(output / ".trash" / "deleted_manifest.jsonl")
    assert [record["image"] for record in active] == ["two.jpg"]
    assert deleted[0]["image"] == "one.jpg"
    assert deleted[0]["trashed_image"] == "one.jpg"
    assert (output / ".trash" / "one.jpg").is_file()
    assert not (output / "one.jpg").exists()
    assert collector.review_index == 0
    assert collector.records[0]["image"] == "two.jpg"
    collector.close()


def test_navigation_cancels_delete_confirmation(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    output.mkdir(parents=True)
    image = np.full((240, 320, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(output / "one.jpg"), image)
    assert cv2.imwrite(str(output / "two.jpg"), image)
    write_manifest(
        output / "manifest.jsonl",
        [
            {"image": "one.jpg", "label": "neutral"},
            {"image": "two.jpg", "label": "neutral"},
        ],
    )
    collector = Collector(output, 0, open_camera=False)

    collector.delete_current()
    assert collector.delete_armed_image == "one.jpg"
    collector._navigate(1)

    assert collector.delete_armed_image is None
    assert len(read_manifest(output / "manifest.jsonl")) == 2
    collector.close()


def test_deleting_final_record_leaves_empty_review_safely(tmp_path) -> None:
    output = tmp_path / "human_data" / "rithvik_expressions_v2"
    output.mkdir(parents=True)
    image = np.full((240, 320, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(output / "one.jpg"), image)
    write_manifest(
        output / "manifest.jsonl",
        [{"image": "one.jpg", "label": "neutral"}],
    )
    collector = Collector(output, 0, open_camera=False)

    collector.delete_current()
    collector.delete_current()

    assert read_manifest(output / "manifest.jsonl") == []
    assert collector.records == []
    assert collector.review_index is None
    assert collector.review_image is None
    collector.draw()
    collector.close()
