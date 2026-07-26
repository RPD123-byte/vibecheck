use codex_control::{ActionOutcome, CodexControl, Config, Handle};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, Read};
use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
enum ActiveSelection {
    None,
    One { thread_id: String, turn_id: String },
    Multiple(usize),
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ReactionContext {
    message: String,
    screenshot_path: Option<String>,
}

impl ReactionContext {
    fn user_input(&self) -> Vec<Value> {
        let mut input = vec![json!({
            "type": "text",
            "text": self.message,
        })];
        if let Some(path) = self.screenshot_path.as_deref() {
            input.push(json!({
                "type": "localImage",
                "path": path,
                "detail": "original",
            }));
        }
        input
    }
}

fn select_active_turn(active: Vec<(String, String)>) -> ActiveSelection {
    match active.len() {
        0 => ActiveSelection::None,
        1 => {
            let (thread_id, turn_id) = active.into_iter().next().expect("one active turn");
            ActiveSelection::One { thread_id, turn_id }
        }
        count => ActiveSelection::Multiple(count),
    }
}

async fn current_selection(handle: &Handle) -> ActiveSelection {
    let active = handle
        .snapshot()
        .await
        .threads
        .into_iter()
        .filter_map(|(thread_id, thread)| thread.active_turn_id.map(|turn_id| (thread_id, turn_id)))
        .collect();
    select_active_turn(active)
}

async fn wait_until_turn_stops(handle: &Handle, thread_id: &str, turn_id: &str) -> bool {
    for _ in 0..20 {
        let still_active = handle
            .snapshot()
            .await
            .threads
            .get(thread_id)
            .and_then(|thread| thread.active_turn_id.as_deref())
            == Some(turn_id);
        if !still_active {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    false
}

async fn inspect(handle: &Handle) -> Value {
    match current_selection(handle).await {
        ActiveSelection::None => json!({
            "status": "inspect",
            "activeTurnCount": 0,
        }),
        ActiveSelection::One { thread_id, turn_id } => json!({
            "status": "inspect",
            "activeTurnCount": 1,
            "threadId": thread_id,
            "turnId": turn_id,
        }),
        ActiveSelection::Multiple(count) => json!({
            "status": "inspect",
            "activeTurnCount": count,
        }),
    }
}

async fn deliver(handle: &Handle, context: ReactionContext) -> Value {
    let (thread_id, turn_id) = match current_selection(handle).await {
        ActiveSelection::None => {
            return json!({
                "status": "no_active_turn",
                "activeTurnCount": 0,
            });
        }
        ActiveSelection::Multiple(count) => {
            return json!({
                "status": "multiple_active_turns",
                "activeTurnCount": count,
            });
        }
        ActiveSelection::One { thread_id, turn_id } => (thread_id, turn_id),
    };

    let interrupt = handle.interrupt(&thread_id, &turn_id).await;
    if matches!(interrupt, ActionOutcome::Rejected { .. })
        || !wait_until_turn_stops(handle, &thread_id, &turn_id).await
    {
        return json!({
            "status": "interrupt_failed",
            "threadId": thread_id,
            "turnId": turn_id,
        });
    }

    let outcome = handle.start(&thread_id, context.user_input()).await;
    match outcome {
        ActionOutcome::Confirmed { .. } => json!({
            "status": "sent",
            "threadId": thread_id,
            "interruptedTurnId": turn_id,
        }),
        ActionOutcome::OutcomeUnknown { .. } => json!({
            "status": "sent_outcome_unknown",
            "threadId": thread_id,
            "interruptedTurnId": turn_id,
        }),
        ActionOutcome::Rejected { .. } => json!({
            "status": "restart_failed",
            "threadId": thread_id,
            "interruptedTurnId": turn_id,
        }),
    }
}

fn control_config() -> Config {
    let mut config = Config {
        manage_gui: false,
        ..Config::default()
    };
    config.supervisor.restart_gui_on_initialize = false;
    config.ingest.reconcile_page_size = 20;
    config.ingest.reconcile_page_bound = 1;
    config.ingest.reconcile_candidate_limit = 20;
    config
}

fn read_context() -> io::Result<ReactionContext> {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input)?;
    let input = input.trim();
    if let Ok(context) = serde_json::from_str::<ReactionContext>(input) {
        return Ok(context);
    }
    Ok(ReactionContext {
        message: input.to_owned(),
        screenshot_path: None,
    })
}

#[tokio::main]
async fn main() {
    let inspect_only = std::env::args()
        .skip(1)
        .any(|argument| argument == "--inspect");
    let dry_run = std::env::args()
        .skip(1)
        .any(|argument| argument == "--dry-run");
    if inspect_only && dry_run {
        eprintln!("--inspect and --dry-run cannot be combined");
        std::process::exit(2);
    }

    let context = if inspect_only {
        ReactionContext {
            message: String::new(),
            screenshot_path: None,
        }
    } else {
        match read_context() {
            Ok(context) if !context.message.is_empty() => context,
            Ok(_) => {
                eprintln!("context message is empty");
                std::process::exit(2);
            }
            Err(error) => {
                eprintln!("could not read context: {error}");
                std::process::exit(2);
            }
        }
    };
    if dry_run {
        println!(
            "{}",
            json!({
                "status": "dry_run",
                "messageLength": context.message.len(),
                "message": context.message,
                "screenshotPath": context.screenshot_path,
            })
        );
        return;
    }

    let result = CodexControl::run(control_config(), move |handle| async move {
        if inspect_only {
            inspect(&handle).await
        } else {
            deliver(&handle, context).await
        }
    })
    .await;
    match result {
        Ok(result) => println!("{result}"),
        Err(error) => println!(
            "{}",
            json!({
                "status": "codex_unavailable",
                "error": error.to_string(),
            })
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use transport::{
        TransportConfig,
        mock::{Fault, MockAppServer, MockThread},
    };

    fn mock_config(socket_path: PathBuf) -> Config {
        Config {
            manage_gui: false,
            transport: TransportConfig {
                socket_path,
                connect_timeout: Duration::from_millis(300),
                request_timeout: Duration::from_secs(1),
                retry_initial: Duration::from_millis(20),
                retry_max: Duration::from_millis(50),
                ..TransportConfig::default()
            },
            ..Config::default()
        }
    }

    #[test]
    fn active_turn_selection_is_conservative() {
        assert_eq!(select_active_turn(vec![]), ActiveSelection::None);
        assert_eq!(
            select_active_turn(vec![("thread".into(), "turn".into())]),
            ActiveSelection::One {
                thread_id: "thread".into(),
                turn_id: "turn".into(),
            }
        );
        assert_eq!(
            select_active_turn(vec![
                ("thread-a".into(), "turn-a".into()),
                ("thread-b".into(), "turn-b".into()),
            ]),
            ActiveSelection::Multiple(2)
        );
    }

    #[tokio::test]
    async fn no_active_turn_is_reported_without_a_codex_action() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let socket = directory.path().join("rpc.sock");
        let server = MockAppServer::start(socket.clone())
            .await
            .expect("mock app server");
        let result = CodexControl::run(mock_config(socket), |handle| async move {
            deliver(
                &handle,
                ReactionContext {
                    message: "context".into(),
                    screenshot_path: None,
                },
            )
            .await
        })
        .await
        .expect("Codex control run");
        assert_eq!(result["status"], "no_active_turn");
        assert!(server.received().await.iter().all(|request| !matches!(
            request["method"].as_str(),
            Some("turn/interrupt" | "turn/start")
        )));
        server.shutdown().await;
    }

    #[tokio::test]
    async fn exactly_one_active_turn_is_interrupted_and_restarted_with_context() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let socket = directory.path().join("rpc.sock");
        let server = MockAppServer::start(socket.clone())
            .await
            .expect("mock app server");
        server
            .add_thread(MockThread {
                id: "thread".into(),
                status: "active".into(),
                turn_id: Some("turn".into()),
                ephemeral: false,
                updated_at: 1,
            })
            .await;
        server
            .set_fault(Fault::InterruptCompletionBeforeResponse)
            .await;
        let result = CodexControl::run(mock_config(socket), |handle| async move {
            deliver(
                &handle,
                ReactionContext {
                    message: "component plus reaction".into(),
                    screenshot_path: Some("/tmp/selected-component.png".into()),
                },
            )
            .await
        })
        .await
        .expect("Codex control run");
        assert_eq!(result["status"], "sent");
        let received = server.received().await;
        assert!(received.iter().any(|request| {
            request["method"] == "turn/interrupt"
                && request["params"]["threadId"] == "thread"
                && request["params"]["turnId"] == "turn"
        }));
        assert!(received.iter().any(|request| {
            request["method"] == "turn/start"
                && request["params"]["threadId"] == "thread"
                && request["params"]["input"][0]["text"] == "component plus reaction"
                && request["params"]["input"][1]["type"] == "localImage"
                && request["params"]["input"][1]["path"] == "/tmp/selected-component.png"
                && request["params"]["input"][1]["detail"] == "original"
        }));
        server.shutdown().await;
    }
}
