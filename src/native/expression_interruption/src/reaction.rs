use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{Mutex, mpsc, oneshot, watch};

pub const REACTION_SCHEMA_VERSION: u64 = 1;
pub const MAX_REACTION_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_COPY_TEXT_BYTES: usize = 32 * 1024;
pub const MAX_SCREENSHOT_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReactionEvent {
    pub schema_version: u64,
    pub event_id: String,
    pub captured_at_ms: u64,
    pub source_application_name: String,
    pub source_bundle_id: String,
    pub reaction_emoji: String,
    pub reaction_label: String,
    pub copy_text: String,
    pub screenshot_path: PathBuf,
}

impl ReactionEvent {
    fn validate(&self, runtime_dir: &Path) -> Result<(), String> {
        if self.schema_version != REACTION_SCHEMA_VERSION {
            return Err("unsupported reaction schema version".into());
        }
        validate_text("event_id", &self.event_id, 128, false)?;
        if self.captured_at_ms == 0 {
            return Err("captured_at_ms must be positive".into());
        }
        validate_text(
            "source_application_name",
            &self.source_application_name,
            256,
            false,
        )?;
        validate_text("source_bundle_id", &self.source_bundle_id, 256, false)?;
        validate_text("reaction_emoji", &self.reaction_emoji, 32, false)?;
        validate_text("reaction_label", &self.reaction_label, 128, false)?;
        validate_text("copy_text", &self.copy_text, MAX_COPY_TEXT_BYTES, true)?;

        let metadata = fs::symlink_metadata(&self.screenshot_path)
            .map_err(|_| "screenshot is unavailable".to_string())?;
        if metadata.file_type().is_symlink()
            || !metadata.file_type().is_file()
            || metadata.file_type().is_socket()
        {
            return Err("screenshot must be a regular file".into());
        }
        if metadata.len() == 0 || metadata.len() > MAX_SCREENSHOT_BYTES {
            return Err("screenshot size is invalid".into());
        }
        let canonical_runtime = runtime_dir
            .canonicalize()
            .map_err(|_| "runtime directory is unavailable".to_string())?;
        let canonical_screenshot = self
            .screenshot_path
            .canonicalize()
            .map_err(|_| "screenshot is unavailable".to_string())?;
        if canonical_screenshot.parent() != Some(canonical_runtime.as_path()) {
            return Err("screenshot must be directly inside the runtime directory".into());
        }
        let header =
            fs::read(&canonical_screenshot).map_err(|_| "screenshot is unreadable".to_string())?;
        if !header.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("screenshot is not a PNG".into());
        }
        Ok(())
    }

    pub fn message(&self) -> String {
        format!(
            "The user explicitly reacted {} ({}) to this copied UI content from {}:\n\n{}",
            self.reaction_emoji, self.reaction_label, self.source_application_name, self.copy_text
        )
    }
}

fn validate_text(
    name: &str,
    value: &str,
    maximum_bytes: usize,
    allow_empty: bool,
) -> Result<(), String> {
    if (!allow_empty && value.trim().is_empty()) || value.len() > maximum_bytes {
        return Err(format!("{name} is invalid"));
    }
    if value.contains('\0') {
        return Err(format!("{name} contains a null byte"));
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct ReactionResult {
    pub schema_version: u64,
    pub event_id: String,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl ReactionResult {
    pub fn new(event_id: impl Into<String>, outcome: impl Into<String>) -> Self {
        Self {
            schema_version: REACTION_SCHEMA_VERSION,
            event_id: event_id.into(),
            outcome: outcome.into(),
            thread_id: None,
            detail: None,
        }
    }

    fn rejected(event_id: impl Into<String>, detail: impl Into<String>) -> Self {
        let mut result = Self::new(event_id, "rejected");
        result.detail = Some(detail.into());
        result
    }
}

pub struct ReactionRequest {
    pub event: ReactionEvent,
    pub result: oneshot::Sender<ReactionResult>,
}

pub async fn serve(
    path: PathBuf,
    enabled_file: Option<PathBuf>,
    sender: mpsc::Sender<ReactionRequest>,
    mut shutdown: watch::Receiver<bool>,
) -> anyhow::Result<()> {
    if path.exists() {
        if UnixStream::connect(&path).await.is_ok() {
            anyhow::bail!(
                "reaction socket already has a live owner: {}",
                path.display()
            );
        }
        fs::remove_file(&path).context("remove abandoned reaction socket")?;
    }
    let runtime_dir = path
        .parent()
        .context("reaction socket must have a runtime directory")?
        .to_path_buf();
    let listener = UnixListener::bind(&path).context("bind component reaction socket")?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .context("set component reaction socket permissions")?;
    println!(
        "{}",
        serde_json::json!({
            "type": "component_input",
            "ready": true,
            "socket": path,
        })
    );
    let in_flight = Arc::new(Mutex::new(HashSet::<String>::new()));
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted.context("accept component reaction")?;
                let client_sender = sender.clone();
                let client_runtime = runtime_dir.clone();
                let client_ids = in_flight.clone();
                let client_enabled_file = enabled_file.clone();
                tokio::spawn(async move {
                    handle_client(
                        stream,
                        client_runtime,
                        client_enabled_file,
                        client_sender,
                        client_ids,
                    )
                    .await;
                });
            }
            changed = shutdown.changed() => {
                let _ = changed;
                break;
            }
        }
        if *shutdown.borrow() {
            break;
        }
    }
    let _ = fs::remove_file(path);
    Ok(())
}

