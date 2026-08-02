# Calibration, uncertainty, and trigger policy

## The four layers that must remain separate

Vibecheck currently turns one model score into a visible state. A defensible
system separates four layers:

1. **Prediction:** which facial-expression class best matches the crop?
2. **Calibration:** how often is a prediction with a given score correct on the
   target distribution?
3. **Selection:** when is the evidence reliable enough to emit a reading rather
   than abstain?
4. **Policy:** when should one or more readings change the display or interrupt a
   task?

Improving one layer does not automatically improve the others. A more accurate
model can be less calibrated. A calibrated in-distribution model can still be
confident on an out-of-distribution crop. A well-calibrated anger-like expression
score does not determine whether interruption is useful.

## What the current score means

`enet_b0_8_best_afew` produces eight logits in this order:

```text
Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise
```

EmotiEffLib applies softmax before returning the scores used by Vibecheck:

\[
p_k = \frac{\exp(z_k)}{\sum_j \exp(z_j)}
\]

The outputs therefore sum to one. They are relative evidence under an
eight-class, mutually exclusive training objective; they are not eight
independent probabilities that eight expressions are present.

This has an important product consequence: with a strict `> 0.50` threshold, at
most one class can pass for a frame. The current display policy narrows the result
further by selecting only its highest-ranked non-neutral class. The interruption
worker instead uses a lower default (`> 0.30`) across negative classes, so it can
return more than one label, but those labels are still mutually coupled members
of one categorical softmax—not independent evidence of co-occurring expressions.
If co-occurring facial movements are a requirement, use independent action-unit
or multi-label heads rather than reinterpret a categorical softmax.

The first code-facing prerequisite is to preserve the raw logits. Calibration
should operate on logits from the exact deployed ONNX model, not rounded or
already-thresholded probabilities.

## Calibration is not confidence decoration

A classifier is calibrated when predictions assigned probability \(q\) are
correct about fraction \(q\) under a specified distribution and definition of
correctness. Calibration is always conditional on:

- the label ontology and annotation protocol;
- the population and capture environment;
- face detection, alignment, and preprocessing;
- model weights and export path;
- the calibration method and fitted data;
- the unit of analysis: frame, clip, event, or person.

