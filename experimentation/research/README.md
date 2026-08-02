# Facial-expression model fine-tuning research

This folder is the research foundation for the `expression-model-finetuning`
branch. It answers four separate questions that should not be collapsed into one:

1. What exactly is the EmotiEffLib model Vibecheck runs?
2. What can be adapted safely, with how much data and compute?
3. Which alternative trainable models are credible deployment candidates?
4. How should scores be calibrated and validated before they drive a visible
   expression state or interrupt a task?

The decisive conclusion is that Vibecheck should **not begin with a model swap or
full fine-tune**. The highest-value first experiment is to preserve raw logits from
the current EfficientNet-B0 model, build a subject-disjoint, domain-matched
calibration/evaluation set, fit a post-hoc temperature baseline, and select
per-expression operational thresholds from false-positive costs. The next
experiment should be a linear head on the existing 1,280-dimensional embedding.
Only then is partial or full backbone fine-tuning justified.

The highlighted angry-expression frame is treated as a concrete decision endpoint,
not decoration. Research and experiments must distinguish:

- whether a face visually contains an anger-like expression;
- how confident the model should be in that expression label;
- whether the evidence is sufficiently reliable and sustained to show the angry
  state;
- whether the state is sufficiently reliable to interrupt a task.

Those are four different claims and need four different evaluation layers.

## Research deliverables

- [01-emotiefflib-model-audit.md](01-emotiefflib-model-audit.md) reconstructs the
  deployed graph, upstream PyTorch model, preprocessing, label order, feature
  interface, training recipe, and licensing lineage.
- [02-finetuning-strategies.md](02-finetuning-strategies.md) compares calibration,
  linear probing, staged unfreezing, full fine-tuning, multi-task learning,
  personalization, domain adaptation, and temporal modeling.
- [03-alternative-models.md](03-alternative-models.md) compares EmotiEffLib
  variants, POSTER++, DDAMFN, LibreFace, and EmoNet on trainability, runtime,
  checkpoints, task outputs, and license constraints.
- [04-calibration-and-uncertainty.md](04-calibration-and-uncertainty.md) turns the
  calibration literature into a Vibecheck-specific score and trigger design.
- [05-data-evaluation-and-pitfalls.md](05-data-evaluation-and-pitfalls.md) covers
  label semantics, dataset choices, leakage, imbalance, fairness, licensing,
  privacy, domain shift, and the limits of inferring internal emotion.
- [06-experiment-roadmap.md](06-experiment-roadmap.md) is the gated implementation
  sequence and experiment matrix.
- [source-catalog.tsv](source-catalog.tsv) is the reproducible source inventory.
- [manifest.json](manifest.json) records collection status, word count, local
  paths, provenance, and why each source matters.
- `raw/` contains one local capture per source, organized by source type. It is a
  regenerated local evidence cache and is intentionally ignored by Git.
- [collect_sources.py](collect_sources.py) refreshes the corpus and preserves
  collection failures in the manifest.

## Evidence corpus

The corpus contains 44 sources:

- two high-coverage survey hubs plus upstream project sources;
- primary EmotiEffLib and EmotiEffNet papers;
- the EfficientNet, Noisy Student, VGGFace2, and SAM lineage papers;
- primary AffectNet, RAF-DB, FER+, Aff-Wild2, and dataset-license sources;
- FER-specific work on uncertainty, soft labels, class imbalance, dataset bias,
  domain generalization, and demographic bias;
- foundational calibration, calibration-metric, and selective-classification
  papers;
- papers and repositories for four alternative model families;
- a comprehensive scientific review on the limits of reading internal emotion
  from facial movement;
- the official EU AI Act text.

At collection time, 42 captures were substantive and two were intentionally marked
`thin`: the short upstream training index and the short DDAMFN repository README.
The full DDAMFN paper and the actual local training notebooks provide the missing
substance. No failed source is silently omitted.

To refresh all sources:

```bash
.venv/bin/python experimentation/research/collect_sources.py
```

To retry selected sources while preserving the rest of the manifest:

```bash
.venv/bin/python experimentation/research/collect_sources.py SOURCE_SLUG [...]
```

## Recommended sequence

### 1. Fix observability before changing weights

Return and persist pre-softmax logits, model/version identifiers, face-detection
quality, crop geometry, timestamps, and the exact preprocessing version. Current
softmax scores are not calibrated probabilities.

### 2. Define the target as displayed facial expression

