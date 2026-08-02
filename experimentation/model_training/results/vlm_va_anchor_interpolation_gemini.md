# Gemini V/A anchor interpolation

Model: `gemini-3.6-flash`. Each condition used the same v2 human anchors and the same v1 target; target V/A labels were hidden from Gemini.

| Prompt | Valence MAE | Arousal MAE | V within 0.2 | A within 0.2 |
|---|---:|---:|---:|---:|
| direct | 0.183 | 0.333 | 66.7% | 55.6% |
| choices | 0.244 | 0.417 | 50.0% | 27.8% |

## Per-expression MAE

| Expression | Scored | Direct V | Direct A | Choice V | Choice A |
|---|---:|---:|---:|---:|---:|
| anger | 3 | 0.167 | 0.200 | 0.300 | 0.300 |
| contempt | 3 | 0.067 | 0.633 | 0.167 | 0.433 |
| disgust | 2 | 0.100 | 0.500 | 0.100 | 0.850 |
| fear | 2 | 0.350 | 0.150 | 0.400 | 0.250 |
| happiness | 2 | 0.300 | 0.100 | 0.400 | 0.350 |
| neutral | 2 | 0.000 | 0.600 | 0.000 | 0.700 |
| sadness | 2 | 0.300 | 0.250 | 0.400 | 0.450 |
| surprise | 2 | 0.250 | 0.150 | 0.200 | 0.050 |

The direct prompt performed better overall. The choice ladder improved both dimensions for surprise and arousal for contempt, but it also made large endpoint-selection errors. One disgust target labeled A=+0.8 was mapped to the low-arousal anchor at A=-0.5.

A source-label audit corrected one contempt target from V=+0.3 to V=-0.5. The displayed metrics and sheets use the corrected label; Gemini's stored predictions were not rerun or altered.

## Image-level results

### Anger_Results

![anger_results](vlm_va_anchor_interpolation_visuals/anger_results.png)

### Contempt_Results

![contempt_results](vlm_va_anchor_interpolation_visuals/contempt_results.png)

### Disgust_Results

![disgust_results](vlm_va_anchor_interpolation_visuals/disgust_results.png)

### Fear_Results

![fear_results](vlm_va_anchor_interpolation_visuals/fear_results.png)

### Happiness_Results

![happiness_results](vlm_va_anchor_interpolation_visuals/happiness_results.png)

### Neutral_Results

![neutral_results](vlm_va_anchor_interpolation_visuals/neutral_results.png)

### Sadness_Results

![sadness_results](vlm_va_anchor_interpolation_visuals/sadness_results.png)

### Surprise_Results

![surprise_results](vlm_va_anchor_interpolation_visuals/surprise_results.png)
