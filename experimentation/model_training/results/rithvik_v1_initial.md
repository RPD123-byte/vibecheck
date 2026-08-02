# Rithvik expressions v1: initial head-only result

## Dataset

- 167 labeled captures total.
- 162 captures from the primary collection session and 5 setup captures.
- All 167 images produced a face detection and a 1,280-dimensional embedding.
- Class counts: anger 23, contempt 20, disgust 40, fear 12, happiness 15,
  neutral 15, sadness 19, surprise 23.

Because the five-image setup session does not cover all classes, the current
result uses a deterministic stratified image split: 133 training images and 34
validation images. This is not an independent-session test.

## Result

| Head | Validation accuracy |
|---|---:|
| Original EmotiEffLib head | 52.9% |
| Personalized anchored linear head | 88.2% |

The best personalized checkpoint occurred at epoch 77.

The confidence-aware rerun exposed a behavior that accuracy alone hid:

| Head | Macro OVR AUC | Brier ↓ | NLL ↓ | Correct confidence | Incorrect confidence |
|---|---:|---:|---:|---:|---:|
| Original | 0.879 | 0.636 | 1.613 | 0.733 | 0.619 |
| Personalized | 0.965 | 0.221 | 1.912 | 0.871 | 0.704 |

Personalization improved accuracy, class ranking, Brier score, and calibration,
but mean NLL became worse. One held-out image labeled as intended contempt was
classified as happiness with effectively 100% confidence and only
`5.7e-24` probability on contempt. That single example contributed 53.5 units
of log loss; personalized validation NLL excluding it was 0.348. The image
contains a broad visible smile, so this is a concrete intended-expression versus
observer-visible-expression conflict rather than an arbitrary category swap.

The other high-confidence error was anger classified as sadness at 92.4%
confidence. Its downcast pose and closed eyes provide a plausible sadness cue.
The remaining two errors were disgust to contempt at 56.6% and anger to
contempt at 32.7%.

Per-class OVR AUC was at least 0.979 for every class except contempt, which was
0.758 because of the extreme happiness-looking contempt example. Surprise and
fear both reached 1.0 OVR AUC on this split; their confusion appears mainly in
the lower-real-data synthetic sweeps rather than in the full personalized head.

Validation counts for the personalized head:

| Expected class | Correct | Total |
|---|---:|---:|
| anger | 3 | 5 |
| contempt | 3 | 4 |
| disgust | 7 | 8 |
| fear | 2 | 2 |
| happiness | 3 | 3 |
| neutral | 3 | 3 |
| sadness | 4 | 4 |
| surprise | 5 | 5 |

## Preliminary learning curve

| Maximum training examples per class | Total training examples | Validation accuracy |
|---:|---:|---:|
| 2 | 16 | 79.4% |
| 4 | 32 | 85.3% |
| 6 | 48 | 79.4% |
| 8 | 64 | 82.4% |
| 10 | 80 | 82.4% |
| all available | 133 | 88.2% |

The non-monotonic intermediate results and small validation set mean these
numbers should be treated as a pilot, not a sample-complexity conclusion.

## Required next test

Collect a new session with at least five independent attempts for every class.
The training script will then hold out that complete session. This will test
whether personalization survives a change in time, pose, and capture conditions
instead of recognizing near-neighbor images from the original session.
