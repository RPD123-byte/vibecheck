use crate::policy::emotion_message;
use crate::protocol::SelectedEmotion;
use crate::status::StatusPublisher;
use codex_control::{ActionOutcome, Handle};
use serde_json::json;
use std::time::Duration;

pub enum DispatchResult {
    Latch,
    Snooze,
}

pub async fn dispatch(
    handle: &Handle,
    status: &StatusPublisher,
    emotions: &[SelectedEmotion],
    configured_thread_id: Option<&str>,
) -> DispatchResult {
    let active: Vec<_> = handle
        .snapshot()
        .await
        .threads
        .into_iter()
        .filter(|(thread_id, _)| configured_thread_id.is_none_or(|target| target == thread_id))
        .filter_map(|(thread_id, thread)| thread.active_turn_id.map(|turn_id| (thread_id, turn_id)))
        .collect();
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
    if matches!(outcome, ActionOutcome::Rejected { .. })
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
        ActionOutcome::Confirmed { .. } => {
            status
                .publish("sent", emotions, Some(thread_id), Some(&message), None)
                .await;
            DispatchResult::Latch
        }
        ActionOutcome::OutcomeUnknown { .. } => {
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
        ActionOutcome::Rejected { .. } => {
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

async fn wait_until_turn_stops(handle: &Handle, thread_id: &str, turn_id: &str) -> bool {
    for _ in 0..20 {
        let active = handle
            .snapshot()
            .await
            .threads
            .get(thread_id)
            .and_then(|thread| thread.active_turn_id.as_deref())
            == Some(turn_id);
        if !active {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}
