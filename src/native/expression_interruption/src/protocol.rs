use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SCHEMA_VERSION: u64 = 1;
pub const MAX_EVENT_BYTES: usize = 64 * 1024;

pub fn monotonic_ms() -> u64 {
    let value = nix::time::clock_gettime(nix::time::ClockId::CLOCK_MONOTONIC)
        .expect("CLOCK_MONOTONIC is available");
    value.tv_sec() as u64 * 1_000 + value.tv_nsec() as u64 / 1_000_000
}

#[derive(Clone, Debug, Deserialize)]
pub struct EventEnvelope {
    pub schema_version: u64,
    pub kind: String,
    pub runtime_id: String,
    pub sequence: u64,
    pub captured_at_ms: u64,
    pub published_at_ms: u64,
    pub payload: serde_json::Value,
}

impl EventEnvelope {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported schema version {}",
                self.schema_version
            ));
        }
        if !matches!(self.kind.as_str(), "reading" | "producer_state") {
            return Err(format!("unsupported event kind {:?}", self.kind));
        }
        if self.runtime_id.is_empty() {
            return Err("runtime_id is required".into());
        }
        if self.published_at_ms < self.captured_at_ms {
            return Err("published timestamp precedes capture".into());
        }
        Ok(())
    }

    pub fn scores(&self) -> Result<HashMap<String, f64>, String> {
        let value = self
            .payload
            .get("scores")
            .ok_or_else(|| "reading payload is missing scores".to_string())?;
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())
    }

    pub fn producer_state(&self) -> Option<&str> {
        self.payload
            .get("state")
            .and_then(serde_json::Value::as_str)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SelectedEmotion {
    pub name: String,
    pub score: f64,
    pub degree: &'static str,
}

#[derive(Clone, Debug)]
pub enum InputUpdate {
    Event {
        event: EventEnvelope,
        discontinuity: bool,
    },
    Reset,
}
