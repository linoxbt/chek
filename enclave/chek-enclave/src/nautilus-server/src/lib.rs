// Copyright (c), Mysten Labs, Inc.
// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::Response;
use axum::Json;
use fastcrypto::ed25519::Ed25519KeyPair;
use serde::Deserialize;
use serde_json::json;
use std::fmt;

mod apps {
    #[cfg(feature = "chek")]
    #[path = "chek/mod.rs"]
    pub mod chek;
}

pub mod app {
    #[cfg(feature = "chek")]
    pub use crate::apps::chek::*;
}

pub mod common;

/// Secrets delivered once at boot from AWS Secrets Manager through `secrets.json`
/// (`expose_enclave.sh` → VSOCK 7777 → `run.sh` → environment). The one secret is a JSON object
/// so a single Secrets Manager entry carries all of them.
#[derive(Deserialize)]
pub struct Secrets {
    #[serde(rename = "X_BEARER_TOKEN")]
    pub x_bearer_token: String,
    #[serde(rename = "ANTHROPIC_API_KEY")]
    pub anthropic_api_key: String,
}

impl Secrets {
    /// Environment variable holding the secrets JSON. Set `API_ENV_VAR_NAME=CHEK_SECRETS` when
    /// running configure_enclave.sh.
    pub const ENV_VAR: &'static str = "CHEK_SECRETS";

    pub fn from_env() -> anyhow::Result<Self> {
        let raw = std::env::var(Self::ENV_VAR)
            .map_err(|_| anyhow::anyhow!("{} must be set", Self::ENV_VAR))?;
        serde_json::from_str(&raw)
            .map_err(|e| anyhow::anyhow!("{} is not the expected JSON object: {e}", Self::ENV_VAR))
    }
}

/// App state: the ephemeral key generated at boot (its public key is in the attestation) and
/// the API secrets.
pub struct AppState {
    pub eph_kp: Ed25519KeyPair,
    pub secrets: Secrets,
}

impl IntoResponse for EnclaveError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            EnclaveError::GenericError(e) => (StatusCode::BAD_REQUEST, e),
        };
        let body = Json(json!({
            "error": error_message,
        }));
        (status, body).into_response()
    }
}

#[derive(Debug)]
pub enum EnclaveError {
    GenericError(String),
}

impl fmt::Display for EnclaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EnclaveError::GenericError(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for EnclaveError {}
