"""Local capture and historical-label editor for personalized expressions."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import cv2
import numpy as np

EMOTIONS = (
    "anger",
    "contempt",
    "disgust",
    "fear",
    "happiness",
    "neutral",
    "sadness",
    "surprise",
)
JOINT_ANCHORS_BY_VALENCE = {
    "negative": (
        ("A HI / V- HI", "valence_negative_high_arousal_high"),
        ("A HI / V- LO", "valence_negative_low_arousal_high"),
        ("A LO / V- HI", "valence_negative_high_arousal_low"),
        ("A LO / V- LO", "valence_negative_low_arousal_low"),
    ),
    "positive": (
        ("A HI / V+ HI", "valence_positive_high_arousal_high"),
        ("A HI / V+ LO", "valence_positive_low_arousal_high"),
        ("A LO / V+ HI", "valence_positive_high_arousal_low"),
        ("A LO / V+ LO", "valence_positive_low_arousal_low"),
    ),
    "neutral": (
        ("A HI / V 0", "valence_neutral_arousal_high"),
        ("A LO / V 0", "valence_neutral_arousal_low"),
    ),
}
ANCHOR_VALUES = {
    value for anchors in JOINT_ANCHORS_BY_VALENCE.values() for _label, value in anchors
}
EMOTION_VALENCE_DIRECTIONS = {
    "anger": ("negative",),
    "contempt": ("negative",),
    "disgust": ("negative",),
    "fear": ("negative",),
    "happiness": ("positive",),
    "neutral": ("neutral",),
    "sadness": ("negative",),
    "surprise": ("negative", "positive"),
}
WINDOW = "Vibecheck expression collector"

CANVAS_WIDTH = 1000
HEADER_HEIGHT = 342
PREVIEW_HEIGHT = 480
FOLDER_RECT = (8, 8, 320, 44)
PREVIOUS_RECT = (330, 8, 380, 44)
INDEX_RECT = (388, 8, 488, 44)
NEXT_RECT = (496, 8, 546, 44)
LIVE_RECT = (554, 8, 690, 44)
DELETE_RECT = (698, 8, 820, 44)
CAPTURE_RECT = (828, 8, 992, 44)
LABEL_TOP = 56
LABEL_WIDTH = 238
LABEL_HEIGHT = 38
LABEL_GAP = 8
ANCHOR_TOP = 151
ANCHOR_HEIGHT = 36
ANCHOR_ROW_GAP = 5
VALENCE_SLIDER = (300, 260, 970, 260)
AROUSAL_SLIDER = (300, 309, 970, 309)
SLIDER_HIT_RADIUS = 16
FOLDER_ROW_HEIGHT = 34
AFFECT_STEP = Decimal("0.1")


def read_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON at {path}:{line_number}") from exc
        if not isinstance(record, dict):
            raise ValueError(f"Expected an object at {path}:{line_number}")
        records.append(record)
    return records


def write_manifest(path: Path, records: list[dict[str, Any]]) -> None:
    """Atomically replace a manifest after a historical-label edit."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    payload = "".join(json.dumps(record) + "\n" for record in records)
    temporary.write_text(payload)
    temporary.replace(path)


def snap_affect(value: float) -> float:
    """Clamp an affect score and snap it to one of the 21 tenth-step values."""
    bounded = min(1.0, max(-1.0, float(value)))
    snapped = Decimal(str(bounded)).quantize(AFFECT_STEP, rounding=ROUND_HALF_UP)
    result = float(snapped)
    return 0.0 if result == 0.0 else result


def snap_manifest_affect_values(records: list[dict[str, Any]]) -> int:
    """Snap only existing V/A fields in-place; return the changed-field count."""
    changed = 0
    for record in records:
        for field in ("valence", "arousal"):
            if field not in record:
                continue
            snapped = snap_affect(record[field])
            if record[field] != snapped:
                record[field] = snapped
                changed += 1
    return changed


def affect_from_x(x: int, slider: tuple[int, int, int, int]) -> float:
    x1, _y1, x2, _y2 = slider
    proportion = (min(x2, max(x1, x)) - x1) / (x2 - x1)
    return snap_affect(proportion * 2.0 - 1.0)


def x_from_affect(value: float, slider: tuple[int, int, int, int]) -> int:
    x1, _y1, x2, _y2 = slider
    bounded = snap_affect(value)
    return round(x1 + ((bounded + 1.0) / 2.0) * (x2 - x1))


