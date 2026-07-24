mod dispatch;
mod policy;
mod protocol;
mod status;
mod stream;

use codex_control::{CodexControl, Config, Handle};
use dispatch::{DispatchResult, dispatch};
use policy::{InterventionPolicy, emotion_message};
use protocol::InputUpdate;
use status::{SocketGuard, StatusPublisher};
use std::io;
use std::path::PathBuf;
use tokio::sync::watch;

#[derive(Clone, Debug)]
struct Cli {
    emotion_socket: PathBuf,
    status_socket: PathBuf,
    runtime_id: String,
    dry_run: bool,
    manage_gui: bool,
    threshold: f64,
    hold_ms: u64,
    cooldown_ms: u64,
    freshness_ms: u64,
    thread_id: Option<String>,
}

impl Cli {
    fn parse() -> Result<Self, String> {
        let mut args = std::env::args().skip(1);
        let mut cli = Self {
            emotion_socket: PathBuf::new(),
            status_socket: PathBuf::new(),
            runtime_id: String::new(),
            dry_run: false,
            manage_gui: true,
            threshold: 0.30,
            hold_ms: 1_000,
            cooldown_ms: 15_000,
            freshness_ms: 1_500,
            thread_id: None,
        };
        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--emotion-socket" => cli.emotion_socket = required_path(&argument, args.next())?,
                "--status-socket" => cli.status_socket = required_path(&argument, args.next())?,
                "--runtime-id" => cli.runtime_id = required(&argument, args.next())?,
                "--dry-run" => cli.dry_run = true,
                "--manage-gui" => cli.manage_gui = true,
                "--no-manage-gui" => cli.manage_gui = false,
                "--threshold" => {
                    cli.threshold = required(&argument, args.next())?
                        .parse()
                        .map_err(|_| "invalid threshold")?
                }
                "--hold-ms" => {
                    cli.hold_ms = required(&argument, args.next())?
                        .parse()
                        .map_err(|_| "invalid hold")?
                }
                "--cooldown-ms" => {
                    cli.cooldown_ms = required(&argument, args.next())?
                        .parse()
                        .map_err(|_| "invalid cooldown")?
                }
                "--freshness-ms" => {
                    cli.freshness_ms = required(&argument, args.next())?
                        .parse()
                        .map_err(|_| "invalid freshness")?
                }
                "--thread-id" => cli.thread_id = Some(required(&argument, args.next())?),
                other => return Err(format!("unknown argument {other:?}")),
            }
        }
        if cli.emotion_socket.as_os_str().is_empty()
            || cli.status_socket.as_os_str().is_empty()
            || cli.runtime_id.is_empty()
        {
            return Err("emotion socket, status socket, and runtime id are required".into());
        }
        if !(0.0..1.0).contains(&cli.threshold) || cli.hold_ms == 0 || cli.freshness_ms == 0 {
            return Err("invalid policy configuration".into());
        }
        Ok(cli)
    }
}

fn required(flag: &str, value: Option<String>) -> Result<String, String> {
    value.ok_or_else(|| format!("{flag} requires a value"))
}

fn required_path(flag: &str, value: Option<String>) -> Result<PathBuf, String> {
    required(flag, value).map(PathBuf::from)
}

fn control_config(manage_gui: bool) -> Config {
    let mut config = Config {
        manage_gui,
        ..Config::default()
    };
    config.supervisor.restart_gui_on_initialize = manage_gui;
    config.ingest.reconcile_page_size = 20;
    config.ingest.reconcile_page_bound = 1;
    config.ingest.reconcile_candidate_limit = 20;
    config
}

