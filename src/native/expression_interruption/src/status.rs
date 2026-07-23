use crate::protocol::{SCHEMA_VERSION, SelectedEmotion, monotonic_ms};
use anyhow::Context;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixListener;
use tokio::sync::{Mutex, watch};

#[derive(Clone)]
pub struct StatusPublisher {
    runtime_id: Arc<String>,
    sequence: Arc<Mutex<u64>>,
    sender: watch::Sender<Vec<u8>>,
}

impl StatusPublisher {
    pub async fn bind(path: &Path, runtime_id: String) -> anyhow::Result<Self> {
        if path.exists() {
            if tokio::net::UnixStream::connect(path).await.is_ok() {
                anyhow::bail!("status socket already has a live owner: {}", path.display());
            }
            std::fs::remove_file(path).context("remove abandoned status socket")?;
        }
        let listener = UnixListener::bind(path).context("bind interruption status socket")?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .context("set interruption status socket permissions")?;
        let (sender, _) = watch::channel(Vec::new());
        let publisher = Self {
            runtime_id: Arc::new(runtime_id),
            sequence: Arc::new(Mutex::new(0)),
            sender,
        };
        let server = publisher.clone();
        tokio::spawn(async move {
            server.accept(listener).await;
        });
        Ok(publisher)
    }

    async fn accept(self, listener: UnixListener) {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let mut receiver = self.sender.subscribe();
            tokio::spawn(async move {
                let current = receiver.borrow().clone();
                if !current.is_empty() && stream.write_all(&current).await.is_err() {
                    return;
                }
                while receiver.changed().await.is_ok() {
                    let value = receiver.borrow_and_update().clone();
                    if stream.write_all(&value).await.is_err() {
                        break;
                    }
                }
            });
        }
    }

    pub async fn publish(
        &self,
        state: &str,
        emotions: &[SelectedEmotion],
        thread_id: Option<&str>,
        message: Option<&str>,
        detail: Option<&str>,
    ) {
        let now_ms = monotonic_ms();
        let mut sequence = self.sequence.lock().await;
        let payload = json!({
            "schema_version": SCHEMA_VERSION,
            "kind": "interruption_status",
            "runtime_id": self.runtime_id.as_str(),
            "sequence": *sequence,
            "captured_at_ms": now_ms,
            "published_at_ms": now_ms,
            "payload": {
                "state": state,
                "emotions": emotions,
                "scores": emotions.iter().map(|item| (item.name.clone(), item.score)).collect::<std::collections::HashMap<_, _>>(),
                "thread_id": thread_id,
                "message": message,
                "detail": detail,
            }
        });
        *sequence += 1;
        if let Ok(mut data) = serde_json::to_vec(&payload) {
            data.push(b'\n');
            self.sender.send_replace(data);
        }
    }
}

pub struct SocketGuard(pub PathBuf);

impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
