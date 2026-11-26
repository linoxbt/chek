// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

//! The Chek enclave app.
//!
//! - `/snapshot` (Phase 3): reads a giveaway's replies from X, applies the published rules
//!   (`chek_core::filter`), resolves SuiNS names, runs the AI pass/fail check in Judged Draw, and
//!   returns the snapshot document with a payload signed by the attested key.
//! - `/spike` (Phase 2): the TLS go/no-go.
//!
//! Every value that changes what the enclave does is a constant here, so it is part of the
//! build and therefore of the PCRs: hosts, model, API version, prompt.

pub mod judge;
pub mod snapshot;
pub mod spike;
pub mod suins;
pub mod x;

pub use snapshot::{snapshot, SnapshotState};
pub use spike::spike;

use std::time::Duration;

/// Model pinned in the enclave build (spec section 12).
pub const LLM_MODEL_ID: &str = "claude-opus-5-5";
pub const X_API: &str = "https://api.x.com";
pub const ANTHROPIC_API: &str = "https://api.anthropic.com";
pub const ANTHROPIC_VERSION: &str = "2026-10-21";
/// Sui full node used for SuiNS lookups (Testnet build).
pub const SUI_RPC: &str = "https://fullnode.testnet.sui.io:443";

const ATTEMPTS: u32 = 5;
const BACKOFF_BASE: Duration = Duration::from_millis(500);

/// A failure of X, the LLM or the Sui node. The whole snapshot fails with HTTP 502 and the
/// runner retries inside the fetch window; no entry is ever failed because a service was down.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpstreamError(pub String);

impl std::fmt::Display for UpstreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn retryable(status: u16) -> bool {
    status == 429 || status == 529 || (500..600).contains(&status)
}

/// Sends a request, retrying transport errors, 429 and 5xx with exponential backoff
/// (0.5 s, 1 s, 2 s, 4 s). Returns the first response that is not retryable.
pub async fn send_with_retry(
    what: &str,
    build: impl Fn() -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, UpstreamError> {
    let mut last = String::new();
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(BACKOFF_BASE * 2u32.pow(attempt - 1)).await;
        }
        match build().send().await {
            Ok(resp) if retryable(resp.status().as_u16()) => {
                last = format!("HTTP {}", resp.status().as_u16())
            }
            Ok(resp) => return Ok(resp),
            Err(e) => last = format!("transport: {e}"),
        }
    }
    Err(UpstreamError(format!(
        "{what}: {last} after {ATTEMPTS} attempts"
    )))
}

pub fn http_client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .expect("reqwest client builds")
}
