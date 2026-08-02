# Rithvik v1 synthetic-data pilot

## Scope and validity

This is a pipeline and hypothesis-screening experiment, not a reliable estimate
of live generalization. Of 167 real captures, 162 came from one short session
recorded in class-by-class bursts. The fallback validation split contains 34
frames randomly held out within classes, so neighboring frames from the same
expression enactment can occur on both sides. The validation set is also used
for epoch selection.

All synthetic descendants were generated only from the current training side,
and evaluation stayed on the same 34 real validation frames. That avoids direct
synthetic-image leakage, but it does not remove the parent dataset's
near-neighbor leakage.

## Original head training

1. MTCNN detected the largest face at confidence at least 0.90.
2. The face crop passed through frozen `enet_b0_8_best_afew` ONNX inference to
   produce a 1,280-dimensional embedding.
3. The 8-way linear head was initialized from EmotiEffLib's shipped weight and
   bias.
4. The head trained for 100 full-batch epochs using AdamW, learning rate
   `2e-3`, weight decay `1e-4`, hard-label cross-entropy, and a `1e-3`
   mean-squared parameter-distance anchor to the original head.
5. The epoch with the highest validation accuracy was saved.

The shipped head scored 52.9% and the personalized head scored 88.2% on this
leaky pilot split. The best checkpoint was epoch 77. The `_all` checkpoint used
all 133 training-fold frames, not all 167 captures.

## Cheap image-space augmentation

The experiment generated 720 local variants from 80 real training sources:

- mild, medium, and aggressive lighting/contrast/white-balance changes;
- small rotation, translation, and scale changes;
- Gaussian noise, blur, JPEG loss, and reduced image quality;
- peripheral/background blur, recoloring, or replacement while retaining the
  central face region.

Face detection and embedding extraction succeeded for 719/720 variants.

The fixed sweep used three parent-selection seeds. Accuracy is mean accuracy on
the same 34 real validation frames.

| Real examples/class | Real-only | +1 synthetic/real | +3 | +6 | +9 |
|---:|---:|---:|---:|---:|---:|
| 1 | 69.6% | 68.6% | 66.7% | 66.7% | 65.7% |
| 2 | 71.6% | 68.6% | 68.6% | 69.6% | 67.6% |
| 4 | 74.5% | 73.5% | 71.6% | 70.6% | 69.6% |
| 6 | 79.4% | 75.5% | 73.5% | 73.5% | 73.5% |
| 8 | 84.3% | 81.4% | 79.4% | 78.4% | 75.5% |
| 10 | 83.3% | 82.4% | 80.4% | 77.5% | 77.5% |

Separate mild, medium, and aggressive sweeps did not identify a tier that beat
real-only training. Lowering synthetic loss weight to 0.05–0.25 usually made
the result equal to real-only within this coarse validation resolution, but did
not improve it. Larger synthetic weight caused more damage.

### Confidence-aware rerun

The sweep now also records NLL, Brier score, calibration, per-class OVR AUC,
confidence-threshold accuracy, and confidently wrong confusion pairs. These
metrics revealed that synthetic augmentation can preserve ranking while making
the final probability distribution and winning class worse:

| Real/class | Synthetic/real | Accuracy | Macro AUC | Brier ↓ | NLL ↓ |
|---:|---:|---:|---:|---:|---:|
| 8 | 0 | 84.3% | 0.961 | 0.308 | 1.979 |
| 8 | 9 | 75.5% | 0.942 | 0.431 | 2.077 |
| 10 | 0 | 83.3% | 0.960 | 0.303 | 1.629 |
| 10 | 9 | 77.5% | 0.963 | 0.357 | 2.122 |

At ten real examples per class, nine synthetic variants slightly increased
macro AUC while decreasing accuracy and worsening both Brier score and NLL.
The model still ranked the correct classes reasonably well, but its probability
mass and argmax decisions became less reliable. Correct and incorrect
predictions also both became more confident.

