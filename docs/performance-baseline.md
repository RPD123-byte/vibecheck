# Expression runtime performance baseline

Measured 2026-07-22 on an Apple M4 Max running macOS 26.5.2, using the production
EmotiEffLib adapter (`enet_b0_8_best_afew`, CPU MTCNN and ONNX) and the
checksum-pinned disgust fixture:

| Measurement | Baseline |
| --- | ---: |
| Cold model/face-detector construction | 6,288.7 ms |
| Five consecutive inference calls | 139.6, 307.8, 90.9, 90.6, 91.8 ms |
| Steady calls 2–5, mean | 145.3 ms |
| Local JSONL Unix-socket delivery | 0.231 ms |
| Configured inference interval | 160 ms |
| AppKit redraw interval | 100 ms |
| Display confirmation | 2 fresh readings (nominally 320 ms) |
| Negative interruption hold | 1,000 ms of capture time |

The inference loop has exactly one in-flight model call and does not queue stale
work; an occasional inference slower than 160 ms lengthens that cycle rather than
building a backlog. Each socket subscriber has a one-event queue, bounding
per-consumer pending memory to one protocol frame (64 KiB maximum). The process
integration suite separately verifies that the notch and Rust policy observe the
same live stream and that disconnected time cannot advance state.
