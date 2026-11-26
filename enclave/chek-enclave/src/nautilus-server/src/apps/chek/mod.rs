// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

//! Chek enclave app. Phase 2 has one endpoint, `/spike`, which answers assumption A1 (and A10):
//! can this enclave reach the X API and the Anthropic API over TLS terminated inside it? The
//! result is signed with the enclave's attested key, so the go/no-go is itself verifiable.
//!
//! Nothing here logs or returns post text (MD10): only status codes, IDs and counts.

use crate::common::{to_signed_response, IntentMessage, ProcessedDataResponse};
use crate::{AppState, EnclaveError};
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tracing::info;

/// Intent scope of a signed spike report. Snapshots use 1; scopes never overlap.
pub const SPIKE_INTENT: u8 = 2;

/// Model pinned in the enclave build, and therefore in its PCRs (spec section 12).
pub const LLM_MODEL_ID: &str = "claude-opus-5-5";

const X_API: &str = "https://api.x.com";
const ANTHROPIC_API: &str = "https://api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2026-10-21";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Deserialize)]
pub struct SpikeRequest {
    /// A public X post ID to look up, as a decimal string.
    pub post_id: String,
}

/// 64-bit IDs as decimal strings in JSON (they exceed JavaScript's safe integers) and as plain
/// u64 in BCS, so the signed bytes match the Move and TypeScript layouts.
pub mod u64_string {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        if s.is_human_readable() {
            s.serialize_str(&v.to_string())
        } else {
            s.serialize_u64(*v)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        if d.is_human_readable() {
            String::deserialize(d)?.parse().map_err(D::Error::custom)
        } else {
            u64::deserialize(d)
        }
    }
}

/// The signed part of the result. BCS-serialised inside an IntentMessage, like a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpikeReport {
    #[serde(with = "u64_string")]
    pub post_id: u64,
    /// HTTP status of GET /2/tweets/{id}; 0 means the TLS connection itself failed.
    pub x_post_status: u16,
    #[serde(with = "u64_string")]
    pub post_author_id: u64,
    /// The post's conversation_id equals its own ID (true for a root post).
    pub conversation_is_post: bool,
    /// HTTP status of full-archive search on conversation_id (assumption A10).
    pub x_search_status: u16,
    pub x_search_results: u32,
    /// HTTP status of POST /v1/messages.
    pub anthropic_status: u16,
    pub anthropic_stop_reason: String,
    pub model: String,
}