async fn handle_client(
    stream: UnixStream,
    runtime_dir: PathBuf,
    enabled_file: Option<PathBuf>,
    sender: mpsc::Sender<ReactionRequest>,
    in_flight: Arc<Mutex<HashSet<String>>>,
) {
    let (reader, mut writer) = stream.into_split();
    let reader = BufReader::new(reader);
    let mut frame = Vec::with_capacity(4096);
    let read = reader
        .take((MAX_REACTION_FRAME_BYTES + 1) as u64)
        .read_until(b'\n', &mut frame)
        .await;
    if !matches!(read, Ok(size) if size > 0 && size <= MAX_REACTION_FRAME_BYTES && frame.ends_with(b"\n"))
    {
        write_result(
            &mut writer,
            ReactionResult::rejected("unknown", "invalid or oversized reaction frame"),
        )
        .await;
        return;
    }
    let event = match serde_json::from_slice::<ReactionEvent>(&frame) {
        Ok(event) => event,
        Err(_) => {
            write_result(
                &mut writer,
                ReactionResult::rejected("unknown", "invalid reaction message"),
            )
            .await;
            return;
        }
    };
    if !acceptance_enabled(enabled_file.as_deref()) {
        write_result(
            &mut writer,
            ReactionResult::rejected(event.event_id, "component input is disabled"),
        )
        .await;
        return;
    }
    if let Err(detail) = event.validate(&runtime_dir) {
        write_result(
            &mut writer,
            ReactionResult::rejected(event.event_id, detail),
        )
        .await;
        return;
    }
    {
        let mut ids = in_flight.lock().await;
        if !ids.insert(event.event_id.clone()) {
            write_result(
                &mut writer,
                ReactionResult::rejected(event.event_id, "duplicate in-flight event id"),
            )
            .await;
            return;
        }
    }
    let event_id = event.event_id.clone();
    if !acceptance_enabled(enabled_file.as_deref()) {
        in_flight.lock().await.remove(&event_id);
        write_result(
            &mut writer,
            ReactionResult::rejected(event_id, "component input is disabled"),
        )
        .await;
        return;
    }
    let (result_sender, result_receiver) = oneshot::channel();
    if sender
        .send(ReactionRequest {
            event,
            result: result_sender,
        })
        .await
        .is_err()
    {
        in_flight.lock().await.remove(&event_id);
        write_result(
            &mut writer,
            ReactionResult::rejected(event_id, "reaction input is stopping"),
        )
        .await;
        return;
    }
    let result = result_receiver.await.unwrap_or_else(|_| {
        ReactionResult::rejected(event_id.clone(), "reaction delivery was interrupted")
    });
    in_flight.lock().await.remove(&event_id);
    write_result(&mut writer, result).await;
}

