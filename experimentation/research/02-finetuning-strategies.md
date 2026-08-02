# Fine-tuning strategies

## Start by separating five problems

“Fine-tune the expression model” can mean five materially different things:

1. **Recalibration:** keep every classifier weight fixed and transform logits so
   confidence matches observed correctness.
2. **Decision-policy tuning:** keep the model fixed and choose display,
   interruption, hysteresis, duration, and abstention thresholds.
3. **Classifier adaptation:** freeze the visual encoder and learn a new head over
   the existing 1,280-dimensional embedding.
4. **Representation adaptation:** update some or all EfficientNet weights for the
   Vibecheck camera domain.
5. **Task redesign:** change outputs from eight hard categories to soft labels,
   action units, valence/arousal, temporal events, or personalized responses.

They answer different questions and need separate datasets. In particular, a
calibration set must not also be the final test set, and a policy threshold should
not be chosen by looking at final-test mistakes.

## Strategy ladder

### Strategy 0: no weight changes—measure and calibrate

**Use when:** there are fewer than a few hundred independently sampled,
human-reviewed domain examples per important class, or the current error pattern is
unknown.

**Method:**

- record raw eight-class logits;
- fit a scalar temperature on a held-out calibration set by minimizing NLL;
- compare with the identity transform;
- select class/policy thresholds on the calibration split;
- evaluate once on a locked test set.

**Advantages:**

- one learned parameter;
- preserves top-1 class ranking;
- virtually no inference cost;
- easy to version and roll back;
- tests whether `0.50` is the real problem.

**Cannot fix:**

- incorrect class boundaries;
- missing visual features;
- systematic domain bias;
- confusion caused by the crop/detector;
- OOD overconfidence by itself.

This is the mandatory baseline, not an optional polish step.

### Strategy 1: regularized linear probe

**Use when:** the backbone appears to separate the relevant expressions but the
current AffectNet/AFEW head misplaces the boundary.

EmotiEffLib exposes a 1,280-dimensional embedding. Cache one embedding per
training frame, then compare:

- multinomial logistic regression;
- a single PyTorch linear layer;
- linear SVM for accuracy diagnostics, followed by a separate calibrator if used;
- a small two-layer MLP only if linear probing clearly underfits.

Prefer L2 regularization and tune it by person-grouped cross-validation. The
linear probe should use raw embeddings, not softmax scores. A head trained on only
eight scores is too constrained and inherits the old head's information loss.

**Advantages:**

- very fast experiments;
- low overfitting risk relative to backbone tuning;
- embeddings can stay on-device during collection;
- classifier and calibrator export as a tiny matrix/bias/temperature;
- provides direct evidence on representation adequacy.

**Main risks:**

- correlated frame counts make the sample size look much larger than it is;
- a head can memorize person identity if splits leak subjects;
- a domain head may lose performance outside the collected camera conditions;
- fitting only high-intensity posed expressions will worsen subtle-expression
  behavior.

### Strategy 2: last-stage fine-tuning

**Use when:** a linear head plateaus and error inspection shows domain-specific
visual features are missing.

Recommended sequence:

1. initialize from `enet_b0_8_best_afew.pt`;
2. replace or retain the eight-class head;
3. train the head alone to convergence;
4. unfreeze the last EfficientNet stage and batch-normalization affine parameters;
5. use a backbone learning rate roughly 10–100× below the head rate;
6. apply early stopping on a compound validation objective, not accuracy alone;
7. recalibrate the selected checkpoint from scratch.

A practical optimizer baseline is AdamW. Preserve SAM as an experiment rather than
assuming the upstream recipe is optimal: SAM roughly doubles forward/backward work
per update and changes calibration as well as accuracy. Compare it fairly at equal
training compute or wall time.

**Batch normalization caution:** small person-grouped batches yield unstable
running statistics. Options:

- freeze running mean/variance and train only affine parameters;
- use sufficient batch size with balanced subject sampling;
- convert to a normalization scheme that does not depend on batch statistics,
  but treat that as an architecture change requiring a fresh baseline.

### Strategy 3: progressive unfreezing

**Use when:** the last stage helps, there is adequate subject diversity, and the
remaining errors still reflect representation mismatch.

Unfreeze one stage at a time from output toward input. Use discriminative learning
rates: smallest for early low-level layers, largest for the head. Stop at the
shallowest unfreeze depth that achieves the target domain gain without damaging
cross-session and cross-dataset performance.

Progressive unfreezing is preferable to immediately updating all four million
parameters because it yields an interpretable curve:

```text
trainable capacity → in-domain gain → cross-domain loss → calibration change
```

If the curve shows in-domain accuracy rising while held-out-subject NLL, minority
recall, or cross-camera performance worsens, the model is specializing rather than
improving.

### Strategy 4: full fine-tuning

**Use when:** thousands of diverse, independently grouped clips are available,
last-stage tuning underfits, licensing permits training, and compute/export
constraints are understood.

Full fine-tuning should include:

