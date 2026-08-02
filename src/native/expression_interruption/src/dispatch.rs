use crate::policy::emotion_message;
use crate::protocol::SelectedEmotion;
use crate::reaction::{ReactionEvent, ReactionResult};
use crate::status::StatusPublisher;
use codex_control::{ActionOutcome, Handle};
use serde_json::json;
use std::time::Duration;

pub enum DispatchResult {
    Latch,
    Snooze,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MutationOutcome {
    Confirmed,
    Rejected,
    OutcomeUnknown,
}

pub(crate) trait MutationClient {
    async fn active_turns(&self) -> Vec<(String, String)>;
    async fn interrupt(&self, thread_id: &str, turn_id: &str) -> MutationOutcome;
    async fn start(&self, thread_id: &str, inputs: Vec<serde_json::Value>) -> MutationOutcome;
}

impl MutationClient for Handle {
    async fn active_turns(&self) -> Vec<(String, String)> {
        self.snapshot()
            .await
            .threads
            .into_iter()
            .filter_map(|(thread_id, thread)| {
                thread.active_turn_id.map(|turn_id| (thread_id, turn_id))
            })
            .collect()
    }

    async fn interrupt(&self, thread_id: &str, turn_id: &str) -> MutationOutcome {
        mutation_outcome(Handle::interrupt(self, thread_id, turn_id).await)
    }

