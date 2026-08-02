# Alternative trainable models

## Comparison rules

Published FER leaderboard numbers are unusually easy to miscompare. A candidate
must be re-evaluated when any of these differ:

- seven vs. eight classes;
- inclusion/exclusion of contempt or “other”;
- AffectNet validation vs. private test vs. cleaned subset;
- aligned dataset crop vs. detector crop;
- extra face-recognition or expression datasets;
- ensemble vs. single model;
- test-time augmentation;
- detector failures excluded vs. included;
- image vs. video aggregation;
- commercial vs. research-only weights/data.

The correct comparison for Vibecheck is a single pipeline: same camera frames,
subject split, detector/crop, calibration protocol, temporal policy, CPU, and
latency harness.

## Shortlist

| Family | Outputs | Trainability | Approximate scale | Deployment fit | License concern |
|---|---|---|---:|---|---|
| EmotiEffLib B0 current | 8 expressions | Excellent; upstream notebooks and PyTorch checkpoint | 4.0M params | Excellent CPU/ONNX baseline | Apache code; training-data lineage still needs review |
| EmotiEffLib B0 MTL | 8 expressions + VA | Excellent | 4.0M params | Excellent; protocol work needed for VA | Same lineage concerns |
| EmotiEffLib B2 | 7 or 8 expressions | Excellent | 7.7M params | Plausible, about 3× upstream mobile latency | Same lineage concerns |
| EmotiEffLib MobileFaceNet MTL | 8 + VA | Excellent | 2.05M params | Best size/latency candidate | Same lineage concerns |
| EmotiEffLib MobileViT MTL | 8 + VA | Excellent | 9.82M params | Needs local latency/export benchmark | Same lineage concerns |
| POSTER++ | 7 or 8 expressions | Full training scripts and checkpoints | 43.7M params, 8.4 GFLOPs reported | Likely too heavy for default CPU loop | MIT code; datasets/checkpoints separately |
| DDAMFN / DDAMFN++ | 7 or 8 expressions | Dataset-specific train scripts and checkpoints | Designed lightweight | Strong external CNN candidate | Repository has no explicit code license in inspected root |
| LibreFace | expressions, AU occurrence, AU intensity, gaze | Current training guide and task code | distilled ResNet-18/RepVGG family | Broadest observable-face toolkit | USC research/non-commercial license |
| EmoNet | 5/8 expressions + VA + landmarks | Source and checkpoints, less turnkey training | larger multi-head CNN | Valuable VA research baseline | CC BY-NC-ND code; poor fit for modification/commercial use |
| General ViT/ConvNeXt/DINO features | configurable | Fully fine-tunable with custom head | medium to very large | Usually poor CPU tradeoff without distillation | Per-model and pretraining-data license |

Parameter counts for EmotiEffLib come from local ONNX graph initializers. POSTER++
scale comes from its paper/repository. External-family deployment cost must be
measured locally rather than inferred from parameter count alone.

## EmotiEffLib variants

### `enet_b0_8_best_vgaf`

This is the nearest zero-engineering alternative to the current
`best_afew` checkpoint. Architecture, parameter count, preprocessing, class order,
and runtime path are the same. Only weights/model selection differ.

**Why test it:** a paired local evaluation can reveal how much current behavior is
specific to AFEW selection. It is effectively free to benchmark and should be in
every experiment matrix.

**Why it is not “fine-tuning”:** swapping sibling checkpoints changes the baseline
but learns nothing about Vibecheck's domain.

### `enet_b0_8_va_mtl`

Same B0-scale encoder with an eight-class expression head plus valence/arousal.

**Why test it:**

- multi-task pretraining may give a more transferable embedding;
- VA can support graded UI intensity;
- its 1,280-dimensional features can be linear-probed without adopting its full
  output semantics.

**Caution:** the checkpoint's final two values are regression outputs and must not
be fed into an eight/ten-way softmax or the existing score schema.

### `enet_b2_8`

EfficientNet-B2 increases input size to 260, embedding size to 1,408, and
parameters to about 7.68M.

The upstream README reports better AffectNet validation accuracy than B0 but about
191 ms rather than 59 ms on its Samsung Fold 3 benchmark. The hardware is not
Vibecheck's target Mac, yet the size/latency direction is clear.

**Use when:** local tests show B0 underfits visually and the camera/inference loop
can afford the latency.

**Do not assume:** a few points of AffectNet accuracy will improve calibrated anger
event precision.

### `mbf_va_mtl`

