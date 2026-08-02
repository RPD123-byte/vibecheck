# EmotiEffLib model audit

## What Vibecheck deploys

Vibecheck defaults to `enet_b0_8_best_afew` in
`src/vibecheck/inference/adapters/emotiefflib.py`. The production adapter uses:

- MTCNN on CPU for face detection;
- the largest detected face with detector confidence at least `0.90`;
- a minimum detected face size of 40 pixels;
- an RGB crop bounded to the source image;
- EmotiEffLib's ONNX engine on CPU;
- eight mutually exclusive expression classes:
  anger, contempt, disgust, fear, happiness, neutral, sadness, surprise;
- a softmax distribution returned by `predict_emotions(..., logits=False)`.

The deployed artifact and the embedded upstream artifact are byte-for-byte
identical:

```text
SHA-256:
7aa2ea31c1311f4f8aa9d3fdb085d418dd4e7a48c4b9ed41df8c044f91d0213f

emotiefflib_repo/models/affectnet_emotions/onnx/enet_b0_8_best_afew.onnx
dist/runtime/vibecheck-runtime/models/enet_b0_8_best_afew.onnx
```

The corresponding PyTorch checkpoint is:

```text
SHA-256:
47c1423f3e6f50e3750bf7b0eda7db947c9ce0c2637e1766bf2187eddc652b17

emotiefflib_repo/models/affectnet_emotions/enet_b0_8_best_afew.pt
```

The embedded EmotiEffLib checkout was inspected at commit
`520a051c64cd191521e5934655314e769a319684` (2026-06-23). Its nested worktree has
only untracked `.DS_Store` files; no upstream source modifications were used in
this audit.

## Architecture

`enet_b0_8_best_afew` is not a bespoke “emotion network” from scratch. It is a
transfer-learning stack:

1. **Backbone family:** `tf_efficientnet_b0_ns` from `timm`.
2. **Generic image pretraining lineage:** the `_ns` variant denotes Noisy Student
   ImageNet pretraining architecture/weights in the timm family.
3. **Face-domain pretraining:** the upstream training notebook constructs the
   EfficientNet-B0, removes its classifier, and loads
   `state_vggface2_enet0_new.pt`, trained for face identification on VGGFace2.
4. **Expression fine-tuning:** a new 1,280-to-8 linear classifier is trained on
   AffectNet, then the whole network is fine-tuned.
5. **Video model selection:** the `best_afew` checkpoint name indicates selection
   for AFEW transfer performance; the library also supplies a `best_vgaf` sibling.

The ONNX graph provides a useful independent audit:

| Property | Value |
|---|---:|
| Input | dynamic batch × 3 × 224 × 224 |
| Output | dynamic batch × 8 |
| Parameters | 3,996,789 |
| Graph nodes | 533 |
| Penultimate embedding | 1,280 floats |
| Final layer | GEMM, weight 8 × 1,280, bias 8 |
| Producer | PyTorch 1.12.0 |
| ONNX opset | 11 |
| Artifact size | approximately 15 MB |

The graph has 81 convolution nodes, one global-average-pool node, and one final
GEMM classifier. EfficientNet-B0 uses mobile inverted bottleneck blocks and
squeeze/excitation-style channel gating; the graph's repeated sigmoid and
multiplication operations reflect that structure. The architecture is a compact
CNN, not a transformer, recurrent model, probabilistic model, or foundation
vision-language model.

## What EmotiEffLib does at runtime

Both the PyTorch and ONNX recognizers deliberately separate feature extraction
from classification.

For PyTorch:

1. load the serialized model;
2. copy the final classifier's weight and bias into NumPy;
3. replace the PyTorch classifier with an identity layer;
4. run the backbone to obtain a 1,280-dimensional embedding;
5. compute `embedding @ weight.T + bias` in NumPy;
6. optionally apply a numerically stable softmax.

For ONNX:

1. load the graph;
2. assume the final graph node is the classifier GEMM;
3. copy the GEMM weight and bias;
4. remove the final GEMM from the in-memory graph;
5. expose the GEMM input as the graph output;
6. run the truncated graph to obtain embeddings;
7. apply the copied classifier in NumPy.

This design makes three adaptation paths unusually easy:

- fit a new linear head without touching the backbone;
- calibrate raw classifier logits after inference;
- cache embeddings once and run many head/calibrator experiments cheaply.

It also creates a maintenance hazard: the ONNX loader assumes the last node is a
three-input GEMM. A differently exported graph, fused graph, quantized graph, or
model with a non-linear head can violate that assumption.

## Preprocessing

For B0 models EmotiEffLib uses:

- face crop resized directly to 224 × 224;
- RGB channel order;
- pixel scaling to `[0, 1]`;
- ImageNet mean `[0.485, 0.456, 0.406]`;
- ImageNet standard deviation `[0.229, 0.224, 0.225]`;
- channel-first float32 tensor.

The current Vibecheck path supplies a tight MTCNN rectangle without landmark
alignment or an explicit context margin. It retries face detection after a
low-light contrast stretch only when the first detection fails. If the retry
succeeds, the recognizer sees the normalized frame. This means the effective
training domain includes two preprocessing modes:

- normal camera color/contrast;
- min-max stretched low-light color/contrast.

Fine-tuning data must reproduce the deployed detector, crop, color conversion,
resize, and low-light branch. Training on pre-aligned AffectNet crops while
deploying on tight, unaligned MTCNN crops creates avoidable domain shift.

## Exact upstream AffectNet training recipe

