use crate::protocol::{EventEnvelope, InputUpdate, MAX_EVENT_BYTES, monotonic_ms};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::watch;

pub async fn consume(
    socket: PathBuf,
    freshness_ms: u64,
    sender: watch::Sender<InputUpdate>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut delay_ms = 50_u64;
    loop {
        if *shutdown.borrow() {
            return;
        }
        let connection = tokio::select! {
            result = UnixStream::connect(&socket) => result,
            result = shutdown.changed() => {
                let _ = result;
                return;
            }
        };
        match connection {
            Ok(stream) => {
                delay_ms = 50;
                sender.send_replace(InputUpdate::Reset);
                read_connection(stream, freshness_ms, &sender, &mut shutdown).await;
                println!(
                    "{}",
                    serde_json::json!({
                        "type": "worker_health",
                        "role": "interruption",
                        "ready": false,
                        "stream": "disconnected"
                    })
                );
            }
            Err(_) => {
                sender.send_replace(InputUpdate::Reset);
            }
        }
        let jitter = 90 + u64::from(std::process::id() % 21);
        tokio::select! {
            () = tokio::time::sleep(Duration::from_millis(delay_ms * jitter / 100)) => {}
            result = shutdown.changed() => {
                let _ = result;
                return;
            }
        }
        delay_ms = (delay_ms * 2).min(2_000);
    }
}

async fn read_connection(
    stream: UnixStream,
    freshness_ms: u64,
    sender: &watch::Sender<InputUpdate>,
    shutdown: &mut watch::Receiver<bool>,
) {
    let mut reader = BufReader::new(stream);
    let mut buffer = Vec::with_capacity(4096);
    let mut runtime_id: Option<String> = None;
    let mut sequence: Option<u64> = None;
    let mut reported_ready = false;
    loop {
        buffer.clear();
        let read = tokio::select! {
            result = tokio::time::timeout(
                Duration::from_millis(freshness_ms),
                reader.read_until(b'\n', &mut buffer),
            ) => result,
            result = shutdown.changed() => {
                let _ = result;
                return;
            }
        };
        let Ok(Ok(size)) = read else {
            sender.send_replace(InputUpdate::Reset);
            return;
        };
        if size == 0 || size > MAX_EVENT_BYTES || !buffer.ends_with(b"\n") {
            sender.send_replace(InputUpdate::Reset);
            return;
        }
        let Ok(event) = serde_json::from_slice::<EventEnvelope>(&buffer) else {
            continue;
        };
        if event.validate().is_err()
            || monotonic_ms().saturating_sub(event.published_at_ms) > freshness_ms
        {
            sender.send_replace(InputUpdate::Reset);
            continue;
        }
        let discontinuity = match (&runtime_id, sequence) {
            (Some(previous_runtime), Some(previous_sequence))
                if previous_runtime == &event.runtime_id =>
            {
                if event.sequence <= previous_sequence {
                    continue;
                }
                event.sequence != previous_sequence + 1
            }
            (Some(_), _) => true,
            _ => false,
        };
        runtime_id = Some(event.runtime_id.clone());
        sequence = Some(event.sequence);
        if !reported_ready {
            println!(
                "{}",
                serde_json::json!({
                    "type": "worker_health",
                    "role": "interruption",
                    "ready": true,
                    "stream": "fresh"
                })
            );
            reported_ready = true;
        }
        sender.send_replace(InputUpdate::Event {
            event,
            discontinuity,
        });
    }
}
