# Personalized expression head experiment

This folder contains the first measurable personalization loop:

1. Capture labeled examples locally with `human_data_collection/capture.py`.
2. Extract the same frozen 1,280-dimensional EmotiEffLib face embeddings used by the production model.
3. Train a frozen-backbone multitask linear head: an 8-way expression
   classifier initialized from the shipped head plus two scalar V/A outputs.
4. Hold out a session (or a deterministic per-class subset for a single session)
   and report correctness, confidence, calibration, ranking, and failure modes.

```bash
source .venv/bin/activate
python experimentation/model_training/human_data_collection/capture.py
python experimentation/model_training/prepare_v2_validation.py
python experimentation/model_training/train_head.py extract
python experimentation/model_training/train_head.py train
python experimentation/model_training/train_head.py evaluate
```

The defaults now point at `rithvik_expressions_v2`,
`rithvik_v2_embeddings.npz`, and `rithvik_v2_multitask_head.pt`. To rerun the
older expression-only experiment, pass the v1 paths explicitly.

Each v2 manifest row contains:

```json
{
  "label": "sadness",
  "anchor": "valence_negative_high_arousal_low",
  "valence": -0.5,
  "arousal": -0.4
}
```

The anchor describes the calibration role; the numeric fields are the
regression targets. Missing V/A fields are masked for backward compatibility,
but joint training refuses to proceed if the training fold has no affect
labels.

For negative-valence anchors, `high` means a larger negative magnitude (closer
to -1) and `low` means less negative (closer to zero). The preparation command
marks the original v2 rows as training data and copies complete human-labeled
V/A rows from v1 into v2 as an explicit validation split; it never moves or
deletes the v1 originals.

The first run is intentionally a baseline, not a claim that 200 adjacent frames
are 200 independent examples. For useful learning-curve measurements, collect
several sessions and compare subsets by independent expression events.

Captured images are local and ignored by git. Do not commit them unless that is
explicitly intended.

## Evaluation metrics

Training selects the checkpoint with the lowest joint validation objective
(expression cross-entropy plus the weighted V/A loss). The JSON report also
contains:

- balanced and top-2 accuracy;
- negative log-likelihood and multiclass Brier score for probability quality;
- median, 90th-percentile, and maximum per-image negative log-likelihood so one
  confidently wrong outlier cannot remain hidden inside the mean;
- top-label expected calibration error and confidence-binned accuracy;
- one-vs-rest ROC-AUC for each expression plus macro and support-weighted
  averages;
- mean confidence for correct and incorrect predictions;
- accuracy, coverage, and confident-error counts at 50%, 70%, 80%, and 90%
  confidence;
- expected-to-predicted confusion pairs and the highest-confidence individual
  errors with their complete eight-class distributions.

ROC-AUC measures ranking rather than probability calibration. NLL, Brier score,
calibration error, and the confident-error records are the primary diagnostics
for confidently wrong expression predictions.

Because the frozen embedding feeds independent expression and V/A output rows,
the two groups can use independently selected regularization strengths. Compose
the selected rows without retraining the backbone:

```bash
python experimentation/model_training/compose_heads.py \
  --expression experimentation/model_training/artifacts/rithvik_v2_multitask_anchor_20.pt \
  --affect experimentation/model_training/artifacts/rithvik_v2_multitask_anchor_1000.pt \
  --output experimentation/model_training/artifacts/rithvik_v2_multitask_head.pt
```

Use `--max-per-class 2`, `4`, `6`, and so on to construct a learning curve
against the same validation split. For a real generalization test, collect a
new dataset directory in a later session, extract it to a separate cache, and
evaluate an already-trained head:

```bash
python experimentation/model_training/train_head.py extract \
  --data path/to/new_session --cache path/to/new_session_embeddings.npz
python experimentation/model_training/train_head.py evaluate \
  --cache path/to/new_session_embeddings.npz \
  --output experimentation/model_training/artifacts/rithvik_v1_head_all.pt
```

## Live personalized inference

The personalized runner uses the normal face detector, crop, frozen EmotiEffLib
embedding model, inference stream, and notch consumer. It applies the
1,280-to-8 expression head and the 1,280-to-2 V/A head to the same embedding:

```bash
RUNTIME_DIR="$(mktemp -d /tmp/vibecheck-personalized.XXXXXX)"
SOCKET="$RUNTIME_DIR/emotion.sock"
PYTHONPATH=src python -m vibecheck.notch.process \
  --emotion-socket "$SOCKET" --confirmations 1 &
NOTCH_PID=$!
trap 'kill "$NOTCH_PID" 2>/dev/null; rm -rf "$RUNTIME_DIR"' EXIT INT TERM
PYTHONPATH=src python experimentation/model_training/run_personalized.py \
  --socket "$SOCKET" \
  --head experimentation/model_training/artifacts/rithvik_v2_multitask_head.pt
```

The terminal prints each live eight-class distribution together with
`valence` and `arousal`. The socket remains backward-compatible and publishes
the existing expression reading; this experimental runner exposes V/A in its
terminal JSON until the product protocol deliberately adopts those fields.
Stop with Control-C.

## Synthetic-data pilot

Generate cheap nuisance-condition variants, extract their embeddings, and run
the real/synthetic sweeps:

```bash
python experimentation/model_training/synthetic_experiment.py generate
python experimentation/model_training/synthetic_experiment.py extract
python experimentation/model_training/synthetic_experiment.py sweep
python experimentation/model_training/synthetic_experiment.py weighted
python experimentation/model_training/synthetic_experiment.py cadence
python experimentation/model_training/synthetic_experiment.py embedding
```

The experiment keeps validation images out of the synthetic source pool. See
[results/synthetic_experiment.md](results/synthetic_experiment.md) for the
current results and their same-session validation limitation.

## Gemini anchor interpolation

Run the paired direct-score versus anchor-relative-choice experiment with the
original v2 rows as human-labeled context and three v1 targets per expression:

```bash
python experimentation/model_training/vlm_valence_arousal_anchor_interpolation.py
```

The runner hides target V/A labels from Gemini, checkpoints after each paired
target, scores the 18 targets that already have human labels, and creates one
visual comparison sheet per expression. Use `--render-only` to rebuild the
report and image sheets without making API calls.