The same two confident failures persisted across almost every real budget and
parent-selection seed: intended contempt to happiness and anger to sadness.
Surprise to fear appeared repeatedly at lower real budgets, sometimes above
80% confidence, but disappeared in the full 133-image personalized head.

Giving synthetic loss only 5–10% weight usually preserved the real-only
accuracy. At six real examples per class, 5% synthetic weight moved mean
accuracy from 79.4% to 80.4%, which is below the resolution needed to claim a
real improvement on this 34-image same-session validation set.

## Embedding-space variants

Same-class interpolation and Gaussian feature noise were tested at 1, 4, and 9
synthetic embeddings per real embedding. They were neutral at best and
occasionally reduced accuracy. They did not reduce the observed real-data
requirement.

## Periodic real replay

The mini-batch experiment inserted one real batch after `N` synthetic batches
for `N = 1, 3, 7, 15, 31`, with 400 total optimizer steps. Accuracy fell as real
batches became rarer.

| Real examples/class | 1 real after 1 synthetic | after 3 | after 7 | after 15 | after 31 |
|---:|---:|---:|---:|---:|---:|
| 1 | 64.7% | 63.7% | 61.8% | 59.8% | 54.9% |
| 2 | 68.6% | 65.7% | 64.7% | 63.7% | 61.8% |
| 4 | 70.6% | 67.6% | 64.7% | 62.7% | 60.8% |
| 8 | 79.4% | 76.5% | 72.5% | 72.5% | 71.6% |

For this frozen offline classifier, cadence is mostly a complicated way of
controlling real-versus-synthetic gradient weight. It is not equivalent to
robotics co-training or DAgger, where the learned policy visits new states and
an expert supplies new real labels.

## Image-model edits

The built-in image-generation edit model produced one identity-preserving
variant per class. Each prompt required the exact personally labeled facial
configuration to remain fixed while changing camera angle, lighting, room
background, distance, or webcam quality.

On the eight generated images:

- the personalized head matched all 8 inherited labels;
- the original EmotiEffLib head matched 5/8;
- MiniCPM-V matched 2/8, calling most of the subtle/idiosyncratic expressions
  neutral.

Using the eight real parents alone scored 64.7% on the pilot validation set.
Adding the eight generated variants also scored 64.7%; generated-only training
also scored 64.7%. This tiny image-generation set therefore demonstrates
pipeline viability but no performance gain.

The generated files are local under
`synthetic_data/imagegen_v1/` and intentionally ignored by Git.

The built-in edit prompt set used this invariant:

> Preserve the exact same person, identity, personally labeled facial
> expression and muscle configuration, gaze, hair, facial hair, age, and
> clothing. Do not reinterpret or exaggerate the expression. Change only
> nuisance conditions; keep the full face unobstructed in a realistic 16:9
> webcam photograph. No beautification, extra people, text, or watermark.

The class-balanced nuisance edits were:

| Label | Changed conditions |
|---|---|
| anger | cool diffuse window light, higher/side camera, neutral office |
| contempt | lower exposure, opposite-side camera, blurred office |
| disgust | warm evening and monitor light, closer camera, apartment |
| fear | cool right-side daylight, lower/farther camera, office |
| happiness | overcast light, higher low-quality webcam, plain room |
| neutral | warm side light, closer left camera, blurred room |
| sadness | cool morning light, lower compressed webcam, different room |
| surprise | mixed monitor/room light, closer right camera, office |

## Current conclusion

Within this pilot, none of the synthetic methods beat real-only head training.
More synthetic data amplified a narrow parent example instead of providing a
new independent facial enactment. The current best evidence still favors real
expression diversity.

The next valid experiment requires event- and session-level real splits:

1. Collect a later session with independent enactments for every class.
2. Lock that session as real-only test data.
3. Assign real parent events to folds before generating any descendants.
4. Compare nested real budgets such as 1, 2, 4, 8, and 12 events per class.
5. Re-run cheap, image-model, and cadence methods without using the locked test
   for epoch or hyperparameter selection.
