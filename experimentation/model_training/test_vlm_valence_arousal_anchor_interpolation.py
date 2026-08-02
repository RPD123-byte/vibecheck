from experimentation.model_training.vlm_valence_arousal_anchor_interpolation import (
    _parse_json_object_relaxed,
    choice_options,
    select_targets,
)


def _anchor(name, valence, arousal):
    return {
        "anchor": name,
        "valence": valence,
        "arousal": arousal,
        "image": name + ".jpg",
        "label": "surprise",
    }


def test_surprise_choices_cover_both_valence_sides_and_arousal() -> None:
    anchors = [
        _anchor("valence_negative_high_arousal_high", -0.8, 0.9),
        _anchor("valence_negative_low_arousal_high", -0.1, 0.9),
        _anchor("valence_positive_high_arousal_high", 0.9, 0.9),
        _anchor("valence_positive_low_arousal_high", 0.1, 0.9),
        _anchor("valence_negative_high_arousal_low", -0.8, -0.7),
        _anchor("valence_negative_low_arousal_low", -0.1, -0.7),
        _anchor("valence_positive_high_arousal_low", 0.9, -0.7),
        _anchor("valence_positive_low_arousal_low", 0.1, -0.7),
    ]

    options = choice_options("surprise", anchors)

    valence = {option["id"]: option["value"] for option in options["valence"]}
    arousal = {option["id"]: option["value"] for option in options["arousal"]}
    assert valence["V_NEG_HIGH_SAME"] == -0.8
    assert valence["V_NEUTRAL"] == 0.0
    assert valence["V_POS_HIGH_SAME"] == 0.9
    assert arousal["A_HIGH_SAME"] == 0.9
    assert arousal["A_LOW_SAME"] == -0.7


def test_target_selection_prefers_human_va_labels() -> None:
    records = []
    for emotion in (
        "anger",
        "contempt",
        "disgust",
        "fear",
        "happiness",
        "neutral",
        "sadness",
        "surprise",
    ):
        records.extend(
            [
                {
                    "image": f"{emotion}-1.jpg",
                    "label": emotion,
                    "valence": -0.5,
                    "arousal": 0.5,
                },
                {
                    "image": f"{emotion}-2.jpg",
                    "label": emotion,
                    "valence": -0.4,
                    "arousal": 0.4,
                },
                {"image": f"{emotion}-3.jpg", "label": emotion},
                {"image": f"{emotion}-4.jpg", "label": emotion},
            ]
        )

    selected = select_targets(records, 3)

    for targets in selected.values():
        assert len(targets) == 3
        assert sum("valence" in target for target in targets) == 2


def test_parser_repairs_truncated_choice_json() -> None:
    raw = '{"valence_option":"V_NEG_HIGH_SAME","arousal_option":"A_HIGH_SLIGHTLY_LOWER'

    assert _parse_json_object_relaxed(raw) == {
        "valence_option": "V_NEG_HIGH_SAME",
        "arousal_option": "A_HIGH_SLIGHTLY_LOWER",
    }