- mixed precision where numerically safe;
- gradient clipping;
- weight decay;
- a warmup plus cosine or plateau schedule;
- early stopping;
- multiple random seeds;
- best-checkpoint selection on macro-F1 plus NLL or a documented multi-objective;
- post-hoc calibration on a split unseen by all gradient updates;
- a comparison to the frozen-backbone baseline at equal data.

Avoid selecting the best of many runs on the final test set. The test set becomes
training data through repeated human decisions even when gradients never touch it.

### Strategy 5: multi-task expression + valence/arousal

EmotiEffLib already supplies `enet_b0_8_va_mtl`, `mbf_va_mtl`, and
`mobilevit_va_mtl`. Multi-task supervision can regularize the shared representation
because valence/arousal captures graded affect structure that hard categories
discard.

The upstream B0 MTL notebook attaches a ten-output head:

- eight expression logits;
- one valence scalar;
- one arousal scalar.

It combines class-weighted expression cross entropy with concordance-correlation
losses for valence and arousal.

**Potential benefits:**

- subtle expressions get graded supervision;
- “anger-like but low arousal” and mixed cases are less forced into one hard label;
- VA may support UI intensity separately from categorical identity;
- auxiliary tasks can reduce overfitting.

**Risks:**

- task gradients can conflict;
- VA labels are subjective and dataset-dependent;
- loss scale determines which task dominates;
- VA cannot be converted to a categorical label by a universal fixed mapping;
- ten-output arrays are easy to misinterpret as ten probabilities;
- current product semantics and protocol support only eight named scores.

Compare fixed loss weights, uncertainty-based task weighting, and gradient
balancing only after a simple MTL baseline exists.

### Strategy 6: expression + action units

Action units describe observable muscle movements and are closer to what a camera
can defendably measure than internal emotion. An AU auxiliary head can teach local
features relevant to anger-like configurations, such as brow lowering or lid
tightening, without claiming the person feels anger.

Advantages:

- more interpretable error analysis;
- possible rule-based sanity checks between class and facial movement;
- supports compound and mixed expressions;
- useful for domain transfer when category labels disagree across datasets.

Costs:

- AU annotation is expensive;
- AU occurrence is multi-label, not eight-way softmax;
- intensity and occurrence are separate tasks;
- partial occlusion creates missing-label problems;
- FACS mappings to categorical emotion are neither one-to-one nor context-free.

LibreFace is a more natural external baseline for this strategy than forcing AU
heads into the current runtime immediately.

### Strategy 7: soft-label and label-distribution training

FER+ assigns ten crowd labels per image and found that retaining the distribution
outperformed majority voting. AffectNet+ and uncertainty-aware label-distribution
work pursue the same principle: ambiguous faces should not be forced to a
one-hot fiction.

For a Vibecheck annotation interface, retain:

- every annotator's label;
- “none/other/cannot tell”;
- confidence or visibility;
- optional intensity;
- crop-quality flags;
- context-free facial-expression label separately from self-reported state.

Train with cross entropy or KL divergence against the normalized annotator
distribution. Keep “cannot tell” available for abstention analysis instead of
discarding all difficult examples.

Soft labels often improve both robustness and calibration, but label smoothing is
not a substitute. Uniform label smoothing assigns the same residual mass to every
wrong class; human label distributions reveal which alternatives are actually
plausible.

### Strategy 8: robust learning under noisy labels

Relevant FER-specific families include:

- **Self-Cure Network:** learns per-sample importance and cautiously relabels the
  lowest-ranked group.
- **Relative Uncertainty Learning:** adds an uncertainty branch and uses relative
  feature mixup.
- **Uncertainty-aware label distribution learning:** constructs targets using
  valence/arousal neighborhoods and label uncertainty.
- **Rebalanced attention/smooth-label methods:** mine minority-class information
  from majority examples.

These methods are most valuable after annotator disagreement and error analysis
show a real noise problem. They introduce extra losses and hyperparameters that
can hide poor data practices. Do not use an uncertainty network as permission to
collect only one ambiguous label per image.

### Strategy 9: domain adaptation and self-training

Unlabeled Vibecheck camera frames can be useful, but pseudo-labeling easily
amplifies the current model's mistakes.

A conservative sequence:

1. train a teacher only on labeled data;
2. calibrate it;
3. select pseudo-labels with class-specific thresholds and OOD/quality gates;
4. balance pseudo-labels by subject and class;
5. use weak augmentation for teacher inference and stronger but
   expression-preserving augmentation for student training;
6. keep labeled loss dominant;
7. verify that gains remain on a human-labeled, locked test set.

Noisy Student provides a general precedent, but expression recognition has more
subjective labels and stronger person/camera confounding than ImageNet. High
teacher confidence is not proof of label correctness.

### Strategy 10: personalization

EmotiEffLib includes notebooks for extracting fixed facial features, training a
user-independent engagement model, and adapting it with user examples. The same
idea can apply to expression display:

- global backbone;
- global calibrated head;
- optional user-specific bias/temperature/thresholds;
- shrink personalized parameters toward the global model;
- require a minimum number of labeled events;
- reset or decay adaptation when camera conditions change.