    async fn start(&self, thread_id: &str, inputs: Vec<serde_json::Value>) -> MutationOutcome {
        mutation_outcome(Handle::start(self, thread_id, inputs).await)
    }
}

fn mutation_outcome(outcome: ActionOutcome) -> MutationOutcome {
    match outcome {
        ActionOutcome::Confirmed { .. } => MutationOutcome::Confirmed,
        ActionOutcome::Rejected { .. } => MutationOutcome::Rejected,
        ActionOutcome::OutcomeUnknown { .. } => MutationOutcome::OutcomeUnknown,
    }
}

pub async fn dispatch<C: MutationClient + Sync>(
    handle: &C,
    status: &StatusPublisher,
    emotions: &[SelectedEmotion],
    configured_thread_id: Option<&str>,
) -> DispatchResult {
    let active = eligible_active_turns(handle, configured_thread_id).await;
    if active.is_empty() {
        status
            .publish(
                "no_active_turn",
                emotions,
                configured_thread_id,
                None,
                Some("No eligible Codex turn is active."),
            )
            .await;
        return DispatchResult::Snooze;
    }
    if active.len() > 1 {
        status
            .publish(
                "multiple_active_turns",
                emotions,
                None,
                None,
                Some("Single-thread targeting will not guess among active turns."),
            )
            .await;
        return DispatchResult::Snooze;
    }

    let (thread_id, turn_id) = &active[0];
    let message = emotion_message(emotions);
    status
        .publish(
            "interrupting",
            emotions,
            Some(thread_id),
            Some(&message),
            None,
        )
        .await;
    let outcome = handle.interrupt(thread_id, turn_id).await;
    if outcome == MutationOutcome::Rejected
        || !wait_until_turn_stops(handle, thread_id, turn_id).await
    {
        status
            .publish(
                "interrupt_failed",
                emotions,
                Some(thread_id),
                Some(&message),
                Some("The selected turn could not be confirmed stopped."),
            )
            .await;
        return DispatchResult::Snooze;
    }

    status
        .publish(
            "restarting",
            emotions,
            Some(thread_id),
            Some(&message),
            None,
        )
        .await;
    let outcome = handle
        .start(thread_id, vec![json!({"type": "text", "text": message})])
        .await;
    match outcome {
        MutationOutcome::Confirmed => {
            status
                .publish("sent", emotions, Some(thread_id), Some(&message), None)
                .await;
            DispatchResult::Latch
        }
        MutationOutcome::OutcomeUnknown => {
            status
                .publish(
                    "sent_outcome_unknown",
                    emotions,
                    Some(thread_id),
                    Some(&message),
                    Some("The write may have succeeded and will not be resent."),
                )
                .await;
            DispatchResult::Latch
        }
        MutationOutcome::Rejected => {
            status
                .publish(
                    "restart_failed",
                    emotions,
                    Some(thread_id),
                    Some(&message),
                    Some("The context turn was rejected."),
                )
                .await;
            DispatchResult::Snooze
        }
    }
}

async fn eligible_active_turns<C: MutationClient + Sync>(
    handle: &C,
    configured_thread_id: Option<&str>,
) -> Vec<(String, String)> {
    handle
        .active_turns()
        .await
        .into_iter()
        .filter(|(thread_id, _)| configured_thread_id.is_none_or(|target| target == thread_id))
        .collect()
}

async fn wait_until_turn_stops<C: MutationClient + Sync>(
    handle: &C,
    thread_id: &str,
    turn_id: &str,
) -> bool {
    for _ in 0..20 {
        let active = handle
            .active_turns()
            .await
            .iter()
            .any(|(active_thread, active_turn)| {
                active_thread == thread_id && active_turn == turn_id
            });
        if !active {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

pub async fn dispatch_reactions<C: MutationClient + Sync>(
    handle: &C,
    events: &[ReactionEvent],
    configured_thread_id: Option<&str>,
) -> Vec<ReactionResult> {
    let active = eligible_active_turns(handle, configured_thread_id).await;
    if active.is_empty() {
        return events
            .iter()
            .map(|event| ReactionResult::new(&event.event_id, "no_active_turn"))
            .collect();
    }
    if active.len() > 1 {
        return events
            .iter()
            .map(|event| ReactionResult::new(&event.event_id, "multiple_active_turns"))
            .collect();
    }

    let (thread_id, turn_id) = &active[0];
    let interrupt = handle.interrupt(thread_id, turn_id).await;
    if interrupt == MutationOutcome::Rejected
        || !wait_until_turn_stops(handle, thread_id, turn_id).await
    {
        return reaction_results(events, "interrupt_failed", Some(thread_id));
    }
    let inputs = reaction_inputs(events);
    let outcome = handle.start(thread_id, inputs).await;
    let state = match outcome {
        MutationOutcome::Confirmed => "sent",
        MutationOutcome::OutcomeUnknown => "sent_outcome_unknown",
        MutationOutcome::Rejected => "restart_failed",
    };
    reaction_results(events, state, Some(thread_id))
}

fn reaction_inputs(events: &[ReactionEvent]) -> Vec<serde_json::Value> {
    let mut inputs = Vec::with_capacity(events.len() * 2);
    for event in events {
        inputs.push(json!({"type": "text", "text": event.message()}));
        inputs.push(json!({
            "type": "localImage",
            "path": event.screenshot_path.to_string_lossy()
        }));
    }
    inputs
}

fn reaction_results(
    events: &[ReactionEvent],
    outcome: &str,
    thread_id: Option<&str>,
) -> Vec<ReactionResult> {
    events
        .iter()
        .map(|event| {
            let mut result = ReactionResult::new(&event.event_id, outcome);
            result.thread_id = thread_id.map(str::to_owned);
            result
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };
    use tokio::sync::Mutex;

    struct FakeMutation {
        active: Mutex<Vec<(String, String)>>,
        interrupt_outcome: MutationOutcome,
        start_outcome: MutationOutcome,
        stop_on_interrupt: bool,
        interrupts: AtomicUsize,
        starts: AtomicUsize,
        inputs: Mutex<Vec<serde_json::Value>>,
    }

    impl FakeMutation {
        fn new(active: &[(&str, &str)]) -> Self {
            Self {
                active: Mutex::new(
                    active
                        .iter()
                        .map(|(thread, turn)| ((*thread).into(), (*turn).into()))
                        .collect(),
                ),
                interrupt_outcome: MutationOutcome::Confirmed,
                start_outcome: MutationOutcome::Confirmed,
                stop_on_interrupt: true,
                interrupts: AtomicUsize::new(0),
                starts: AtomicUsize::new(0),
                inputs: Mutex::new(Vec::new()),
            }
        }

        fn with_outcomes(
            mut self,
            interrupt: MutationOutcome,
            start: MutationOutcome,
            stop_on_interrupt: bool,
        ) -> Self {
            self.interrupt_outcome = interrupt;
            self.start_outcome = start;
            self.stop_on_interrupt = stop_on_interrupt;
            self
        }
    }

    impl MutationClient for FakeMutation {
        async fn active_turns(&self) -> Vec<(String, String)> {
            self.active.lock().await.clone()
        }

        async fn interrupt(&self, _thread_id: &str, _turn_id: &str) -> MutationOutcome {
            self.interrupts.fetch_add(1, Ordering::Relaxed);
            if self.stop_on_interrupt && self.interrupt_outcome != MutationOutcome::Rejected {
                self.active.lock().await.clear();
            }
            self.interrupt_outcome
        }

        async fn start(&self, _thread_id: &str, inputs: Vec<serde_json::Value>) -> MutationOutcome {
            self.starts.fetch_add(1, Ordering::Relaxed);
            *self.inputs.lock().await = inputs;
            self.start_outcome
        }
    }

    fn event(id: &str, text: &str) -> ReactionEvent {
        ReactionEvent {
            schema_version: 1,
            event_id: id.into(),
            captured_at_ms: 1,
            source_application_name: "Fixture".into(),
            source_bundle_id: "com.example.fixture".into(),
            reaction_emoji: "🎯".into(),
            reaction_label: "Target".into(),
            copy_text: text.into(),
            screenshot_path: PathBuf::from(format!("/runtime/{id}.png")),
        }
    }

    #[test]
    fn explicit_inputs_preserve_text_image_commit_order() {
        let inputs = reaction_inputs(&[event("one", "First"), event("two", "Second")]);
        assert_eq!(inputs.len(), 4);
        assert_eq!(inputs[0]["type"], "text");
        assert!(inputs[0]["text"].as_str().unwrap().contains("First"));
        assert_eq!(inputs[1]["type"], "localImage");
        assert_eq!(inputs[1]["path"], "/runtime/one.png");
        assert_eq!(inputs[2]["type"], "text");
        assert!(inputs[2]["text"].as_str().unwrap().contains("Second"));
        assert_eq!(inputs[3]["type"], "localImage");
        assert_eq!(inputs[3]["path"], "/runtime/two.png");
    }

    #[test]
    fn batch_results_are_correlated_without_history() {
        let events = [event("one", "First"), event("two", "Second")];
        let results = reaction_results(&events, "sent", Some("thread"));
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].event_id, "one");
        assert_eq!(results[1].event_id, "two");
        assert!(results.iter().all(|result| result.outcome == "sent"));
    }

    #[tokio::test]
    async fn explicit_routing_never_guesses_zero_or_multiple_active_turns() {
        let events = [event("one", "First")];
        let zero = FakeMutation::new(&[]);
        let zero_results = dispatch_reactions(&zero, &events, None).await;
        assert_eq!(zero_results[0].outcome, "no_active_turn");
        assert_eq!(zero.interrupts.load(Ordering::Relaxed), 0);
        assert_eq!(zero.starts.load(Ordering::Relaxed), 0);

        let many = FakeMutation::new(&[("thread-1", "turn-1"), ("thread-2", "turn-2")]);
        let many_results = dispatch_reactions(&many, &events, None).await;
        assert_eq!(many_results[0].outcome, "multiple_active_turns");
        assert_eq!(many.interrupts.load(Ordering::Relaxed), 0);
        assert_eq!(many.starts.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn exactly_one_turn_receives_one_ordered_batch() {
        let client = FakeMutation::new(&[("thread-1", "turn-1")]);
        let events = [event("one", "First"), event("two", "Second")];
        let results = dispatch_reactions(&client, &events, None).await;
        assert!(results.iter().all(|result| result.outcome == "sent"));
        assert!(
            results
                .iter()
                .all(|result| result.thread_id.as_deref() == Some("thread-1"))
        );
        assert_eq!(client.interrupts.load(Ordering::Relaxed), 1);
        assert_eq!(client.starts.load(Ordering::Relaxed), 1);
        let inputs = client.inputs.lock().await;
        assert_eq!(inputs.len(), 4);
        assert_eq!(inputs[0]["type"], "text");
        assert_eq!(inputs[1]["path"], "/runtime/one.png");
        assert_eq!(inputs[2]["type"], "text");
        assert_eq!(inputs[3]["path"], "/runtime/two.png");
    }

    #[tokio::test]
    async fn rejection_and_uncertainty_are_correlated_without_retry() {
        let events = [event("one", "First")];
        let rejected = FakeMutation::new(&[("thread-1", "turn-1")]).with_outcomes(
            MutationOutcome::Rejected,
            MutationOutcome::Confirmed,
            false,
        );
        let rejected_results = dispatch_reactions(&rejected, &events, None).await;
        assert_eq!(rejected_results[0].outcome, "interrupt_failed");
        assert_eq!(rejected.starts.load(Ordering::Relaxed), 0);

        let unknown = FakeMutation::new(&[("thread-1", "turn-1")]).with_outcomes(
            MutationOutcome::Confirmed,
            MutationOutcome::OutcomeUnknown,
            true,
        );
        let unknown_results = dispatch_reactions(&unknown, &events, None).await;
        assert_eq!(unknown_results[0].outcome, "sent_outcome_unknown");
        assert_eq!(unknown.starts.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn replacement_never_starts_until_the_interrupted_turn_is_confirmed_stopped() {
        let events = [event("one", "First")];
        let unconfirmed = FakeMutation::new(&[("thread-1", "turn-1")]).with_outcomes(
            MutationOutcome::Confirmed,
            MutationOutcome::Confirmed,
            false,
        );
        let results = dispatch_reactions(&unconfirmed, &events, None).await;
        assert_eq!(results[0].outcome, "interrupt_failed");
        assert_eq!(unconfirmed.starts.load(Ordering::Relaxed), 0);
    }
}