MobileFaceNet uses 112 × 112 input, a 512-dimensional embedding, and about 2.05M
parameters.

**Why test it:**

- smallest artifact and likely best CPU efficiency;
- face-specific architecture;
- multi-task representation;
- may enable higher frame rate or an ensemble under the same compute budget.

**Risks:**

- lower input resolution can erase subtle brow/eye/mouth cues;
- its normalization differs from B0/B2 (`mean=std=0.5`);
- crop and export parity need a separate implementation path.

### `mobilevit_va_mtl`

MobileViT combines local convolutions with transformer-style global processing,
uses a 768-dimensional embedding, and has about 9.82M parameters.

It is the most relevant “transformer-like” option already inside EmotiEffLib. Test
it before integrating a much larger external transformer, because it preserves
the library interface and MTL lineage.

## POSTER++

[POSTER++](https://arxiv.org/abs/2301.12149) combines image features and
multi-scale landmark features with window-based cross-attention. Its repository
provides:

- training scripts for RAF-DB, AffectNet-7, AffectNet-8, and CAER-S;
- dataset-specific checkpoints;
- a MobileFaceNet landmark branch pretraining dependency;
- 200-epoch example recipes;
- an MIT code license.

Reported performance is strong: 92.21% on RAF-DB, 67.49% on AffectNet-7, and
63.77% on AffectNet-8. Those figures do not include Vibecheck's detector and event
policy.

**Advantages:**

- explicit facial-landmark structure;
- current canonical FER benchmark baseline;
- complete training entry points;
- permissive code license.

**Disadvantages for Vibecheck:**

- roughly 43.7M parameters and 8.4 GFLOPs are an order of magnitude above current
  B0 parameters;
- landmark extraction/cross-fusion adds moving parts and latency;
- checkpoints are distributed through third-party drives;
- training examples use large batches and 200 epochs;
- ONNX export and CPU performance are not the repository's primary path;
- extra preprocessing can fail on pose/occlusion even when MTCNN finds a face.

**Recommendation:** use as an offline accuracy ceiling or teacher. Do not make it
the first production replacement.

## DDAMFN and DDAMFN++

[DDAMFN](https://doi.org/10.3390/electronics12173595) is explicitly designed as a
lightweight FER model:

- Mixed Feature Network backbone derived from MobileFaceNet;
- mixed depthwise kernel sizes for multi-scale features;
- coordinate attention;
- multiple dual-direction attention heads;
- attention diversity/loss terms.

The repository contains separate train/test scripts for AffectNet-7/8, RAF-DB, and
FER+, pretrained assets, and DDAMFN++ checkpoints. The paper reports strong
results while targeting lower complexity than heavy transformer models.

**Advantages:**

- face-specific lightweight backbone;
- fully trainable PyTorch source;
- current AffectNet/RAF/FER+ support;
- compelling architecture comparison to EfficientNet B0.

**Risks:**

- the inspected repository root lists no license file or license declaration;
  public source is not equivalent to permission to modify/distribute;
- dataset-specific scripts increase reproducibility burden;
- custom attention heads complicate clean ONNX export;
- published checkpoints/preprocessing must be audited for class order and face
  alignment;
- “attention” does not itself provide calibrated confidence or explanation.

**Recommendation:** strongest external architecture candidate after the current
EmotiEffLib ladder, contingent on explicit licensing and successful CPU/ONNX
parity.

## LibreFace

[LibreFace](https://openaccess.thecvf.com/content/WACV2024/html/Chang_LibreFace_An_Open-Source_Toolkit_for_Deep_Facial_Expression_Analysis_WACV_2024_paper.html)
is a facial-expression *analysis toolkit*, not only an eight-class model. The
current repository supports:

- facial-expression classification;
- action-unit occurrence;
- action-unit intensity;
- gaze estimation;
- per-task training instructions;
- CPU and GPU inference;
- distillation from larger encoders into ResNet-18/RepVGG models;
- recent synthetic-data and demographic evaluations.

**Advantages:**

- AU outputs are closer to observable facial movement;
- current training documentation;
- fairness and age-focused evaluations;
- useful as an interpretability/audit side model;
- potential to distill a larger teacher into a production-sized student.

**Risks:**

- the current repository says the code is under the USC research license and is
  free for non-commercial use, not a permissive commercial license;
- incorporating all tasks would expand runtime/protocol scope substantially;
- synthetic-data claims need domain validation;
- a ResNet-18-class student is still larger than current EfficientNet-B0.

**Recommendation:** use in research to audit AU/expression relationships and as a
teacher/alternative benchmark. Resolve licensing before product integration.

## EmoNet

[EmoNet](https://www.nature.com/articles/s42256-020-00280-0) predicts:

- five or eight categorical expressions;
- continuous valence;
- continuous arousal;
- facial landmarks.

The official repository provides checkpoints and reports strong results on a
cleaned AffectNet evaluation subset.

**Advantages:**

- mature joint categorical/dimensional task design;
- VA output is useful for comparing intensity representations;
- landmark supervision can regularize facial structure;
- good scientific baseline for naturalistic continuous affect.

**Risks:**

- repository code is CC BY-NC-ND 4.0;
- “NoDerivatives” conflicts with the goal of modifying/fine-tuning and
  distributing a derivative;
- non-commercial restriction conflicts with many product uses;
- older dependency versions;
- cleaned-test results are not directly comparable to full pipeline results.

**Recommendation:** research-only reference unless separate permission is
obtained. Do not base the primary fine-tuning path on a no-derivatives license.

## Action-unit systems instead of categorical emotion

OpenFace, LibreFace, and academic AU networks can predict observable muscle-action
codes. This changes the product question from:

> “What emotion does this person have?”

to:

> “Which facial movements are visible, and are they stable enough to alter the
> interface?”

That is scientifically more defensible and potentially more personalized, but it
requires a new policy mapping. An angry-looking face may combine brow lowering,
lid tightening, and lip pressing, yet those movements also occur during
concentration, glare, pain, or deliberate posing. AU evidence should support
explanation and abstention, not a deterministic internal-state claim.

## General vision encoders

ConvNeXt, ViT, DINOv2, CLIP, and masked-autoencoder face encoders can all be
linear-probed or fine-tuned for FER. They are attractive when:

- there is enough domain data;
- a strong teacher is needed;
- text/attribute supervision is valuable;
- distillation into a small student is planned.

They are poor first production candidates because:

- they are larger than the current four-million-parameter graph;
- generic pretraining may encode identity/background more strongly than
  expression;
- prompt-based zero-shot labels are not calibrated FER probabilities;
- facial-expression benchmark improvements often depend on fine-tuning and
  alignment;
- licenses and training-data provenance vary;
- on-device CPU latency can dominate the entire camera loop.

A useful research design is teacher-student:

1. fine-tune or probe a strong offline encoder;
2. use human labels as the primary target and teacher distributions as auxiliary
   soft targets;
3. distill into EmotiEffLib B0 or MobileFaceNet;
4. calibrate the student independently;
5. keep only the student on device.

## DeepFace and packaged APIs

DeepFace is useful as a quick integration baseline because it normalizes detector
and model invocation. It is not the preferred controlled fine-tuning foundation:

- the wrapper may hide crop, normalization, and label-order differences;
- its bundled emotion model lineage can be older;
- packaged “confidence” still needs calibration;
- model/data licenses must be traced through the wrapper;
- training and reproducible export are less direct than using the underlying
  PyTorch model.

Use wrappers for triangulation, not as ground truth.

## Recommended benchmark roster

Run candidates in this order:

1. current `enet_b0_8_best_afew`, unchanged;
2. current model plus scalar temperature;
3. `enet_b0_8_best_vgaf`, unchanged and calibrated;
4. current B0 embedding plus Vibecheck linear head and calibrator;
5. `enet_b0_8_va_mtl` embedding plus the same head protocol;
6. `mbf_va_mtl` embedding plus the same head protocol;
7. progressively fine-tuned B0;
8. B2 if local latency budget allows;
9. DDAMFN if licensing is resolved;
10. POSTER++ offline teacher/ceiling;
11. LibreFace AU/expression audit model under research terms;
12. EmoNet research-only dimensional comparison.

Every result table should show:

- data and split hash;
- face coverage;
- macro-F1 and balanced accuracy;
- anger event precision and false triggers/hour;
- NLL, Brier, classwise ACE;
- risk-coverage;
- worst demographic/camera slice;
- p50/p95 inference time;
- peak resident memory;
- artifact size;
- license disposition.

## Selection conclusion

EmotiEffLib remains the right first family because it is already deployed, compact,
fully trainable, ONNX-compatible, and exposes embeddings. DDAMFN is the best
architecture challenger on paper; POSTER++ is the best high-capacity benchmark;
LibreFace is the best AU-oriented audit toolkit; EmoNet is a useful VA reference
but an awkward licensing fit.

No alternative removes the need for domain data, calibration, abstention, and
event-level evaluation.