The foundational neural-network calibration study found that modern networks are
often overconfident and that a single fitted temperature is a strong baseline
([Guo et al.](https://proceedings.mlr.press/v70/guo17a.html)). Later work shows
that architecture, pretraining, augmentation, and distribution shift can change
that behavior, so overconfidence must be measured rather than assumed
([Revisiting Calibration](https://papers.nips.cc/paper/2021/hash/8420d359404024567b5aefda1231af24-Abstract.html)).

Calibration does **not** establish that:

- the input is in distribution;
- the face detector found the intended face;
- the label is scientifically valid as an internal emotion;
- the model is fair across groups;
- an intervention is beneficial.

## Methods to benchmark

### Identity softmax

Keep the existing softmax as the required baseline. Without it, an apparent
calibration gain has no reference.

### Scalar temperature scaling

Fit one positive scalar \(T\) on held-out logits by minimizing negative
log-likelihood:

\[
\hat p = \operatorname{softmax}(z/T)
\]

This preserves the predicted class and changes only sharpness. It is cheap,
stable with modest calibration data, easy to serialize, and the recommended
first method.

Fit \(T\) after model selection. Do not tune it on the test set. Optimize
`log(T)` or another positivity-preserving parameterization and report the fitted
value, objective, optimizer, convergence, and calibration-manifest hash.

### Vector or matrix scaling

Class-specific scaling and bias can correct class-dependent distortions that a
single temperature cannot. They introduce more parameters and can overfit rare
classes. Use strong regularization and subject-grouped resampling, and require a
clear held-out improvement over scalar temperature.

### Dirichlet calibration

Dirichlet calibration models multiclass log-probability relationships and can
represent richer corrections
([Kull et al.](https://papers.nips.cc/paper/2019/hash/8ca01ea920679a0fe3728441494041b9-Abstract.html)).
Benchmark its regularized form only when the independent calibration set has
adequate examples for every class. Treat it as a challenger, not an automatic
upgrade.

### Non-parametric methods

Histogram binning and isotonic regression are flexible but data hungry. With
eight imbalanced classes, small independent cohorts, and correlated video frames,
they can produce unstable steps that look good on the fitting set. If evaluated,
bootstrap at the subject or clip level and inspect every class.

### Training-time uncertainty methods

Soft-label training, uncertainty-aware label-distribution learning, Relative
Uncertainty Learning, and Self-Cure Network address ambiguity or noisy labels
during training. They may improve representations or ranking, but their output
still needs post-hoc calibration on the deployment domain:

- [Relative Uncertainty Learning](https://proceedings.neurips.cc/paper/2021/hash/9332c513ef44b682e9347822c2e457ac-Abstract.html)
- [Self-Cure Network](https://openaccess.thecvf.com/content_CVPR_2020/html/Wang_Suppressing_Uncertainties_for_Large-Scale_Facial_Expression_Recognition_CVPR_2020_paper.html)
- [Uncertainty-Aware Label Distribution Learning](https://openaccess.thecvf.com/content/WACV2023/html/Le_Uncertainty-Aware_Label_Distribution_Learning_for_Facial_Expression_Recognition_WACV_2023_paper.html)

Deep ensembles and Monte Carlo dropout can estimate epistemic variation, but
multiply compute or require an architecture/training change. They are useful
offline research comparators, not the first local real-time deployment strategy.

## The split protocol

Use three roles after training-data selection:

| Split | Permitted use |
|---|---|
| Training | Fit weights or a new linear head |
| Calibration/validation | Fit the calibrator, abstention rules, and operational thresholds |
| Locked test | One final comparison after the entire policy is frozen |

All roles must be disjoint by person and recording session. Extracting many
neighboring frames does not create independent calibration samples. Cap frames
per event or fit on clip-level aggregates, and estimate uncertainty by resampling
people or clips.

For small pilots, use nested group cross-validation for development and retain a
new locked cohort for the final test. Never call random frame-level folds
independent evidence.

## What to measure

No single calibration metric is adequate. Expected calibration error is
bin-dependent and can hide classwise failure. The calibration-metric literature
documents these pathologies and proposes static, adaptive, and thresholded
classwise variants
([Nixon et al.](https://openaccess.thecvf.com/content_CVPRW_2019/html/Uncertainty_and_Robustness_in_Deep_Visual_Learning/Nixon_Measuring_Calibration_in_Deep_Learning_CVPRW_2019_paper.html)).

Report at least:

- negative log-likelihood;
- multiclass Brier score;
- top-label ECE with binning details;
- classwise adaptive or thresholded calibration error;
- reliability diagrams with counts and subject-level confidence intervals;
- per-class precision/recall across the policy-relevant score range;
- calibration slope/intercept where practical;
- accuracy and macro-F1, to verify calibration did not disguise ranking failure.

For the actual product decision, report:

- angry-state precision and recall;
- false angry activations per hour;
- false interruptions per hour;
- time to enter and leave a state;
- event fragmentation and duplicate triggers;
- fraction of time abstaining;
- error rate at each retained-coverage level.

Frame metrics and event metrics answer different questions. Frames inside one
video event are correlated, while the cost is usually paid once per visible state
or interruption.

## Abstention and selective prediction

Selective classification explicitly trades coverage for risk
([Geifman and El-Yaniv](https://papers.nips.cc/paper/2017/hash/4a8423d5e91fda00bb7e46540e2b0cf1-Abstract.html)).
Vibecheck should be able to emit “no reliable reading” when any of these holds:

- low maximum calibrated probability;
- small margin between the top two classes;
- high predictive entropy;
- face detector confidence or face size below a validated threshold;
- excessive pose, blur, occlusion, or underexposure;
- an embedding far from the fitted domain;
- disagreement across an ensemble or temporal window.

These signals should remain inspectable separately. A bad detector crop is not
the same uncertainty as an ambiguous anger/disgust expression. Temperature
scaling alone is not an out-of-distribution detector.

Benchmark abstention with risk-coverage curves. Choose an operating point from a
cost or minimum-precision requirement, not from an aesthetically convenient
coverage percentage.

## From calibrated frames to stable events

Use different policies for presentation and interruption:

- **display threshold:** enough evidence to change the visual expression state;
- **interrupt threshold:** stronger evidence plus duration/cooldown and a
  product-level usefulness rule.

A robust event policy commonly needs:

- class-specific entry thresholds;
- lower exit thresholds for hysteresis;
- a minimum sustained duration or a \(k\)-of-\(n\) rule;
- a cooldown after an interruption;
- explicit reset behavior after face loss;
- timestamp-aware windows rather than a fixed frame count.

Every one of these parameters is fitted policy. Evaluate the combined policy on
continuous sessions. Do not select smoothing and duration on the test set, and do
not claim frame calibration remains event calibration after temporal aggregation.

Adaptive frame-rate testing can control repeated sequential decisions more
formally; the EmotiEffNet lineage includes a multiple-testing/FDR approach
([Savchenko et al.](https://proceedings.mlr.press/v202/savchenko23a.html)).
It is a useful later comparator to simple hysteresis, especially if inference is
made adaptive.

## Per-class and group reliability

An aggregate calibrator can hide severe class or group errors. At minimum inspect
reliability by:

- expression class;
- camera and lighting condition;
- face-size and pose band;
- glasses, facial hair, and occlusion;
- consented demographic slices with sufficient sample size;
- first session versus later sessions;
- known versus new participants.

Report sample counts and uncertainty. Do not fit a different calibrator for a
protected group unless there is a justified, consented deployment mechanism and a
governance review; group-specific correction may require the very sensitive
attribute the system should avoid inferring.

## Calibrator artifact contract

Store the calibrator as a versioned, inspectable artifact containing:

```yaml
base_model_sha256: ...
onnx_sha256: ...
class_order: [Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise]
preprocessing_version: ...
calibration_method: temperature
parameters:
  temperature: ...
fit_manifest_sha256: ...
fit_objective: negative_log_likelihood
threshold_policy_version: ...
created_at: ...
```

Invalidate and refit the calibrator after changing model weights, class order,
face detector/crop, normalization, quantization, ONNX graph, temporal aggregation,
or deployment population. Verify PyTorch/ONNX parity first, then fit against the
exact runtime path.

## Recommended first calibration experiment

1. Instrument the current adapter to return logits without changing the visible
   behavior.
2. Build a person/session-disjoint calibration and locked-test corpus from
   continuous Vibecheck-like recordings.
3. Benchmark identity softmax versus scalar temperature.
4. Add regularized vector and Dirichlet methods only if class counts support them.
5. Compare max-score, margin, entropy, and capture-quality abstention.
6. Select separate classwise display and interrupt policies on the calibration
   split.
7. Freeze the complete pipeline.
8. Evaluate it once on the locked test set with subject-level bootstrap intervals.

This baseline is cheaper and more diagnostic than fine-tuning. If it fails
because the current representation cannot separate the target expressions, the
error analysis supplies the evidence needed for the next training strategy.