The clearest current upstream notebook is
`training_and_examples/affectnet/train_affectnet_march2021_pytorch.ipynb`.
It implements:

- image size 224 for B0 and 260 for B2;
- batch size 32;
- training augmentation: resize plus random horizontal flip;
- validation transform: resize only;
- ImageNet normalization;
- inverse-frequency class weights normalized so the majority class has weight 1;
- label smoothing of 0.1;
- class-weighted soft-target cross entropy;
- Adam wrapped in the repository's robust/SAM-style two-step optimizer;
- stage 1: freeze the backbone, train only the linear head for 3 epochs at `1e-3`;
- stage 2: unfreeze the entire network for 6 epochs at `1e-4`;
- retain the state dict with best validation accuracy.

The notebook defines nominal defaults of 40 epochs and `3e-5`, but the executed
two-stage calls override them with the 3-epoch/6-epoch schedule above. The learning
rate scheduler is present only as commented code.

This is a reproducible starting point, not a modern gold standard:

- it selects checkpoints on validation accuracy, not macro-F1, NLL, calibration,
  or downstream event cost;
- it does not show subject-disjoint Vibecheck-domain validation;
- it uses very limited augmentation;
- inverse-frequency weights can create high-variance gradients for rare classes;
- combining class weights and label smoothing changes the effective target mass
  in ways that should be verified explicitly;
- the entire model is unfrozen at one learning rate rather than discriminative
  layer-wise rates;
- the serialized full PyTorch object depends on compatible timm class definitions;
- calibration is absent.

## Available EmotiEffLib checkpoints

Independent ONNX inspection gives:

| Model | Backbone/head | Input | Output | Embedding | Parameters | Intended use |
|---|---|---:|---:|---:|---:|---|
| `enet_b0_8_best_afew` | EfficientNet-B0 | 224 | 8 | 1,280 | 3,996,789 | current Vibecheck; AFEW-selected |
| `enet_b0_8_best_vgaf` | EfficientNet-B0 | 224 | 8 | 1,280 | 3,996,789 | VGAF-selected |
| `enet_b0_8_va_mtl` | EfficientNet-B0 | 224 | 8 + VA | 1,280 | 3,999,351 | expression plus valence/arousal |
| `enet_b2_7` | EfficientNet-B2 | 260 | 7 | 1,408 | 7,677,074 | no contempt |
| `enet_b2_8` | EfficientNet-B2 | 260 | 8 | 1,408 | 7,678,483 | larger categorical model |
| `mbf_va_mtl` | MobileFaceNet | 112 | 8 + VA | 512 | 2,054,282 | smallest/mobile multi-task |
| `mobilevit_va_mtl` | MobileViT | 224 | 8 + VA | 768 | 9,821,779 | hybrid CNN/transformer multi-task |

For `_mtl` checkpoints, the final two outputs are valence and arousal regression
values, not categorical logits. EmotiEffLib applies softmax only to the expression
prefix. Code that treats the entire output vector as probabilities will be wrong.

## Published upstream performance and its limits

The EmotiEffLib README reports validation accuracy for AffectNet, AFEW, and VGAF
and mobile CPU inference time. For the current B0 AFEW-selected model it reports:

- AffectNet 8-class accuracy: 60.95%;
- AffectNet 7-class accuracy: 64.63%;
- AFEW accuracy: 59.89%;
- VGAF accuracy: 66.80%;
- approximately 59 ± 26 ms on the authors' Samsung Fold 3 setup;
- approximately 16 MB.

These numbers are useful for lineage, not a Vibecheck acceptance test. The README
explicitly notes that AFEW/VGAF accuracy is reported on the subset where MTCNN
detects faces. Excluding detector failures inflates end-to-end performance relative
to a real camera pipeline. Dataset, detector, crop, hardware, class prevalence,
and decision policy all differ from Vibecheck.

## Current product score semantics

The adapter asks for `logits=False`, so its eight outputs:

- are non-negative and sum to one;
- are mutually coupled by softmax;
- are suitable for ranking classes;
- are **not automatically calibrated probabilities**;
- do not include face-detection uncertainty;
- do not represent the probability of an internal emotional state;
- do not remain calibrated after arbitrary smoothing, hysteresis, thresholding, or
  selection unless the resulting event is evaluated separately.

The downstream schema validates only that every score lies in `[0, 1]`; it does not
require the scores to sum to one and does not attach model/calibration metadata.
The display/interruption policy then gives the numerical score operational meaning.
That is why raw logits and versioned calibration must be added before model work.

## Licensing lineage

- EmotiEffLib code is Apache-2.0 according to its repository.
- POSTER and other comparison licenses do not affect this checkpoint.
- AffectNet access is governed by a separate dataset agreement. The captured
  academic license restricts use to non-commercial research/education and directs
  commercial entities to a commercial agreement.
- VGGFace2 and any face-identification pretraining data have their own access terms.
- A permissive code license does not automatically grant rights in upstream
  datasets, images, annotations, model weights, or a new fine-tuned artifact.

Before distributing a commercially fine-tuned model, legal review should trace
code, pretrained weights, every training example, annotations, and intended use.

## Audit conclusion

The current model is small, well suited to CPU ONNX inference, and unusually easy
to adapt through its exposed embedding. Its weakest point for Vibecheck is not
obvious capacity. It is the absence of domain-matched validation and calibration
between raw model evidence and a costly product action. Preserve this model as the
baseline and exploit its 1,280-dimensional representation before replacing it.
