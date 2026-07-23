use crate::protocol::SelectedEmotion;
use std::collections::HashMap;

const NEGATIVE_EMOTIONS: [&str; 5] = ["anger", "contempt", "disgust", "fear", "sadness"];

#[derive(Debug)]
pub struct InterventionPolicy {
    threshold: f64,
    hold_ms: u64,
    cooldown_ms: u64,
    candidate: Vec<String>,
    candidate_since_ms: Option<u64>,
    latched: Vec<String>,
    baseline_since_ms: Option<u64>,
    last_sent_at_ms: Option<u64>,
}

impl InterventionPolicy {
    pub fn new(threshold: f64, hold_ms: u64, cooldown_ms: u64) -> Self {
        Self {
            threshold,
            hold_ms,
            cooldown_ms,
            candidate: Vec::new(),
            candidate_since_ms: None,
            latched: Vec::new(),
            baseline_since_ms: None,
            last_sent_at_ms: None,
        }
    }

    pub fn reset_temporal(&mut self) {
        self.candidate.clear();
        self.candidate_since_ms = None;
        self.baseline_since_ms = None;
    }

    pub fn observe(
        &mut self,
        scores: &HashMap<String, f64>,
        captured_at_ms: u64,
    ) -> Option<Vec<SelectedEmotion>> {
        let selected = select_emotions(scores, self.threshold);
        let mut signature: Vec<_> = selected.iter().map(|item| item.name.clone()).collect();
        signature.sort();

        if signature.is_empty() {
            self.candidate.clear();
            self.candidate_since_ms = None;
            let since = *self.baseline_since_ms.get_or_insert(captured_at_ms);
            if captured_at_ms.saturating_sub(since) >= self.hold_ms {
                self.latched.clear();
            }
            return None;
        }
        self.baseline_since_ms = None;

        if signature != self.candidate {
            self.candidate = signature.clone();
            self.candidate_since_ms = Some(captured_at_ms);
            return None;
        }
        let since = self.candidate_since_ms.unwrap_or(captured_at_ms);
        if captured_at_ms.saturating_sub(since) < self.hold_ms {
            return None;
        }
        if signature == self.latched {
            return None;
        }
        if self
            .last_sent_at_ms
            .is_some_and(|last| captured_at_ms.saturating_sub(last) < self.cooldown_ms)
        {
            return None;
        }
        Some(selected)
    }

    pub fn mark_sent(&mut self, emotions: &[SelectedEmotion], captured_at_ms: u64) {
        self.latched = emotions.iter().map(|item| item.name.clone()).collect();
        self.latched.sort();
        self.last_sent_at_ms = Some(captured_at_ms);
    }

    pub fn snooze(&mut self, captured_at_ms: u64) {
        self.candidate_since_ms = Some(captured_at_ms);
    }
}

pub fn select_emotions(scores: &HashMap<String, f64>, threshold: f64) -> Vec<SelectedEmotion> {
    let mut selected: Vec<_> = scores
        .iter()
        .filter(|(name, score)| {
            NEGATIVE_EMOTIONS.contains(&name.as_str()) && score.is_finite() && **score > threshold
        })
        .map(|(name, score)| SelectedEmotion {
            name: name.clone(),
            score: score.clamp(0.0, 1.0),
            degree: degree(*score),
        })
        .collect();
    selected.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.name.cmp(&right.name))
    });
    selected
}

pub fn emotion_message(emotions: &[SelectedEmotion]) -> String {
    let descriptions: Vec<_> = emotions
        .iter()
        .map(|emotion| {
            format!(
                "{} ({}; {:.0}%)",
                adjective(&emotion.name),
                emotion.degree,
                emotion.score * 100.0
            )
        })
        .collect();
    format!(
        "Nonverbal context update: the user appears {}. This was inferred from their facial expression and may be imperfect. Continue the existing task with this context in mind.",
        join_naturally(&descriptions)
    )
}

fn degree(score: f64) -> &'static str {
    match score {
        value if value >= 0.80 => "very strong",
        value if value >= 0.60 => "strong",
        value if value >= 0.40 => "moderate",
        _ => "mild",
    }
}

fn adjective(name: &str) -> &str {
    match name {
        "anger" => "angry",
        "contempt" => "contemptuous",
        "disgust" => "disgusted",
        "fear" => "afraid",
        "sadness" => "sad",
        other => other,
    }
}

fn join_naturally(values: &[String]) -> String {
    match values {
        [] => String::new(),
        [only] => only.clone(),
        [left, right] => format!("{left} and {right}"),
        many => format!(
            "{}, and {}",
            many[..many.len() - 1].join(", "),
            many.last().expect("non-empty")
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scores(values: &[(&str, f64)]) -> HashMap<String, f64> {
        values
            .iter()
            .map(|(name, score)| ((*name).to_string(), *score))
            .collect()
    }

    #[test]
    fn negative_only_and_strict_threshold() {
        let selected = select_emotions(
            &scores(&[
                ("anger", 0.51),
                ("disgust", 0.50),
                ("happiness", 0.99),
                ("neutral", 0.99),
                ("surprise", 0.99),
            ]),
            0.50,
        );
        assert_eq!(
            selected
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["anger"]
        );
    }

    #[test]
    fn continuous_hold_reset_latch_baseline_and_cooldown() {
        let anger = scores(&[("anger", 0.8)]);
        let sadness = scores(&[("sadness", 0.7)]);
        let neutral = scores(&[("neutral", 1.0)]);
        let mut policy = InterventionPolicy::new(0.5, 1_000, 15_000);
        assert!(policy.observe(&anger, 0).is_none());
        assert!(policy.observe(&anger, 999).is_none());
        let selected = policy.observe(&anger, 1_000).expect("stable anger");
        policy.mark_sent(&selected, 1_000);
        assert!(policy.observe(&anger, 20_000).is_none());
        assert!(policy.observe(&sadness, 20_001).is_none());
        assert!(policy.observe(&sadness, 21_001).is_some());
        assert!(policy.observe(&neutral, 21_002).is_none());
        assert!(policy.observe(&neutral, 22_002).is_none());
        assert!(policy.observe(&anger, 22_003).is_none());
        assert!(policy.observe(&anger, 23_003).is_some());
    }

    #[test]
    fn temporal_reset_restarts_hold() {
        let anger = scores(&[("anger", 0.8)]);
        let mut policy = InterventionPolicy::new(0.5, 1_000, 0);
        assert!(policy.observe(&anger, 0).is_none());
        policy.reset_temporal();
        assert!(policy.observe(&anger, 2_000).is_none());
        assert!(policy.observe(&anger, 2_999).is_none());
        assert!(policy.observe(&anger, 3_000).is_some());
    }

    #[test]
    fn message_is_deterministic_and_uncertainty_aware() {
        let selected = select_emotions(&scores(&[("anger", 0.68), ("disgust", 0.61)]), 0.5);
        let message = emotion_message(&selected);
        assert!(message.contains("angry (strong; 68%) and disgusted (strong; 61%)"));
        assert!(message.contains("may be imperfect"));
    }
}
