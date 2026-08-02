# Data, evaluation, validity, and common pitfalls

## Define the claim before collecting labels

A face model observes pixels and can learn recurring facial configurations. It
does not directly observe a person's private emotional state, cause, intent, or
need for intervention. A major scientific review finds that mappings from facial
movements to emotion vary substantially across people, situations, and cultures;
context-free internal-state claims therefore exceed the evidence
([Barrett et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC6640856/)).

Use four separate targets and never silently substitute one for another:

| Target | Example annotation | Appropriate claim |
|---|---|---|
| Observable expression | Raters see an anger-like facial configuration | “Anger-like expression score” |
| Self-report | Participant reports frustration or valence/arousal | “Participant-reported state” |
| Context | A task failure or event occurred | “Event/context label” |
| Utility | An intervention was helpful or unwanted | “Interruption outcome” |

Training on expression labels and reporting “the user is angry” is construct
slippage. Training on self-report and claiming visual ground truth is also wrong:
a person can feel an emotion without displaying the canonical expression, or
display it without that internal state.

## Dataset roles and constraints

Public datasets are useful for pretraining and stress testing, not substitutes
for a Vibecheck-domain evaluation cohort.

| Dataset | Useful supervision | Strength | Important limitation |
|---|---|---|---|
| AffectNet | Eight categorical classes plus valence/arousal | Large in-the-wild source and the current model's core training domain | Web-image selection, class imbalance, annotator ambiguity, and academic-use terms |
| RAF-DB | Basic and compound expressions with crowd labels | Widely used unconstrained FER benchmark | Non-commercial research access; ontology and split must be preserved |
| FER+ | Ten-rater label distributions over FER2013 faces | Supports soft-label and ambiguity experiments | Low-resolution legacy images and inherited FER2013 provenance |
| Aff-Wild2 | Video expression, valence/arousal, and action units | Multi-task temporal and naturalistic evaluation | Different class ontology, substantial temporal correlation, controlled access/terms |
| Vibecheck cohort | Exact cameras, crops, lighting, use context, and policy outcomes | Only direct estimate of deployment behavior | Must be consented, governed, independently split, and large enough at the event/person level |