Safe personalization should adapt a small parameter set, not fine-tune the full
face encoder per user. A per-user intercept, temperature, or low-rank head is
easier to constrain and delete.

Personalization can correct a person's neutral baseline, habitual squint, facial
hair, or camera angle. It can also encode stereotypes or learn from erroneous
implicit feedback. Use explicit consent, local storage, a visible reset, and no
cross-user sharing of identifiable embeddings.

### Strategy 11: temporal modeling

Current Vibecheck temporal behavior is a downstream policy:

- repeated frame inference;
- threshold entry/exit hysteresis;
- matching-result confirmation;
- sustained duration before interruption;
- cooldown.

Model-side alternatives include:

- exponential moving averages of logits;
- median filtering;
- hidden Markov/state-space models;
- temporal convolution;
- GRU/LSTM over embeddings;
- transformer over short embedding sequences;
- learned onset/apex/offset event detection;
- EmotiEffLib's adaptive-frame-rate procedure.

Start with logit EMA and a documented event state machine. A learned temporal
model needs video-level labels and subject/session-disjoint clips. Do not randomly
split frames and claim sequence generalization.

Temporal smoothing changes the object being calibrated. A frame-calibrated score
averaged over time is not automatically an event probability. Re-evaluate
reliability and false triggers after every smoothing/persistence rule.

## Data augmentation

Expression-preserving candidates:

- horizontal flip, after confirming no asymmetric label convention;
- modest rotation and translation reflecting camera pose;
- mild scale/crop jitter that retains eyebrows, eyes, nose, and mouth;
- camera-realistic brightness, gamma, white balance, blur, compression, and sensor
  noise;
- glasses, hand, or hair occlusion augmentation when masks are realistic;
- Cutout/Random Erasing restricted so the whole expressive region is not removed;
- MixUp/CutMix only with soft targets and careful facial plausibility checks.

Avoid:

- vertical flips;
- strong geometry that changes expression cues;
- aggressive crops that omit mouth or eyebrows;
- color transforms unlike the deployed low-light path;
- augmentations applied independently to adjacent frames in a way that creates
  impossible flicker;
- synthetic expressions without a human validation study.

Augmentation should be justified by a measured deployment shift. “More
augmentation” can erase subtle cues.

## Sampling and imbalance

AffectNet and natural camera data are dominated by neutral/happy frames. Avoid
blind inverse-frequency weighting as the only response.

Compare:

- subject-balanced batches;
- class-aware sampling at the clip/event level;
- effective-number or log-smoothed class weights;
- focal loss;
- balanced softmax/logit adjustment;
- soft labels with rebalanced attention;
- targeted collection of rare classes.

Oversampling nearly identical rare-class frames creates memorization. Sample
independent clips and people, then take a bounded number of frames per clip.

Report both the natural-prevalence test distribution and a balanced diagnostic
set. The natural set estimates product behavior; the balanced set exposes class
failures. Never rebalance the final deployment test distribution and then present
its precision as an in-product estimate.

## Checkpoint objective

Do not select only on accuracy. Candidate selection should include:

- macro-F1 or balanced accuracy;
- anger/disgust/sadness precision at the intended policy region;
- NLL and Brier score;
- worst-slice performance;
- event false triggers per hour;
- runtime and artifact size.

One defensible pattern is a hard constraint plus optimization:

1. reject checkpoints above the maximum allowed false-trigger rate;
2. reject checkpoints below minimum worst-slice recall;
3. among survivors, maximize macro-F1;
4. recalibrate the winner;
5. evaluate exactly once on the locked test set.

## Export and reproducibility

Every candidate artifact should include:

- training-code commit;
- base-checkpoint SHA-256;
- data-manifest hash and license record;
- subject/session split manifest;
- class order;
- crop and normalization specification;
- optimizer, schedule, seed, and trainable layers;
- checkpoint-selection rule;
- calibration method and parameters;
- ONNX opset and exporter versions;
- parity results between PyTorch and ONNX;
- CPU latency distribution, not only mean;
- model card with known failure modes.

Prefer `state_dict` plus explicit architecture construction over pickling a whole
PyTorch object. Export the chosen PyTorch checkpoint to ONNX only after training,
then fit or verify calibration on logits from the exact deployed runtime. Compiler
fusion, quantization, or preprocessing differences can move scores enough to
invalidate a calibrator.

## Recommended first fine-tuning experiment

After calibration-only baselines:

1. freeze `enet_b0_8_best_afew`;
2. extract 1,280-dimensional embeddings with the exact deployed crop path;
3. train an L2-regularized eight-class linear head with soft labels where
   available;
4. group cross-validation by person;
5. select regularization on macro-F1 and NLL;
6. fit scalar temperature on a separate calibration fold;
7. choose anger display and interruption thresholds separately;
8. evaluate frame metrics, event metrics, calibration, slices, latency, and
   cross-session generalization;
9. compare against the untouched current model using paired bootstrap confidence
   intervals at the subject or clip level.

That experiment will reveal whether Vibecheck needs new visual features or simply
a better head and score interpretation.