/// Unsigned detail for the operator: timings and error summaries (never response bodies).
#[derive(Debug, Default, Serialize)]
pub struct SpikeDiagnostics {
    pub x_post_ms: u128,
    pub x_search_ms: u128,
    pub anthropic_ms: u128,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct SpikeResponse {
    #[serde(flatten)]
    pub signed: ProcessedDataResponse<IntentMessage<SpikeReport>>,
    pub diagnostics: SpikeDiagnostics,
}

pub fn parse_post_id(s: &str) -> Result<u64, EnclaveError> {
    let ok = !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
    ok.then(|| s.parse::<u64>().ok())
        .flatten()
        .ok_or_else(|| EnclaveError::GenericError("post_id must be a decimal u64".into()))
}

pub fn post_lookup_url(post_id: u64) -> String {
    format!("{X_API}/2/tweets/{post_id}?tweet.fields=author_id,created_at,conversation_id")
}

pub fn conversation_search_url(post_id: u64) -> String {
    format!(
        "{X_API}/2/tweets/search/all?query=conversation_id:{post_id}&max_results=10&tweet.fields=author_id,created_at"
    )
}

/// Smallest useful Messages API request. No sampling parameters: API version 2026-10-21 rejects
/// them, and so does the pinned model.
pub fn anthropic_ping_body() -> Value {
    json!({
        "model": LLM_MODEL_ID,
        "max_tokens": 256,
        "output_config": { "effort": "low" },
        "messages": [{ "role": "user", "content": "Reply with the single word OK." }],
    })
}

/// Reads a decimal-string ID field from an X API object.
fn id_field(v: &Value, key: &str) -> Option<u64> {
    v.get(key)?.as_str()?.parse().ok()
}

/// Summarises an X or Anthropic error body without copying anything but its error fields.
fn error_summary(body: &Value) -> String {
    let pick = |k: &str| body.get(k).and_then(Value::as_str).unwrap_or("");
    let nested = body.get("error").map(|e| e.to_string()).unwrap_or_default();
    format!("{} {} {}", pick("title"), pick("detail"), nested)
        .trim()
        .chars()
        .take(300)
        .collect()
}

async fn get_json(
    client: &reqwest::Client,
    url: &str,
    bearer: &str,
) -> Result<(u16, Value), String> {
    let resp = client
        .get(url)
        .bearer_auth(bearer)
        .send()
        .await
        .map_err(|e| format!("transport: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.json::<Value>().await.unwrap_or(Value::Null);
    Ok((status, body))
}

pub async fn spike(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SpikeRequest>,
) -> Result<Json<SpikeResponse>, EnclaveError> {
    let post_id = parse_post_id(&request.post_id)?;
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| EnclaveError::GenericError(format!("HTTP client: {e}")))?;
    let mut diag = SpikeDiagnostics::default();
    let mut report = SpikeReport {
        post_id,
        x_post_status: 0,
        post_author_id: 0,
        conversation_is_post: false,
        x_search_status: 0,
        x_search_results: 0,
        anthropic_status: 0,
        anthropic_stop_reason: String::new(),
        model: LLM_MODEL_ID.to_string(),
    };
    let bearer = &state.secrets.x_bearer_token;

    // 1. Post lookup: TLS to api.x.com and a billed Post read.
    let t = Instant::now();
    match get_json(&client, &post_lookup_url(post_id), bearer).await {
        Ok((status, body)) => {
            report.x_post_status = status;
            if let Some(data) = body.get("data") {
                report.post_author_id = id_field(data, "author_id").unwrap_or(0);
                report.conversation_is_post = id_field(data, "conversation_id") == Some(post_id);
            } else {
                diag.errors
                    .push(format!("x post {status}: {}", error_summary(&body)));
            }
        }
        Err(e) => diag.errors.push(format!("x post: {e}")),
    }
    diag.x_post_ms = t.elapsed().as_millis();

    // 2. Full-archive search on the conversation (A10: open to pay-per-use accounts?).
    let t = Instant::now();
    match get_json(&client, &conversation_search_url(post_id), bearer).await {
        Ok((status, body)) => {
            report.x_search_status = status;
            match body.pointer("/meta/result_count").and_then(Value::as_u64) {
                Some(n) => report.x_search_results = n as u32,
                None => diag
                    .errors
                    .push(format!("x search {status}: {}", error_summary(&body))),
            }
        }
        Err(e) => diag.errors.push(format!("x search: {e}")),
    }
    diag.x_search_ms = t.elapsed().as_millis();

    // 3. Anthropic Messages API.
    let t = Instant::now();
    let sent = client
        .post(format!("{ANTHROPIC_API}/v1/messages"))
        .header("x-api-key", &state.secrets.anthropic_api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&anthropic_ping_body())
        .send()
        .await;
    match sent {
        Ok(resp) => {
            report.anthropic_status = resp.status().as_u16();
            let body = resp.json::<Value>().await.unwrap_or(Value::Null);
            match body.get("stop_reason").and_then(Value::as_str) {
                Some(r) => report.anthropic_stop_reason = r.to_string(),
                None => diag.errors.push(format!(
                    "anthropic {}: {}",
                    report.anthropic_status,
                    error_summary(&body)
                )),
            }
        }
        Err(e) => diag.errors.push(format!("anthropic: transport: {e}")),
    }
    diag.anthropic_ms = t.elapsed().as_millis();

    info!(
        "spike: x_post={} x_search={} anthropic={}",
        report.x_post_status, report.x_search_status, report.anthropic_status
    );
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| EnclaveError::GenericError(format!("clock: {e}")))?
        .as_millis() as u64;
    Ok(Json(SpikeResponse {
        signed: to_signed_response(&state.eph_kp, report, now_ms, SPIKE_INTENT),
        diagnostics: diag,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_ids_are_decimal_u64() {
        assert_eq!(parse_post_id("20").ok(), Some(20));
        assert_eq!(parse_post_id("18446744073709551615").ok(), Some(u64::MAX));
        for bad in ["", "-1", "1e3", "0x14", "18446744073709551616", " 20"] {
            assert!(parse_post_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn urls_target_only_allowed_hosts() {
        let allow = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/apps/chek/allowed_endpoints.yaml"
        ))
        .unwrap();
        for url in [
            post_lookup_url(1),
            conversation_search_url(1),
            format!("{ANTHROPIC_API}/v1/messages"),
        ] {
            let host = url
                .trim_start_matches("https://")
                .split('/')
                .next()
                .unwrap();
            assert!(
                allow.lines().any(|l| l.trim() == format!("- {host}")),
                "{host} not allowed"
            );
        }
        assert!(conversation_search_url(42).contains("query=conversation_id:42"));
    }

    #[test]
    fn anthropic_body_has_no_sampling_parameters() {
        let body = anthropic_ping_body();
        assert_eq!(body["model"], LLM_MODEL_ID);
        for k in ["temperature", "top_p", "top_k"] {
            assert!(body.get(k).is_none());
        }
    }

    #[test]
    fn error_summary_keeps_only_error_fields() {
        let body = json!({"title": "Forbidden", "detail": "client-not-enrolled", "data": {"text": "secret post"}});
        let s = error_summary(&body);
        assert!(s.contains("client-not-enrolled") && !s.contains("secret post"));
    }

    fn fixture_report() -> SpikeReport {
        SpikeReport {
            post_id: 1_994_000_000_000_000_123,
            x_post_status: 200,
            post_author_id: 18_446_744_073_709_551_615,
            conversation_is_post: true,
            x_search_status: 200,
            x_search_results: 7,
            anthropic_status: 200,
            anthropic_stop_reason: "end_turn".into(),
            model: LLM_MODEL_ID.into(),
        }
    }

    /// fixtures/spike-response.json is checked by packages/core (TypeScript) as well. Regenerate
    /// with CHEK_WRITE_FIXTURES=1 cargo test --features chek.
    #[test]
    fn spike_response_matches_shared_fixture() {
        use fastcrypto::ed25519::{Ed25519KeyPair, Ed25519PrivateKey};
        use fastcrypto::encoding::{Encoding, Hex};
        use fastcrypto::traits::{KeyPair, ToFromBytes};
        let sk = Ed25519PrivateKey::from_bytes(&[7u8; 32]).unwrap();
        let kp = Ed25519KeyPair::from(sk);
        let signed = to_signed_response(&kp, fixture_report(), 1_764_800_600_000, SPIKE_INTENT);
        let value = json!({
            "public_key": Hex::encode(kp.public().as_bytes()),
            "response": serde_json::to_value(&signed).unwrap(),
            "signing_bytes": Hex::encode(bcs::to_bytes(&signed.response).unwrap()),
        });
        let text = format!("{}\n", serde_json::to_string_pretty(&value).unwrap());
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../fixtures/spike-response.json"
        );
        if std::env::var("CHEK_WRITE_FIXTURES").is_ok() {
            std::fs::write(path, &text).unwrap();
        }
        assert_eq!(std::fs::read_to_string(path).unwrap(), text);
        // IDs survive JSON as strings and round-trip.
        let back: SpikeReport =
            serde_json::from_value(value["response"]["response"]["data"].clone()).unwrap();
        assert_eq!(back, fixture_report());
    }

    #[test]
    fn report_is_signed_as_a_bcs_intent_message() {
        use fastcrypto::ed25519::{Ed25519KeyPair, Ed25519PublicKey, Ed25519Signature};
        use fastcrypto::encoding::{Encoding, Hex};
        use fastcrypto::traits::{KeyPair, ToFromBytes, VerifyingKey};
        let kp = Ed25519KeyPair::generate(&mut rand::thread_rng());
        let report = SpikeReport {
            post_id: 20,
            x_post_status: 200,
            post_author_id: 12,
            conversation_is_post: true,
            x_search_status: 200,
            x_search_results: 3,
            anthropic_status: 200,
            anthropic_stop_reason: "end_turn".into(),
            model: LLM_MODEL_ID.into(),
        };
        let signed = to_signed_response(&kp, report.clone(), 1_764_800_000_000, SPIKE_INTENT);
        let msg =
            bcs::to_bytes(&IntentMessage::new(report, 1_764_800_000_000, SPIKE_INTENT)).unwrap();
        assert_eq!(msg[0], SPIKE_INTENT);
        let sig = Ed25519Signature::from_bytes(&Hex::decode(&signed.signature).unwrap()).unwrap();
        let pk: &Ed25519PublicKey = kp.public();
        assert!(pk.verify(&msg, &sig).is_ok());
    }
}
