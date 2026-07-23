"""Start the live emotion daemon."""

import argparse
import cv2
from src.registry import ADAPTERS, create_adapter


def main() -> None:
    parser = argparse.ArgumentParser(description="Live emotion analysis")
    parser.add_argument("--model", choices=sorted(ADAPTERS), default="emotiefflib")
    parser.add_argument(
        "--camera", type=int, default=0, help="MacBook camera is usually 0"
    )
    args = parser.parse_args()
    print(f"Loading emotion model: {args.model}", flush=True)
    adapter = create_adapter(args.model)
    print(f"Opening camera {args.camera}...", flush=True)
    camera = cv2.VideoCapture(args.camera, cv2.CAP_AVFOUNDATION)
    if not camera.isOpened():
        raise RuntimeError(f"Could not open camera {args.camera}")
    print("Live preview started. Press q or Esc to quit.", flush=True)
    try:
        while True:
            ok, frame = camera.read()
            if not ok:
                raise RuntimeError("Could not read a frame from the camera")
            for reading in adapter.analyze_frame(frame):
                x1, y1, x2, y2 = reading.face_box or (20, 40, 0, 0)
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                label = f"{reading.provider}: {reading.dominant_emotion} ({reading.dominant_score * 100:.1f}%)"
                cv2.putText(
                    frame,
                    label,
                    (x1, max(25, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (0, 255, 0),
                    2,
                )
                scores = " ".join(
                    f"{name[:3]}:{score * 100:.0f}"
                    for name, score in reading.provider_scores.items()
                )
                cv2.putText(
                    frame,
                    scores,
                    (x1, min(frame.shape[0] - 8, y2 + 20)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.42,
                    (255, 255, 255),
                    1,
                )
            cv2.imshow("Live Emotion Analysis", frame)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break
    finally:
        adapter.close()
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
