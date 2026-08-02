# Human expression collection

Run from the worktree:

```bash
source .venv/bin/activate
python experimentation/model_training/human_data_collection/capture.py
```

Click an expression button, then click anywhere in the camera image (or press
Space or `C`) to save one frame. Press `Q` or Escape to quit. Images and
`manifest.jsonl` are written to
`experimentation/model_training/human_data/rithvik_expressions_v2/`.

For v2, calibration-anchor roles are optional:

- `A HI` and `A LO` mean high and low arousal;
- `V-` and `V+` mean the negative and positive valence sides;
- the second `HI` or `LO` means high or low valence magnitude on that side.

For example, anger's `A HI / V- LO` target asks for high arousal with mildly
negative valence. `A LO / V- HI` asks for low arousal with strongly negative
valence. The dimensions are labeled jointly rather than as isolated endpoints.

The number in brackets is the number already captured for the currently
selected emotion and anchor role. An emotion does not need an anchor on a side
that is outside the categorical labeling ontology. The collector applies:

- happiness: positive valence only;
- anger, contempt, disgust, fear, and sadness: negative valence only;
- surprise: all four joint combinations on both valence directions;
- neutral: high and low arousal at neutral valence.

The anchor role is stored as metadata. Set both V/A sliders to the actual
numeric targets; `HI` and `LO` establish a relative calibration role rather
than forcing one universal numeric value. Click an already selected anchor a
second time to clear it. With no anchor selected, the image is saved normally
with its emotion and numeric V/A labels but no `anchor` field. Use this for
ordinary expressions that are not intended as calibration endpoints.

When a dataset already contains images, the tool opens in historical-review
mode:

- use `<` and `>` or `A` and `D` to navigate `1 / N`;
- click the dataset selector to switch folders;
- click an emotion to update that historical record immediately;
- click `DELETE`, then `CONFIRM`, to remove the displayed record from the
  active dataset;
- drag valence from `-1 unpleasant` to `+1 pleasant`;
- drag arousal from `-1 calm/low energy` to `+1 activated/high energy`;
- both affect sliders snap to the 21 available values in `0.1` increments;
- click an anchor role to update `anchor` on a historical v2 record, or click
  the selected role again to remove it;
- click `LIVE CAMERA` or press `L` before capturing new examples.

Historical edits atomically rewrite the JSONL manifest while preserving all
other metadata. Deleted files are recoverable: the image is moved to the
dataset's `.trash/` directory and its original metadata is appended to
`.trash/deleted_manifest.jsonl`. To label existing images without requesting
camera access:

```bash
python experimentation/model_training/human_data_collection/capture.py \
  --review-only
```

Each capture records the label and a session id. Keep a session focused on a
small number of independent attempts; do not rapidly capture hundreds of
adjacent frames and treat them as independent evidence.