[AffectNet](https://arxiv.org/abs/1708.03985) contains more than one million
collected images, with a large manually annotated subset, but its
[academic-use agreement](https://mohammadmahoor.com/wp-content/uploads/2023/03/AffectNet-Agreement-v2-30Mar2023.pdf)
is explicitly non-commercial and points commercial users to a separate license.
[FER+](https://arxiv.org/abs/1608.01041) is especially valuable because it
retains crowd label distributions instead of forcing every ambiguous face into
one hard class. [Aff-Wild2](https://arxiv.org/abs/1910.04855) supports expression,
valence/arousal, and action-unit work in video.

For every source, review three separate rights:

1. dataset access and use;
2. pretrained-weight distribution and downstream-use terms;
3. code license.

An MIT repository does not retroactively license its training images or every
linked checkpoint.

## Ontology mismatch

Common “same benchmark” comparisons are often not the same task:

- seven-class setups omit contempt; eight-class setups may include it;
- Aff-Wild2 uses an `Other` category and different expression definitions;
- FER+ retains `unknown` and `not-a-face` votes;
- valence/arousal is continuous, not a drop-in replacement for categories;
- action units describe facial muscle movements rather than inferred emotions;
- compound expressions are multi-component labels;
- class index order differs across repositories.

Create an explicit ontology mapping before training. Mapping an unsupported class
to neutral contaminates neutral. Dropping uncertain examples makes the retained
set look cleaner while hiding a deployment failure mode. Preserve `unknown`,
`other`, and abstention as first-class evaluation outcomes even if the final
classifier has eight logits.

## Domain-matched collection protocol

The collection matrix should span ordinary use, not only acted expressions:

- neutral resting, reading, concentration, squinting, speaking, yawning, and
  looking away;
- subtle and intense versions of target facial configurations;
- frontal and off-axis pose;
- distance and face-size variation;
- daytime, warm indoor, backlit, monitor-lit, and low-light conditions;
- glasses, facial hair, masks/hand occlusion, and partial crops;
- different supported camera classes and resolutions;
- face loss, multiple faces, false detections, and non-face imagery;
- repeated sessions separated in time.

Record detector outputs and crop geometry alongside the model input. A benchmark
that evaluates only successfully detected, clean faces measures conditional
classifier accuracy, not end-to-end coverage.

Raw frames and embeddings are sensitive biometric-like data. Default to local
collection, explicit informed consent, minimum retention, encrypted access,
participant deletion, and a documented purpose. Do not commit identifiable
images or embeddings to Git. A derived embedding is not automatically anonymous.

## Annotation protocol

Use a written rubric with observable visual descriptions. Do not ask raters to
guess why a person looks a certain way.

A practical protocol:

1. sample clips/events before sampling frames;
2. have at least several independent raters label expression visibility and
   intensity;
3. retain the full vote distribution;
4. provide `uncertain/cannot tell`, `other`, and `no valid face`;
5. collect self-report separately and only from the participant;
6. collect intervention helpfulness separately after an actual product event;
7. adjudicate only for quality auditing, not to erase genuine ambiguity;
8. track annotator agreement, missingness, and rubric version.

Soft targets can encode disagreement and often fit this task better than forced
one-hot labels. AffectNet+ explicitly revisits AffectNet with soft labels to
address ambiguity and imbalance
([AffectNet+](https://arxiv.org/abs/2410.22506)). Do not interpret disagreement
as mere annotator incompetence; some faces genuinely do not support a single
categorical reading.

## Split before extracting frames

The strongest leakage rule is:

> Assign people and recording sessions to splits before extracting frames,
> crops, embeddings, augmentations, or clips.

Leakage can occur through:

- the same identity in train and test;
- adjacent frames divided across folds;
- separate clips from one continuous recording;
- near-duplicate public images;
- background, camera, or session cues;
- normalization statistics computed over all data;
- fitting class weights or augmentations from test labels;
- using test results to choose checkpoints, calibrators, thresholds, smoothing,
  or abstention.

Identity leakage is especially dangerous because the backbone was face-ID
pretrained. A random image split may reward person recognition rather than
generalizable expression features.

Use group folds keyed by participant, with session nested beneath participant.
For personalization experiments, report two different questions:

- performance on known users after consented enrollment;
- performance on entirely unseen users.

Do not blend them into one score.

## Evaluation stack

### Face pipeline

Report:

- face-detection coverage and false detections;
- multiple-face selection accuracy;
- crop/landmark failure;
- coverage by lighting, pose, occlusion, face size, and camera;
- latency and failure behavior when no usable face exists.

The current MTCNN threshold, largest-face rule, tight crop, and lack of explicit
alignment are part of the model. Changing them changes the evaluated system.

### Frame classification

Report:

- confusion matrix;
- macro-F1;
- balanced accuracy or unweighted average recall;
- per-class precision, recall, F1, and support;
- natural-prevalence accuracy and a separate balanced diagnostic result;
- top-2 confusion and score-margin distributions.

Overall accuracy can be dominated by neutral/happiness. Oversampling nearly
identical frames from rare classes can inflate validation results without adding
independent evidence.

### Reliability and selective prediction

Report NLL, Brier score, classwise calibration, reliability diagrams, and
risk-coverage as specified in
[04-calibration-and-uncertainty.md](04-calibration-and-uncertainty.md).

### Continuous-session events

Report:

- false state entries and false interruptions per hour;
- event precision/recall and duration overlap;
- time-to-detection and time-to-clear;
- duplicate/fragmented events;
- percentage of time in each state and abstention;
- interruption acceptance, dismissal, or user disablement where consented.

Tune policy on continuous validation sessions. An isolated balanced frame set
cannot estimate false interruptions per hour.

### Robustness and generalization

Run held-out evaluations by session, camera/environment, and preferably a second
dataset or newly collected cohort. FER research documents substantial
cross-dataset bias
([A Deeper Look at Facial Expression Dataset Bias](https://arxiv.org/abs/1904.11150))
and poor round-robin domain generalization across datasets
([Domain Generalizability of FER Models](https://arxiv.org/abs/2106.15453)).
An in-dataset leaderboard gain should not override worse deployment-domain
performance.

## Statistical treatment

The independent unit is usually a person, session, clip, or expression event—not
a frame. Confidence intervals that treat thousands of neighboring frames as
independent will be far too narrow.

Use:

- paired bootstrap intervals resampling people or clips for model comparisons;
- per-person summaries before population aggregation;
- counts and intervals for every slice;
- predeclared primary endpoints;
- correction or careful interpretation for many exploratory comparisons;
- a power analysis based on independent events and the target false-trigger
  rate before scaling collection.

For rare false interruptions, ordinary accuracy provides almost no information.
Accumulate enough continuous negative exposure to place a useful upper confidence
bound on false events per hour.

## Fairness audit

FER models can inherit and amplify demographic imbalance
([Assessing Demographic Bias Transfer](https://arxiv.org/abs/2205.10049)).
Audit performance using consented metadata and report uncertainty, not just point
estimates.

Relevant slices may include skin-tone scale, age band, gender presentation,
glasses, facial hair, camera, pose, and lighting. Intersectional slices matter,
but sparse cells cannot support confident conclusions. Do not use the expression
model to infer protected characteristics for its own fairness evaluation. Do not
ship group-specific thresholds merely because they improve a retrospective table.

The target is not only equal top-1 accuracy. Compare:

- face-detection coverage;
- per-class false-positive and false-negative rates;
- calibration;
- abstention/coverage;
- false visible states and interruptions;
- latency and quality-gate rejection.

## Safety, privacy, and regulatory boundary

The system should communicate uncertainty and remain user-controlled:

- prefer “facial-expression estimate” to an internal-emotion assertion;
- keep raw video local by default;
- expose pause/disable controls;
- make state changes and interruptions dismissible;
- avoid high-stakes uses such as employment, education assessment, health
  diagnosis, discipline, access, or eligibility;
- document deletion and model-personalization reset behavior.

The official [EU Artificial Intelligence Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)
includes prohibitions on AI systems used to infer emotions in workplace and
education contexts, subject to specified medical or safety exceptions. Product
scope, jurisdiction, and the Act's definitions need legal review before such a
deployment. This document is engineering research, not legal advice.

## Common failure modes

| Pitfall | Why it fails | Guardrail |
|---|---|---|
| Treating softmax as probability of internal emotion | Relative class scores are neither calibrated nor construct-valid | Preserve logits, calibrate, and narrow the claim |
| Random frame split | Leaks identity/session and inflates sample size | Split people/sessions first |
| Evaluating only detected faces | Hides the detector's failures | Report end-to-end coverage and no-face outcomes |
| One global `0.50` threshold | Ignores class prevalence and product cost | Fit classwise display and interrupt policies |
| Accuracy-only selection | Hides rare-class and false-trigger failures | Use macro, classwise, calibration, event, and slice metrics |
| Rebalancing the deployment test | Produces unrealistic precision | Keep natural-prevalence test; add a separate diagnostic set |
| Full fine-tuning on a small pilot | Memorizes identity/background and forgets broad features | Start with calibration and a regularized linear probe |
| Augmenting away label meaning | Crops or geometry can erase/create expression cues | Visually audit and ablate each augmentation |
| Testing thresholds repeatedly on the test set | Converts the test set into validation | Lock pipeline and evaluate once |
| Ignoring temporal correlation | Produces narrow confidence intervals | Resample people/clips/events |
| Assuming public data permits product use | Code, weights, and data have separate rights | Maintain a license ledger |
| Calling an expression “anger” as fact | Overstates scientific evidence | Say “anger-like facial expression” and preserve context |

## Dataset and evaluation manifest

Every result should point to a versioned manifest containing:

- consent and allowed-use category;
- immutable sample/event IDs without raw identity in Git;
- participant and session group keys;
- source dataset and license record;
- annotation rubric, rater votes, self-report, and utility labels as separate
  fields;
- detector, crop, preprocessing, class map, and quality fields;
- split assignment made before feature extraction;
- exclusions with reason;
- natural and diagnostic weighting;
- model, calibration, and policy versions.

Without that provenance, a score cannot be reproduced or interpreted.