fn acceptance_enabled(enabled_file: Option<&Path>) -> bool {
    let Some(path) = enabled_file else {
        return true;
    };
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

async fn write_result(writer: &mut tokio::net::unix::OwnedWriteHalf, result: ReactionResult) {
    if let Ok(mut encoded) = serde_json::to_vec(&result) {
        encoded.push(b'\n');
        let _ = writer.write_all(&encoded).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tokio::time::{Duration, timeout};

    fn event(path: PathBuf) -> ReactionEvent {
        ReactionEvent {
            schema_version: 1,
            event_id: "event-1".into(),
            captured_at_ms: 1,
            source_application_name: "Fixture".into(),
            source_bundle_id: "com.example.fixture".into(),
            reaction_emoji: "🎯".into(),
            reaction_label: "Target".into(),
            copy_text: "Submit".into(),
            screenshot_path: path,
        }
    }

    #[test]
    fn validates_confined_png_and_builds_minimal_message() {
        let directory = tempfile::tempdir().unwrap();
        let screenshot = directory.path().join("event.png");
        fs::write(&screenshot, b"\x89PNG\r\n\x1a\nfixture").unwrap();
        let reaction = event(screenshot);
        reaction.validate(directory.path()).unwrap();
        let message = reaction.message();
        assert!(message.contains("explicitly reacted"));
        assert!(message.contains("Submit"));
        assert!(!message.contains("HTML"));
    }

    #[test]
    fn rejects_path_escape_and_non_png() {
        let directory = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let escaped = other.path().join("event.png");
        fs::write(&escaped, b"\x89PNG\r\n\x1a\nfixture").unwrap();
        assert!(event(escaped).validate(directory.path()).is_err());
        let invalid = directory.path().join("event.png");
        fs::write(&invalid, b"not-png").unwrap();
        assert!(event(invalid).validate(directory.path()).is_err());
    }

    #[test]
    fn optional_acceptance_marker_disables_new_events_without_restarting() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let marker = directory.path().join("component-reactions.enabled");
        assert!(acceptance_enabled(None));
        assert!(!acceptance_enabled(Some(&marker)));
        fs::write(&marker, b"1\n").expect("write marker");
        assert!(acceptance_enabled(Some(&marker)));

        #[cfg(unix)]
        {
            let symlink = directory.path().join("marker-link");
            std::os::unix::fs::symlink(&marker, &symlink).expect("create marker symlink");
            assert!(!acceptance_enabled(Some(&symlink)));
        }
    }

    #[tokio::test]
    async fn socket_protocol_is_bounded_private_and_rejects_duplicate_in_flight_ids() {
        let directory = tempfile::tempdir().expect("temporary directory");
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))
            .expect("secure runtime directory");
        let screenshot = directory.path().join("event.png");
        fs::write(&screenshot, b"\x89PNG\r\n\x1a\nfixture").expect("fixture PNG");
        let socket = directory.path().join("component-reactions.sock");
        let (request_sender, mut request_receiver) = mpsc::channel(4);
        let (shutdown_sender, shutdown_receiver) = watch::channel(false);
        let server_socket = socket.clone();
        let server = tokio::spawn(async move {
            serve(server_socket, None, request_sender, shutdown_receiver).await
        });
        timeout(Duration::from_secs(1), async {
            while !socket.exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("reaction socket startup");
        assert_eq!(
            fs::symlink_metadata(&socket)
                .expect("socket metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let mut malformed = UnixStream::connect(&socket)
            .await
            .expect("malformed connection");
        malformed.write_all(b"{}\n").await.expect("write malformed");
        assert_eq!(
            read_socket_result(malformed).await["outcome"],
            Value::String("rejected".into())
        );

        let mut oversized = UnixStream::connect(&socket)
            .await
            .expect("oversized connection");
        let mut oversized_frame = vec![b'x'; MAX_REACTION_FRAME_BYTES + 1];
        oversized_frame.push(b'\n');
        oversized
            .write_all(&oversized_frame)
            .await
            .expect("write oversized");
        assert_eq!(
            read_socket_result(oversized).await["event_id"],
            Value::String("unknown".into())
        );

        drop(
            UnixStream::connect(&socket)
                .await
                .expect("disconnect connection"),
        );
        let encoded = serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "event_id": "duplicate",
            "captured_at_ms": 1,
            "source_application_name": "Fixture",
            "source_bundle_id": "com.example.fixture",
            "reaction_emoji": "🎯",
            "reaction_label": "Target",
            "copy_text": "Submit",
            "screenshot_path": screenshot,
        }))
        .expect("encode event");
        let mut first = UnixStream::connect(&socket)
            .await
            .expect("first connection");
        first.write_all(&encoded).await.expect("write first event");
        first.write_all(b"\n").await.expect("terminate first event");
        let request = timeout(Duration::from_secs(1), request_receiver.recv())
            .await
            .expect("request timeout")
            .expect("request");

        let mut duplicate = UnixStream::connect(&socket)
            .await
            .expect("duplicate connection");
        duplicate
            .write_all(&encoded)
            .await
            .expect("write duplicate event");
        duplicate
            .write_all(b"\n")
            .await
            .expect("terminate duplicate event");
        let duplicate_result = read_socket_result(duplicate).await;
        assert_eq!(duplicate_result["outcome"], "rejected");
        assert_eq!(duplicate_result["event_id"], "duplicate");

        request
            .result
            .send(ReactionResult::new("duplicate", "sent"))
            .expect("return first result");
        assert_eq!(read_socket_result(first).await["outcome"], "sent");

        shutdown_sender.send_replace(true);
        timeout(Duration::from_secs(1), server)
            .await
            .expect("server shutdown timeout")
            .expect("server join")
            .expect("server result");
    }

    async fn read_socket_result(stream: UnixStream) -> Value {
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        timeout(Duration::from_secs(1), reader.read_line(&mut line))
            .await
            .expect("result timeout")
            .expect("read result");
        serde_json::from_str(&line).expect("result JSON")
    }
}
