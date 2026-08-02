# Gated experiment roadmap

## Outcome of the research phase

Do not change production weights first. The current evidence supports this order:

1. expose and evaluate the current system;
2. calibrate it and fit the event policy;
3. train a linear head on its existing embedding;
4. progressively unfreeze only if representation error remains;
5. compare alternative architectures under the identical harness.

This ordering gives every more expensive experiment a clear reason to exist.

## Experiment workspace

Keep training and evaluation isolated from production runtime dependencies:

```text
experimentation/
  expression_model/
    configs/
    data/
      manifests/       # no identifiable media
      splits/
    src/
      extract.py
      calibrate.py
      train_head.py
      train_model.py
      evaluate.py
      export.py
    tests/
    reports/
    artifacts/         # ignored; model binaries and calibrators
  research/
```

Raw recordings, detected faces, embeddings, and checkpoints should live in an
encrypted, ignored data root with a retention policy—not in the repository.
Configuration and de-identified manifests should be reviewable.

## Phase 0: freeze the present baseline

Before editing model behavior:

- record the current ONNX and PyTorch SHA-256 values;
- freeze class order, detector settings, crop, normalization, and low-light retry;
- preserve raw logits, probabilities, embeddings, detector quality, crop box,
  frame/session timestamp, model ID, and preprocessing version;
- create parity fixtures for representative valid and invalid inputs;
- record present p50/p95 latency, memory, startup timing, face coverage, and
  visible-state behavior.

The instrumentation change should not alter the output policy. Its purpose is to
make all later comparisons paired and reproducible.

### Startup availability gate

Vibecheck's emotion socket and loading heartbeat must remain active before camera
permission, provider imports, model construction, or first inference. Training
tools stay under `experimentation/` and must not become production imports.

Any runtime model experiment must prove:

- stream binding occurs before heavyweight initialization;
- loading remains active until a first reading or terminal producer state;
- slow imports/model construction do not sequentially gate heartbeats;
- delayed cold start does not falsely appear stale;
- the centralized 1.5-second freshness default and Rust fallback remain aligned.

Do not lower the freshness deadline or move initialization ahead of heartbeat
startup without a real cold-start test.

## Phase 1: build the evaluator before the model

Implement one evaluator that every candidate must use. Inputs are logits,
optional embeddings, ground-truth vote distributions, grouping keys, quality
metadata, and timestamps. Outputs should include:

- face coverage and quality failures;
- confusion matrix, macro-F1, balanced accuracy, and classwise metrics;
- NLL, Brier, classwise adaptive calibration error, and reliability data;
- risk-coverage curves;
- per-slice counts, metrics, and intervals;
- continuous event metrics and false activations/interruptions per hour;
- latency, memory, model size, and ONNX parity;
- a machine-readable result record plus a human-readable report.

Test the evaluator on synthetic logits with known answers. In particular, test
class order, empty groups, absent classes, all-abstain, no-face intervals,
session boundaries, cooldown, hysteresis, and timestamps with irregular frame
rates.

## Phase 2: collect a domain pilot

Start with enough consenting people and independent sessions to exercise the
protocol, not with a target number of frames. A small number of long videos can
contain millions of correlated frames and still provide little evidence about
new users.

The pilot should:

- span the domain matrix in
  [05-data-evaluation-and-pitfalls.md](05-data-evaluation-and-pitfalls.md);
- include long ordinary-use negative sessions for estimating false events/hour;
- deliberately capture common confounders such as concentration, squinting,
  speech, low light, and partial occlusion;
- retain multi-rater expression distributions;
- keep self-report and intervention utility as separate targets;
- cap samples per event/person during training;
- assign people and sessions to groups before frame extraction.

Use the pilot to estimate variance and run a power analysis for the next
collection. If the cohort is too small for a stable locked holdout, use nested
group cross-validation during development and reserve a newly collected cohort as
the true final test.

## Phase 3: calibration and policy baseline

Run these candidates on the untouched current ONNX logits:

| ID | Calibrator | Abstention | Temporal policy |
|---|---|---|---|
| C0 | Identity softmax | None | Current behavior |
| C1 | Scalar temperature | None | Current behavior |
| C2 | Scalar temperature | Score/margin quality gate | Current behavior |
| C3 | Scalar temperature | Selected quality gate | Classwise hysteresis + duration |
| C4 | Regularized vector or Dirichlet | Same as C3 | Same as C3 |

Select the simplest candidate that meets reliability and event false-trigger
requirements. C4 must beat C3 on grouped held-out data, not merely fit the
calibration fold better.

Freeze separate display and interruption thresholds. The interruption policy
should be evaluated as a product decision and may require an explicit opt-in or
no automatic interruption at all.

## Phase 4: linear probe

Use the 1,280-dimensional embedding from the current B0 model:

1. cache embeddings with model/crop hashes;
2. train an L2-regularized multinomial linear head;
3. compare hard labels with rater-distribution soft targets;
4. select regularization with group folds;
5. refit on the development folds;
6. fit a new calibrator on an independent calibration fold;
7. fit the policy without touching the locked test;
8. export the head and test numerical parity.

This establishes whether the deployed representation is adequate and only its
class boundaries need adaptation. It is also the safest personalization
primitive if a future opt-in design warrants that path.

## Phase 5: progressive fine-tuning

Run a controlled ladder, always initialized from the same audited checkpoint:

| ID | Trainable parameters | Purpose |
|---|---|---|
| F0 | New head only | Linear/nonlinear head baseline |
| F1 | Head + final EfficientNet stage | Adapt high-level expression features |
| F2 | Head + final two stages | Increase domain adaptation capacity |
| F3 | Full backbone | Upper-capacity experiment only with adequate data |
| F4 | Multi-task expression + VA | Test whether dimensional affect regularizes features |

For each rung:

- use lower learning rates for pretrained layers than the new head;
- compare fixed versus carefully updated batch-normalization statistics;
- use early stopping on subject-grouped validation;
- control seed, augmentations, sampler, and training budget;
- select on the predeclared multi-metric gate, not accuracy alone;
- recalibrate every trained checkpoint;
- rerun exact ONNX and runtime parity.

Advance only if the previous rung's error analysis shows representation failure
and the next rung yields a meaningful cross-subject gain without worse
calibration, slices, event behavior, or runtime.

## Phase 6: alternative-model bakeoff

Use the fixed roster from
[03-alternative-models.md](03-alternative-models.md):

1. B0 AFEW and VGAF checkpoints;
2. B0 multi-task and MobileFace multi-task embeddings;
3. B2 only if runtime permits;
4. DDAMFN after license resolution;
5. POSTER++ as a higher-capacity ceiling/teacher;
6. LibreFace for AU-oriented error analysis under research terms;
7. EmoNet as a noncommercial VA reference.

Do not copy published leaderboard rows into the decision table. Re-run the exact
same detection/crop path, ontology mapping, domain split, calibrator, policy,
hardware, warmup, and measurement method.

## Core experiment matrix

| Axis | Required values |
|---|---|
| Base representation | Current B0, sibling EmotiEffNet variants, selected challenger |
| Adaptation | Frozen, linear head, final stage, progressive, full |
| Supervision | Hard class, rater distribution, expression + VA/AU where available |
| Calibration | Identity, temperature, regularized richer challenger |
| Selection | No abstain, score/margin, capture quality, combined |
| Temporal policy | Current, hysteresis/duration, sequential challenger |
| Evaluation domain | Natural deployment, balanced diagnostic, cross-session/cohort |

Change one axis at a time for causal comparisons, then test the best combined
pipeline. Record all attempted combinations, including failed runs.

## Acceptance gates

### Correctness and reproducibility

- explicit class order and ontology mapping;
- immutable data/split manifest;
- source and base-artifact hashes;
- fixed seeds and package/export versions;
- PyTorch/ONNX/runtime logits within declared tolerances;
- evaluator unit tests;
- no test-set use in training, calibration, thresholding, or model selection.

### Efficacy

- macro-F1 and balanced accuracy do not regress beyond the declared margin;
- anger-like display and interruption meet predeclared precision/recall;
- false states and interruptions per hour meet the product budget;
- paired subject/clip bootstrap interval supports the claimed improvement;
- gains persist on new sessions or a new cohort.

Exact numerical thresholds should be set with product and safety owners before
looking at locked-test results. The research cannot invent an acceptable
interruption cost.

### Reliability and abstention

- improved or non-inferior NLL and Brier;
- classwise reliability reported, not aggregate ECE alone;
- risk decreases as coverage is reduced;
- abstention covers detector/capture failures;
- calibration remains valid after final export and temporal policy.

### Robustness and fairness

- no severe regression on lighting, pose, face-size, glasses/occlusion, camera,
  or consented demographic slices;
- per-slice counts and intervals are reported;
- end-to-end no-face and false-detection behavior is included;
- a cross-domain stress test is documented.

### Deployment

- CPU p50/p95 and cold-start latency within the agreed budget;
- peak resident memory and artifact size within the agreed budget;
- heartbeat/startup invariant passes under delayed initialization;
- fallback and model-failure behavior tested;
- code, weights, and training-data licenses separately cleared;
- model card, rollback artifact, and previous production model retained.

## Experiment record

Every run should emit a record resembling:

```yaml
run_id: ...
git_commit: ...
base_checkpoint_sha256: ...
data_manifest_sha256: ...
split_manifest_sha256: ...
config_sha256: ...
seed: ...
trainable_layers: ...
best_checkpoint_rule: ...
onnx_sha256: ...
calibrator:
  method: ...
  fit_manifest_sha256: ...
policy_version: ...
metrics_path: ...
environment:
  hardware: ...
  package_lock_sha256: ...
```

Store failed-run reason and last valid metrics rather than deleting the run. Keep
model binaries outside Git and publish hashes plus the authorized artifact
location.

## Promotion and rollback

A candidate is promotable only after:

1. the complete model-calibrator-policy tuple is frozen;
2. the locked test is run once;
3. the acceptance report is reviewed;
4. license/privacy review is recorded;
5. startup and runtime regression tests pass;
6. a shadow or explicit opt-in trial confirms continuous-session behavior;
7. the previous production tuple remains immediately restorable.

The deployment unit is not just `model.onnx`. It is:

```text
detector + crop/preprocessing + model + class map + calibrator
+ quality/abstention rules + temporal policy + product action policy
```

Changing any member requires a new version and, usually, recalibration.

## Recommended implementation order

1. Add logits/model-metadata observability with no behavior change.
2. Build and test the common evaluator.
3. Create the consented, subject/session-disjoint pilot and manifest.
4. Complete calibration, abstention, and event-policy baselines.
5. Train the regularized linear probe.
6. Run progressive B0 fine-tuning only if justified.
7. Run the fixed alternative-model bakeoff.
8. Promote only the smallest pipeline that clears every gate.

The next engineering change should therefore be a logits-first evaluation path,
not a new model or a full fine-tuning job.