async fn run_engine(
    mut receiver: watch::Receiver<InputUpdate>,
    mut shutdown: watch::Receiver<bool>,
    cli: &Cli,
    status: &StatusPublisher,
    handle: Option<&Handle>,
) {
    let ready = if cli.dry_run {
        "dry_run_ready"
    } else {
        "ready"
    };
    status.publish(ready, &[], None, None, None).await;
    let mut policy = InterventionPolicy::new(cli.threshold, cli.hold_ms, cli.cooldown_ms);
    loop {
        tokio::select! {
            result = receiver.changed() => {
                if result.is_err() {
                    break;
                }
            }
            result = shutdown.changed() => {
                let _ = result;
                status.publish("stopping", &[], None, None, None).await;
                break;
            }
        }
        if *shutdown.borrow() {
            status.publish("stopping", &[], None, None, None).await;
            break;
        }
        let update = receiver.borrow_and_update().clone();
        let (event, discontinuity) = match update {
            InputUpdate::Reset => {
                policy.reset_temporal();
                continue;
            }
            InputUpdate::Event {
                event,
                discontinuity,
            } => (event, discontinuity),
        };
        if discontinuity {
            policy.reset_temporal();
        }
        if event.kind == "producer_state" {
            if event.producer_state() != Some("active") {
                policy.reset_temporal();
            }
            continue;
        }
        let Ok(scores) = event.scores() else {
            policy.reset_temporal();
            continue;
        };
        let Some(emotions) = policy.observe(&scores, event.captured_at_ms) else {
            continue;
        };
        if cli.dry_run {
            let message = emotion_message(&emotions);
            status
                .publish(
                    "would_send",
                    &emotions,
                    cli.thread_id.as_deref(),
                    Some(&message),
                    None,
                )
                .await;
            policy.mark_sent(&emotions, event.captured_at_ms);
            continue;
        }
        let dispatch_future = dispatch(
            handle.expect("live handle"),
            status,
            &emotions,
            cli.thread_id.as_deref(),
        );
        tokio::pin!(dispatch_future);
        let result = tokio::select! {
            result = &mut dispatch_future => result,
            changed = shutdown.changed() => {
                let _ = changed;
                status.publish("stopping", &[], None, None, None).await;
                match tokio::time::timeout(
                    std::time::Duration::from_secs(4),
                    dispatch_future,
                ).await {
                    Ok(result) => result,
                    Err(_) => {
                        status.publish(
                            "drain_timeout",
                            &emotions,
                            cli.thread_id.as_deref(),
                            None,
                            Some("Timed out while conservatively draining the active dispatch."),
                        ).await;
                        break;
                    }
                }
            }
        };
        match result {
            DispatchResult::Latch => policy.mark_sent(&emotions, event.captured_at_ms),
            DispatchResult::Snooze => policy.snooze(event.captured_at_ms),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse().map_err(io::Error::other)?;
    let status = StatusPublisher::bind(&cli.status_socket, cli.runtime_id.clone()).await?;
    let _status_guard = SocketGuard(cli.status_socket.clone());
    let (sender, receiver) = watch::channel(InputUpdate::Reset);
    let (shutdown_sender, shutdown_receiver) = watch::channel(false);
    let stream_task = tokio::spawn(stream::consume(
        cli.emotion_socket.clone(),
        cli.freshness_ms,
        sender,
        shutdown_receiver.clone(),
    ));
    let signal_sender = shutdown_sender.clone();
    let signal_task = tokio::spawn(async move {
        let interrupt = async {
            let _ = tokio::signal::ctrl_c().await;
        };
        #[cfg(unix)]
        let terminate = async {
            if let Ok(mut signal) =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            {
                signal.recv().await;
            }
        };
        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();
        tokio::select! {
            () = interrupt => {}
            () = terminate => {}
        }
        signal_sender.send_replace(true);
    });
    if cli.dry_run {
        run_engine(receiver, shutdown_receiver, &cli, &status, None).await;
        stream_task.abort();
        signal_task.abort();
        return Ok(());
    }
    status.publish("connecting", &[], None, None, None).await;
    let config = control_config(cli.manage_gui);
    let run_cli = cli.clone();
    let run_status = status.clone();
    let run_shutdown = shutdown_receiver;
    CodexControl::run(config, |handle| async move {
        run_engine(receiver, run_shutdown, &run_cli, &run_status, Some(&handle)).await;
    })
    .await?;
    shutdown_sender.send_replace(true);
    stream_task.abort();
    signal_task.abort();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gui_restart_is_startup_only() {
        let config = control_config(true);
        assert!(config.manage_gui);
        assert!(config.supervisor.restart_gui_on_initialize);
    }

    #[tokio::test]
    async fn dry_run_shutdown_prevents_new_actions() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let status =
            StatusPublisher::bind(&directory.path().join("status.sock"), "runtime".to_owned())
                .await
                .expect("status publisher");
        let (_input_sender, input_receiver) = watch::channel(InputUpdate::Reset);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let cli = Cli {
            emotion_socket: directory.path().join("emotion.sock"),
            status_socket: directory.path().join("status.sock"),
            runtime_id: "runtime".into(),
            dry_run: true,
            manage_gui: false,
            threshold: 0.30,
            hold_ms: 1_000,
            cooldown_ms: 15_000,
            freshness_ms: 1_500,
            thread_id: None,
        };
        shutdown_sender.send_replace(true);
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            run_engine(input_receiver, shutdown_receiver, &cli, &status, None),
        )
        .await
        .expect("engine should stop promptly");
    }
}
