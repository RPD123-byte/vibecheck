# Rithvik v2 multitask head

## Split

- Training: 34 original v2 images with expression, valence, and arousal labels.
- Validation: 20 copied v1 images with complete human V/A labels.
- The v1 originals remain in v1. Explicit split markers prevent copied
  validation rows from entering training.

Negative-valence `high` means more negative; negative-valence `low` means
closer to zero.

## Selected checkpoint

The frozen `enet_b0_8_va_mtl` embedding feeds independent linear output rows.
The final checkpoint composes expression rows selected with anchor strength 20
and V/A rows selected with anchor strength 1000.

| Metric | Pretrained MTL head | Personalized head |
|---|---:|---:|
| Expression top-1 accuracy | 40.0% | 75.0% |
| Expression balanced accuracy | 50.0% | 83.8% |
| Expression top-2 accuracy | 75.0% | 80.0% |
| Expression macro one-vs-rest ROC-AUC | 0.908 | 0.950 |
| Expression NLL | 1.878 | 1.344 |
| Expression Brier score | 0.747 | 0.448 |
| Valence MAE | 0.229 | 0.185 |
| Valence Pearson correlation | 0.753 | 0.832 |
| Arousal MAE | 0.496 | 0.397 |
| Arousal Pearson correlation | 0.352 | 0.600 |

The personalized head makes no validation errors at or above 0.80 confidence.
Its five errors are four contempt images classified as anger and one disgust
image classified as anger. Contempt recall is therefore 20% on this holdout;
all other classes have at least 50% recall, and six of eight classes are 100%.

The largest remaining V/A weaknesses are fear valence (MAE 0.471), contempt
arousal (MAE 0.597), and disgust arousal (MAE 0.485). With only two to five
validation examples per expression, these per-class numbers are diagnostics,
not stable population estimates.

## Expression-only comparison

The prior v1 expression-only run reported 88.2% top-1 accuracy using 133
training images and a 34-image same-dataset validation split. The new result is
75.0% with 34 training images and a separate historical-image holdout. That
13.2-point difference is not an apples-to-apples estimate of model regression.

On the exact new 34/20 split, an expression-only ablation and joint V/A training
produce the same expression metrics. With the backbone frozen, V/A loss updates
only the two V/A rows and cannot alter the eight expression rows. The old/new
difference is therefore driven by data quantity, split difficulty, base-model
choice, and checkpoint selection—not by adding V/A targets.
