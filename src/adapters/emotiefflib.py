"""EmotiEffLib adapter with its MTCNN face detector."""

import cv2
import numpy as np
from facenet_pytorch import MTCNN
from emotiefflib.facial_analysis import EmotiEffLibRecognizer
from src.adapters.base import EmotionAdapter
from src.schema import COMMON_EMOTIONS, EmotionReading


class EmotiEffLibAdapter(EmotionAdapter):
    name = "emotiefflib"

    def __init__(self, model_name: str = "enet_b0_8_best_afew") -> None:
        self.detector = MTCNN(
            keep_all=True, post_process=False, min_face_size=40, device="cpu"
        )
        self.recognizer = EmotiEffLibRecognizer(
            engine="onnx", model_name=model_name, device="cpu"
        )

    def analyze_frame(self, frame: np.ndarray) -> list[EmotionReading]:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        boxes, probabilities = self.detector.detect(rgb)
        if boxes is None or probabilities is None:
            return []
        faces, valid_boxes = [], []
        for box, probability in zip(boxes, probabilities):
            if probability is None or probability < 0.90:
                continue
            x1, y1, x2, y2 = np.maximum(box.astype(int), 0)
            face = rgb[y1:y2, x1:x2]
            if face.size:
                faces.append(face)
                valid_boxes.append((x1, y1, x2, y2))
        if not faces:
            return []
        labels, scores = self.recognizer.predict_emotions(faces, logits=False)
        readings = []
        for box, label, score in zip(valid_boxes, labels, scores):
            provider_scores = {
                name.lower(): float(score[idx])
                for idx, name in self.recognizer.idx_to_emotion_class.items()
            }
            common_scores = {
                name: provider_scores.get(name, 0.0) for name in COMMON_EMOTIONS
            }
            readings.append(
                EmotionReading(
                    self.name, label.lower(), common_scores, provider_scores, box
                )
            )
        return readings