Use terms such as “anger-like facial expression score,” not “the user is angry.”
The research evidence does not support context-free inference of a person's
internal emotional state from a single facial configuration.

### 3. Build a domain-matched, subject-disjoint evaluation set

Capture the camera, lighting, pose, occlusion, glasses, distance, and expression
intensity conditions in which Vibecheck actually runs. Split by person and
recording session before extracting frames. Never split adjacent video frames
randomly.

### 4. Calibrate the current model

Fit temperature scaling on a held-out calibration split. Compare it with identity
softmax and, only if there is enough calibration data, vector or Dirichlet
calibration. Evaluate classwise and event-level reliability, not only top-1 ECE.

### 5. Select policy thresholds from operational cost

The angry frame's entry threshold is a policy threshold, not necessarily `0.50`.
Choose it from a precision/false-trigger target. Keep display and interruption
thresholds separate; an interruption should generally require stronger evidence.

### 6. Linear-probe the existing embedding

The current model already exposes a 1,280-dimensional face-expression embedding.
A regularized linear head is the lowest-risk way to learn Vibecheck-specific class
boundaries and provides a strong test of whether the problem is merely the
classifier head.

### 7. Fine-tune progressively

If the head plateaus, unfreeze the last EfficientNet stage, then the last two
stages, with lower backbone learning rates and early stopping. Run a full
fine-tune only with enough diverse subjects and a clear cross-subject gain.

### 8. Compare alternatives under the same pipeline

Compare models on the same detector, crop, domain dataset, calibration split,
latency measurement, ONNX export, and event policy. Published benchmark numbers
are not directly comparable when preprocessing, extra data, class set, or split
differs.

## Non-negotiable acceptance checks

- subject-disjoint and session-disjoint train/calibration/test splits;
- raw logits saved before any calibration;
- exact class order and preprocessing stored with each checkpoint;
- macro-F1, balanced accuracy, per-class precision/recall, NLL, Brier score,
  classwise adaptive calibration error, and reliability diagrams;
- event-level false activations per hour and precision for the angry-expression
  state;
- confusion analysis for anger vs. disgust, sadness, neutral, concentration,
  squinting, low light, and partial occlusion;
- risk-coverage curves for abstention;
- slice results for skin tone, apparent age, gender presentation, glasses, facial
  hair, pose, lighting, face size, and camera;
- a cross-dataset or cross-session stress test;
- calibration repeated after quantization, export, smoothing, or threshold-policy
  changes;
- explicit dataset, model-weight, and code-license review before any commercial
  training or distribution.

## Core sources

The synthesis relies most heavily on:

- [EmotiEffLib](https://github.com/sb-ai-lab/EmotiEffLib) and its bundled training
  notebooks for the model-specific facts.
- [EfficientNet](https://proceedings.mlr.press/v97/tan19a.html),
  [VGGFace2](https://arxiv.org/abs/1710.08092), and
  [SAM](https://arxiv.org/abs/2010.01412) for architecture and training lineage.
- [AffectNet](https://arxiv.org/abs/1708.03985),
  [FER+](https://arxiv.org/abs/1608.01041), and
  [Aff-Wild2](https://arxiv.org/abs/1910.04855) for supervision design.
- [On Calibration of Modern Neural Networks](https://proceedings.mlr.press/v70/guo17a.html),
  [Dirichlet calibration](https://arxiv.org/abs/1910.12656),
  [Measuring Calibration in Deep Learning](https://arxiv.org/abs/1904.01685),
  and [Selective Classification for Deep Neural Networks](https://papers.nips.cc/paper/2017/hash/4a8423d5e91fda00bb7e46540e2b0cf1-Abstract.html).
- [Relative Uncertainty Learning](https://proceedings.neurips.cc/paper/2021/hash/9332c513ef44b682e9347822c2e457ac-Abstract.html),
  [Self-Cure Network](https://openaccess.thecvf.com/content_CVPR_2020/html/Wang_Suppressing_Uncertainties_for_Large-Scale_Facial_Expression_Recognition_CVPR_2020_paper.html),
  and [Uncertainty-Aware Label Distribution Learning](https://openaccess.thecvf.com/content/WACV2023/html/Le_Uncertainty-Aware_Label_Distribution_Learning_for_Facial_Expression_Recognition_WACV_2023_paper.html).
- [Emotional Expressions Reconsidered](https://pmc.ncbi.nlm.nih.gov/articles/PMC6640856/)
  for scientific claim boundaries.
- [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)
  for the primary regulatory text.

This is research and engineering guidance, not legal advice.
