# Gemini valence/arousal labeling: observed behavior

This note records what the experiments currently suggest about Gemini's V/A
labeling behavior for Rithvik's posed expressions. These are working findings
from a small personal dataset, not general claims about every Gemini model or
person.

## Current best protocol

Give Gemini the known expression category and all human-labeled v2 anchors for
that same expression. Put the exact expression, valence, arousal, and anchor
role immediately before each image. Ask Gemini to interpolate the target's
valence and arousal independently and return direct numeric values in 0.1
increments.

Direct numeric interpolation currently works better than asking Gemini to pick
verbal positions such as "same as the high anchor" or "slightly lower." Across
18 hidden human-labeled v1 targets, after correcting one contempt label:

| Prompt | Valence MAE | Arousal MAE | V within 0.2 | A within 0.2 |
|---|---:|---:|---:|---:|
| Direct numeric interpolation | 0.183 | 0.333 | 66.7% | 55.6% |
| Anchor-relative choices | 0.244 | 0.417 | 50.0% | 27.8% |

The direct prompt is promising but not yet reliable enough to treat every
Gemini label as ground truth. Average error is about 1.8 valence ticks and 3.3
arousal ticks on the 0.1 scale.

## What changed across the experiments

The first paired experiment showed that one personal reference was especially
useful for arousal. On six scored targets, zero-shot labeling had valence MAE
`0.117` and arousal MAE `0.418`; adding one same-expression reference changed
those to `0.100` and `0.201`. The later reasoning audit used seven targets and
produced valence MAE `0.200` and arousal MAE `0.300`. The current all-anchor
experiment uses 18 scored targets and produces the corrected metrics above.

These numbers are not a clean leaderboard because the target sets and prompts
differ. The stable qualitative result is that personal examples can strongly
improve arousal, while requesting more verbal reasoning or more discrete
choices does not necessarily improve the final numeric label.

## Assumptions Gemini appears to make

### It begins from a population-average visual prior

Without personal references, Gemini interprets the face through common visual
associations: wide eyes and open mouths imply high activation; relaxed eyelids,
closed mouths, and limited tension imply low activation; smile-like mouth
geometry pulls valence positive. Personal anchors can move this prior, but do
not fully replace it.

### It recognizes the side of a dimension more easily than the magnitude

Gemini is often directionally right about whether valence is positive or
negative and whether arousal is broadly high or low. It has more difficulty
distinguishing values such as 0.3 from 0.7, especially when the target uses a
different facial configuration from the nearest anchor.

### It treats stereotyped geometry as evidence of intensity

Gemini can underweight a person's intended intensity when the face lacks the
population-stereotypical geometry it expects. The earlier sadness audit showed
this clearly: a human-labeled high-arousal sadness face was judged subdued
because it lacked wide eyes or open-mouthed crying. Large displacement of the
mouth from the person's resting face was not enough to override that prior.

### It can confuse category-neutrality with arousal-neutrality

Both v1 neutral targets were human-labeled at the ordinary arousal baseline
`A=0.0`. Gemini assigned `A=-0.6` directly and chose the `A=-0.7` low anchor in
the discrete condition. A facially neutral expression therefore tends to be
interpreted as calm/deactivated rather than as the user's ordinary baseline.

### Verbal choices encourage endpoint snapping

The qualitative ladder was intended to remove false numeric precision, but it
often caused a larger failure: Gemini selected the wrong reference endpoint.
For one disgust target labeled `A=+0.8`, direct interpolation produced `+0.1`
and the choice condition selected the low-arousal anchor at `-0.5`. The option
format helped on surprise, where the target geometry aligned well with the
anchor ordering, but hurt overall.

## Known failure modes

### Fear can look shocked without looking severe

Record this as a specific calibration risk. One fear target was human-labeled
`V=-0.7, A=+0.6`. Gemini recognized its activation (`A=+0.8`) but assigned only
`V=-0.1` in both prompt conditions. The face looked shocked, yet Gemini treated
that shock-like manifestation as only mildly unpleasant. In an earlier audit,
exposed teeth were also interpreted partly as grin-like geometry, pulling fear
valence toward positive. The transferable failure is:

> Gemini can detect that fear is activated while underestimating how severe or
> negative the user intends the fear to be.

This is not simply a fear-versus-surprise category error—the prompt already
supplies the fear category. It is a magnitude error inside the known category.

### Arousal can be inverted for disgust

Gemini sometimes treats a tightly compressed or static disgust face as low
activation even when the user labels it highly aroused. The worst choice-based
error crossed from `A=+0.8` to `A=-0.5`.

### Low-arousal contempt can be overestimated

Two low-arousal contempt targets were incorrectly judged positively activated
by the direct prompt. The choice ladder reduced the aggregate contempt arousal
error but still placed them around baseline rather than at their human labels.

### Different manifestations of the same emotion remain difficult

Supplying the categorical expression prevents reclassification, but does not
guarantee correct interpolation. Gemini can still compare a target mainly to
the anchor with the most similar mouth or eye shape rather than infer a
person-specific latent intensity across different manifestations.

### Temperature zero is not exact repeatability

Repeated smoke and full requests for the same anger target differed by roughly
0.1 in both dimensions despite temperature zero. Evaluation and pseudo-label
generation should preserve raw responses and, for important samples, measure
repeat consistency rather than assuming deterministic labels.

## Label-quality lesson

The v1 contempt record `20260730T220340_337254Z_contempt.jpg` was initially
labeled `V=+0.3`. That contradicted the user's intended negative contempt
valence and made the negative/neutral choice vocabulary incapable of returning
the human target. The source label has been corrected to `V=-0.5`; Gemini's raw
predictions were left unchanged and the experiment was rescored.

This correction matters beyond one metric. Human labels are the calibration
target, so a bad human label makes accurate model behavior appear wrong and can
teach a trainable head the wrong mapping. Dataset changes should therefore be
propagated through copied validation records, cached labels, reports, and
visualizations.

## Product implications

- Prefer direct numeric interpolation over the current verbal-choice ladder.
- Treat Gemini labels as calibrated pseudo-labels, not unquestionable truth.
- Preserve the user's anchors and corrections as the highest-priority signal.
- Keep known per-emotion failure notes, particularly fear-severity and
  disgust-arousal underestimation.
- Use human review or repeat-consistency checks for labels that will materially
  affect training.
- Continue accumulating naturally occurring personal examples. More anchor
  images help only when they cover the person's different manifestations, not
  merely more points on the numeric scale.
- Evaluate on a later untouched session; these targets are small, posed, and
  often temporally adjacent.

## Experiment artifacts

- `vlm_va_anchor_interpolation_gemini.json` contains prompts, raw Gemini
  responses, numeric resolutions, and corrected human targets.
- `vlm_va_anchor_interpolation_gemini.md` contains aggregate and per-expression
  metrics plus the comparison sheets.
- `vlm_valence_arousal_one_shot_gemini_3_6_flash.json` records the earlier
  one-reference experiment.
- `vlm_valence_arousal_reasoning_audit_gemini_3_6_flash.json` records the
  earlier magnitude-reasoning audit.