def inside(rect: tuple[int, int, int, int], x: int, y: int) -> bool:
    x1, y1, x2, y2 = rect
    return x1 <= x <= x2 and y1 <= y <= y2


def anchors_for_emotion(emotion: str) -> tuple[tuple[str, str], ...]:
    """Return the joint V/A calibration targets for one expression category."""
    return tuple(
        anchor
        for direction in EMOTION_VALENCE_DIRECTIONS[emotion]
        for anchor in JOINT_ANCHORS_BY_VALENCE[direction]
    )


def anchor_is_available(emotion: str, anchor: str) -> bool:
    return anchor in {value for _label, value in anchors_for_emotion(emotion)}


class Collector:
    def __init__(
        self,
        output: Path,
        camera: int,
        *,
        open_camera: bool = True,
        capture: Any | None = None,
    ) -> None:
        output.mkdir(parents=True, exist_ok=True)
        self.dataset_root = output.parent
        self.output = output
        self.manifest_path = output / "manifest.jsonl"
        self.records = read_manifest(self.manifest_path)
        self.datasets = self._discover_datasets(output)
        self.dataset_index = self.datasets.index(output)

        if capture is not None:
            self.cap = capture
        elif open_camera:
            candidate = cv2.VideoCapture(camera)
            self.cap = candidate if candidate.isOpened() else None
            if self.cap is None:
                candidate.release()
        else:
            self.cap = None

        self.frame: np.ndarray | None = None
        self.review_image: np.ndarray | None = None
        self.review_index: int | None = 0 if self.records else None
        self.live = not self.records
        self.selected = "neutral"
        self.selected_anchor: str | None = None
        self.valence = 0.0
        self.arousal = 0.0
        self.saved_count = 0
        self.session = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        self.status = (
            "Reviewing saved images" if self.records else "Select labels, then capture"
        )
        self.folder_menu_open = False
        self.delete_armed_image: str | None = None
        self.dragging: str | None = None
        self.label_rects: list[tuple[str, tuple[int, int, int, int]]] = []
        self.anchor_rects: list[tuple[str, tuple[int, int, int, int]]] = []
        if self.review_index is not None:
            self._load_review_record()

    def _discover_datasets(self, output: Path) -> list[Path]:
        datasets = [
            path
            for path in sorted(self.dataset_root.iterdir())
            if path.is_dir() and (path / "manifest.jsonl").exists()
        ]
        if output not in datasets:
            datasets.append(output)
            datasets.sort()
        return datasets

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()
        cv2.destroyAllWindows()

    def _load_review_record(self) -> None:
        if self.review_index is None or not self.records:
            return
        self.review_index = max(0, min(len(self.records) - 1, self.review_index))
        record = self.records[self.review_index]
        self.selected = str(record.get("label", "neutral"))
        anchor = record.get("anchor")
        self.selected_anchor = (
            str(anchor)
            if anchor in ANCHOR_VALUES
            and anchor_is_available(self.selected, str(anchor))
            else None
        )
        self.valence = float(record.get("valence", 0.0))
        self.arousal = float(record.get("arousal", 0.0))
        self.review_image = cv2.imread(str(self.output / str(record["image"])))
        if self.review_image is None:
            self.status = f"Could not load {record['image']}"
        elif "valence" not in record or "arousal" not in record:
            self.status = "Historical image: affect labels are not saved yet"
        else:
            self.status = "Historical labels loaded"

    def _switch_dataset(self, index: int) -> None:
        self.dataset_index = index % len(self.datasets)
        self.output = self.datasets[self.dataset_index]
        self.manifest_path = self.output / "manifest.jsonl"
        self.records = read_manifest(self.manifest_path)
        self.review_index = 0 if self.records else None
        self.live = not self.records
        self.selected_anchor = None
        self.delete_armed_image = None
        self.folder_menu_open = False
        if self.review_index is not None:
            self._load_review_record()
        else:
            self.review_image = None
            self.status = "Dataset is empty; switched to live capture"

    def _update_current_record(
        self, *, remove_fields: tuple[str, ...] = (), **fields: Any
    ) -> None:
        if self.live or self.review_index is None:
            return
        for affect_field in ("valence", "arousal"):
            if affect_field in fields:
                fields[affect_field] = snap_affect(fields[affect_field])
        record = self.records[self.review_index]
        for field in remove_fields:
            record.pop(field, None)
        record.update(fields)
        record["labels_updated_at"] = datetime.now(UTC).isoformat()
        write_manifest(self.manifest_path, self.records)
        changed = ", ".join((*fields, *remove_fields))
        self.status = f"Saved {changed} to manifest.jsonl"

    def _navigate(self, delta: int) -> None:
        if not self.records:
            return
        self.delete_armed_image = None
        self.live = False
        current = self.review_index if self.review_index is not None else 0
        self.review_index = max(0, min(len(self.records) - 1, current + delta))
        self._load_review_record()

    def _go_live(self) -> None:
        if self.cap is None:
            self.status = "Camera unavailable; historical review still works"
            return
        self.live = True
        self.delete_armed_image = None
        self.folder_menu_open = False
        self.status = "Live camera: choose labels and capture"

    def delete_current(self) -> None:
        """Require confirmation, then move one image and its metadata to .trash."""
        if self.live or self.review_index is None or not self.records:
            self.status = "Select a saved image before deleting"
            self.delete_armed_image = None
            return
        record = self.records[self.review_index]
        image_name = str(record["image"])
        if self.delete_armed_image != image_name:
            self.delete_armed_image = image_name
            self.status = f"Click DELETE again to move {image_name} to .trash"
            return

        deleted_at = datetime.now(UTC).isoformat()
        trash = self.output / ".trash"
        trash.mkdir(parents=True, exist_ok=True)
        source = self.output / image_name
        target = trash / Path(image_name).name
        if target.exists():
            stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S_%fZ")
            target = trash / f"{stamp}_{target.name}"

        moved = False
        if source.exists():
            source.replace(target)
            moved = True
        remaining = [
            item
            for index, item in enumerate(self.records)
            if index != self.review_index
        ]
        tombstone = {
            **record,
            "deleted_at": deleted_at,
            "source_dataset": self.output.name,
            "trashed_image": target.name if moved else None,
            "source_image_missing": not moved,
        }
        trash_manifest = trash / "deleted_manifest.jsonl"
        deleted_records = read_manifest(trash_manifest)
        deleted_records.append(tombstone)
        try:
            write_manifest(self.manifest_path, remaining)
            write_manifest(trash_manifest, deleted_records)
        except Exception:
            if moved and target.exists() and not source.exists():
                target.replace(source)
            write_manifest(self.manifest_path, self.records)
            write_manifest(trash_manifest, deleted_records[:-1])
            raise

        old_index = self.review_index
        self.records = remaining
        self.delete_armed_image = None
        if self.records:
            self.review_index = min(old_index, len(self.records) - 1)
            self._load_review_record()
            self.status = (
                f"Moved {image_name} to .trash; {len(self.records)} images remain"
            )
        else:
            self.review_index = None
            self.review_image = None
            self.live = self.cap is not None
            self.status = f"Moved {image_name} to .trash; dataset is empty"

    def save_capture(self) -> None:
        if not self.live:
            self.status = "Click LIVE CAMERA before capturing"
            return
        if self.frame is None:
            self.status = "No camera frame available"
            return
        if self.selected_anchor is not None and not anchor_is_available(
            self.selected, self.selected_anchor
        ):
            self.selected_anchor = None
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S_%fZ")
        filename = f"{stamp}_{self.selected}.jpg"
        path = self.output / filename
        if not cv2.imwrite(str(path), self.frame, [cv2.IMWRITE_JPEG_QUALITY, 95]):
            raise RuntimeError(f"Could not write {path}")
        record = {
            "image": filename,
            "label": self.selected,
            "valence": snap_affect(self.valence),
            "arousal": snap_affect(self.arousal),
            "session": self.session,
            "captured_at": datetime.now(UTC).isoformat(),
        }
        if self.selected_anchor is not None:
            record["anchor"] = self.selected_anchor
        self.records.append(record)
        write_manifest(self.manifest_path, self.records)
        self.saved_count += 1
        self.status = f"Captured {filename}"

    def _fit_preview(self, image: np.ndarray | None) -> np.ndarray:
        canvas = np.full(
            (PREVIEW_HEIGHT, CANVAS_WIDTH, 3), (18, 18, 18), dtype=np.uint8
        )
        if image is None:
            cv2.putText(
                canvas,
                "No image available",
                (350, PREVIEW_HEIGHT // 2),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (180, 180, 180),
                2,
                cv2.LINE_AA,
            )
            return canvas
        height, width = image.shape[:2]
        scale = min(CANVAS_WIDTH / width, PREVIEW_HEIGHT / height)
        resized = cv2.resize(
            image,
            (max(1, round(width * scale)), max(1, round(height * scale))),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR,
        )
        rh, rw = resized.shape[:2]
        top = (PREVIEW_HEIGHT - rh) // 2
        left = (CANVAS_WIDTH - rw) // 2
        canvas[top : top + rh, left : left + rw] = resized
        return canvas

    def _button(
        self,
        canvas: np.ndarray,
        rect: tuple[int, int, int, int],
        text: str,
        *,
        active: bool = False,
        enabled: bool = True,
        danger: bool = False,
        font_scale: float = 0.55,
    ) -> None:
        if not enabled:
            color = (45, 45, 45)
            text_color = (110, 110, 110)
        else:
            if danger:
                color = (45, 45, 185) if active else (55, 55, 120)
            else:
                color = (45, 145, 75) if active else (72, 72, 72)
            text_color = (255, 255, 255)
        x1, y1, x2, y2 = rect
        cv2.rectangle(canvas, (x1, y1), (x2, y2), color, -1)
        size, _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)
        tx = x1 + max(6, (x2 - x1 - size[0]) // 2)
        ty = y1 + (y2 - y1 + size[1]) // 2
        cv2.putText(
            canvas,
            text,
            (tx, ty),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            text_color,
            1,
            cv2.LINE_AA,
        )

    def _slider(
        self,
        canvas: np.ndarray,
        slider: tuple[int, int, int, int],
        value: float,
        title: str,
        left_label: str,
        right_label: str,
        color: tuple[int, int, int],
        saved: bool,
    ) -> None:
        x1, y, x2, _ = slider
        suffix = "" if saved or self.live else " (not labeled)"
        cv2.putText(
            canvas,
            f"{title}: {snap_affect(value):+.1f}{suffix}",
            (8, y + 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (235, 235, 235),
            1,
            cv2.LINE_AA,
        )
        cv2.line(canvas, (x1, y), (x2, y), (100, 100, 100), 5)
        for index in range(21):
            tick_x = round(x1 + index * (x2 - x1) / 20)
            tick_height = 7 if index % 5 == 0 else 3
            cv2.line(
                canvas,
                (tick_x, y - tick_height),
                (tick_x, y + tick_height),
                (180, 180, 180),
                1,
            )
        handle = x_from_affect(value, slider)
        cv2.circle(canvas, (handle, y), 10, color, -1)
        cv2.putText(
            canvas,
            left_label,
            (x1, y + 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.38,
            (165, 165, 165),
            1,
            cv2.LINE_AA,
        )
        right_size, _ = cv2.getTextSize(right_label, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)
        cv2.putText(
            canvas,
            right_label,
            (x2 - right_size[0], y + 22),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.38,
            (165, 165, 165),
            1,
            cv2.LINE_AA,
        )

    def draw(self) -> np.ndarray:
        header = np.full((HEADER_HEIGHT, CANVAS_WIDTH, 3), (28, 28, 28), dtype=np.uint8)
        self._button(
            header,
            FOLDER_RECT,
            f"Dataset: {self.output.name}  v",
            active=self.folder_menu_open,
            font_scale=0.5,
        )
        self._button(header, PREVIOUS_RECT, "<", enabled=bool(self.records))
        position = (
            "LIVE"
            if self.live
            else (
                f"{self.review_index + 1} / {len(self.records)}"
                if self.review_index is not None
                else "0 / 0"
            )
        )
        self._button(header, INDEX_RECT, position, active=not self.live)
        self._button(header, NEXT_RECT, ">", enabled=bool(self.records))
        self._button(
            header,
            LIVE_RECT,
            "LIVE CAMERA",
            active=self.live,
            enabled=self.cap is not None,
            font_scale=0.48,
        )
        current_image = (
            str(self.records[self.review_index]["image"])
            if not self.live and self.review_index is not None
            else None
        )
        delete_armed = (
            current_image is not None and self.delete_armed_image == current_image
        )
        self._button(
            header,
            DELETE_RECT,
            "CONFIRM" if delete_armed else "DELETE",
            active=delete_armed,
            enabled=current_image is not None,
            danger=True,
            font_scale=0.44,
        )
        self._button(
            header,
            CAPTURE_RECT,
            "CAPTURE  [C/Space]",
            active=False,
            enabled=self.live and self.cap is not None,
            font_scale=0.45,
        )

        self.label_rects.clear()
        for index, label in enumerate(EMOTIONS):
            row, column = divmod(index, 4)
            x1 = 8 + column * (LABEL_WIDTH + LABEL_GAP)
            y1 = LABEL_TOP + row * (LABEL_HEIGHT + 5)
            rect = (x1, y1, x1 + LABEL_WIDTH, y1 + LABEL_HEIGHT)
            self._button(header, rect, label, active=label == self.selected)
            self.label_rects.append((label, rect))

        anchor_counts: dict[str, int] = {}
        for record in self.records:
            if record.get("label") == self.selected and record.get("anchor"):
                key = str(record["anchor"])
                anchor_counts[key] = anchor_counts.get(key, 0) + 1
        self.anchor_rects.clear()
        for index, (short_label, anchor) in enumerate(
            anchors_for_emotion(self.selected)
        ):
            row, column = divmod(index, 4)
            x1 = 8 + column * (LABEL_WIDTH + LABEL_GAP)
            y1 = ANCHOR_TOP + row * (ANCHOR_HEIGHT + ANCHOR_ROW_GAP)
            rect = (x1, y1, x1 + LABEL_WIDTH, y1 + ANCHOR_HEIGHT)
            count = anchor_counts.get(anchor, 0)
            self._button(
                header,
                rect,
                f"{short_label}  [{count}]",
                active=anchor == self.selected_anchor,
                font_scale=0.45,
            )
            self.anchor_rects.append((anchor, rect))

        current_record = (
            self.records[self.review_index]
            if not self.live and self.review_index is not None
            else {}
        )
        self._slider(
            header,
            VALENCE_SLIDER,
            self.valence,
            "Valence",
            "-1 unpleasant",
            "+1 pleasant",
            (70, 190, 90),
            "valence" in current_record,
        )
        self._slider(
            header,
            AROUSAL_SLIDER,
            self.arousal,
            "Arousal",
            "-1 calm/low energy",
            "+1 activated/high energy",
            (40, 150, 230),
            "arousal" in current_record,
        )

        if self.live:
            preview_source = cv2.flip(self.frame, 1) if self.frame is not None else None
        else:
            preview_source = self.review_image
        preview = self._fit_preview(preview_source)
        cv2.rectangle(
            preview,
            (0, PREVIEW_HEIGHT - 34),
            (CANVAS_WIDTH, PREVIEW_HEIGHT),
            (20, 20, 20),
            -1,
        )
        filename = ""
        if not self.live and self.review_index is not None:
            filename = f" | {self.records[self.review_index].get('image', '')}"
        cv2.putText(
            preview,
            f"{self.status}{filename}",
            (10, PREVIEW_HEIGHT - 11),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (230, 230, 230),
            1,
            cv2.LINE_AA,
        )
        canvas = np.vstack((header, preview))
        if self.folder_menu_open:
            for index, dataset in enumerate(self.datasets):
                y1 = FOLDER_RECT[3] + index * FOLDER_ROW_HEIGHT
                rect = (
                    FOLDER_RECT[0],
                    y1,
                    FOLDER_RECT[2],
                    y1 + FOLDER_ROW_HEIGHT,
                )
                self._button(
                    canvas,
                    rect,
                    dataset.name,
                    active=index == self.dataset_index,
                    font_scale=0.48,
                )
        return canvas

    def _slider_hit(self, y: int) -> str | None:
        if abs(y - VALENCE_SLIDER[1]) <= SLIDER_HIT_RADIUS:
            return "valence"
        if abs(y - AROUSAL_SLIDER[1]) <= SLIDER_HIT_RADIUS:
            return "arousal"
        return None

    def _set_slider(self, name: str, x: int, *, persist: bool) -> None:
        slider = VALENCE_SLIDER if name == "valence" else AROUSAL_SLIDER
        value = affect_from_x(x, slider)
        setattr(self, name, value)
        self.status = f"{name.title()} {value:+.1f}"
        if persist and not self.live:
            self._update_current_record(**{name: value})

    def mouse(self, event: int, x: int, y: int, flags: int, _param: Any) -> None:
        if self.folder_menu_open:
            if event == cv2.EVENT_LBUTTONDOWN:
                for index in range(len(self.datasets)):
                    y1 = FOLDER_RECT[3] + index * FOLDER_ROW_HEIGHT
                    rect = (
                        FOLDER_RECT[0],
                        y1,
                        FOLDER_RECT[2],
                        y1 + FOLDER_ROW_HEIGHT,
                    )
                    if inside(rect, x, y):
                        self._switch_dataset(index)
                        return
                self.folder_menu_open = False
            return

        if event == cv2.EVENT_LBUTTONDOWN:
            if inside(FOLDER_RECT, x, y):
                self.folder_menu_open = True
                return
            if inside(PREVIOUS_RECT, x, y):
                self._navigate(-1)
                return
            if inside(NEXT_RECT, x, y):
                self._navigate(1)
                return
            if inside(LIVE_RECT, x, y):
                self._go_live()
                return
            if inside(DELETE_RECT, x, y):
                self.delete_current()
                return
            if inside(CAPTURE_RECT, x, y):
                self.save_capture()
                return
            if y >= HEADER_HEIGHT:
                self.save_capture()
                return
            for label, rect in self.label_rects:
                if inside(rect, x, y):
                    self.selected = label
                    anchor_was_removed = (
                        self.selected_anchor is not None
                        and not anchor_is_available(label, self.selected_anchor)
                    )
                    if anchor_was_removed:
                        self.selected_anchor = None
                    if not self.live:
                        self._update_current_record(
                            remove_fields=("anchor",) if anchor_was_removed else (),
                            label=label,
                        )
                    else:
                        suffix = "; select a compatible anchor"
                        self.status = (
                            f"Selected {label}{suffix if anchor_was_removed else ''}"
                        )
                    return
            for anchor, rect in self.anchor_rects:
                if inside(rect, x, y):
                    if self.selected_anchor == anchor:
                        self.selected_anchor = None
                        if not self.live:
                            self._update_current_record(remove_fields=("anchor",))
                        else:
                            self.status = "Cleared calibration anchor"
                    else:
                        self.selected_anchor = anchor
                        if not self.live:
                            self._update_current_record(anchor=anchor)
                        else:
                            self.status = f"Selected {anchor.replace('_', ' ')}"
                    return
            slider_name = self._slider_hit(y)
            if slider_name is not None:
                self.dragging = slider_name
                self._set_slider(slider_name, x, persist=False)
                return

        if (
            event == cv2.EVENT_MOUSEMOVE
            and self.dragging
            and flags & cv2.EVENT_FLAG_LBUTTON
        ):
            self._set_slider(self.dragging, x, persist=False)
            return

        if event == cv2.EVENT_LBUTTONUP and self.dragging:
            name = self.dragging
            self.dragging = None
            self._set_slider(name, x, persist=True)

    def run(self) -> None:
        cv2.namedWindow(WINDOW, cv2.WINDOW_AUTOSIZE)
        cv2.setMouseCallback(WINDOW, self.mouse)
        while True:
            if self.cap is not None:
                ok, frame = self.cap.read()
                if ok:
                    self.frame = frame.copy()
                elif self.live:
                    self.status = "Camera stopped producing frames"
            cv2.imshow(WINDOW, self.draw())
            key = cv2.waitKey(20) & 0xFF
            if key in (ord("q"), 27):
                break
            if key in (32, ord("c"), ord("C")):
                self.save_capture()
            elif key in (ord("l"), ord("L")):
                self._go_live()
            elif key in (81, ord("a"), ord("A")):
                self._navigate(-1)
            elif key in (83, ord("d"), ord("D")):
                self._navigate(1)
        print(
            f"Captured {self.saved_count} new examples; "
            f"dataset has {len(self.records)} records at {self.output}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parents[1] / "human_data" / "rithvik_expressions_v2",
    )
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument(
        "--review-only",
        action="store_true",
        help="edit historical labels without opening the camera",
    )
    args = parser.parse_args()
    collector = Collector(args.output, args.camera, open_camera=not args.review_only)
    try:
        collector.run()
    finally:
        collector.close()


if __name__ == "__main__":
    main()
