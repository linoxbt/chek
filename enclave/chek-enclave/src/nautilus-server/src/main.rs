// Copyright (c), Mysten Labs, Inc.
// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

use anyhow::Result;
use axum::{routing::get, routing::post, Router};
use fastcrypto::{ed25519::Ed25519KeyPair, traits::KeyPair};
use nautilus_server::app::spike;
use nautilus_server::common::{get_attestation, health_check};
use nautilus_server::{AppState, Secrets};
use std::sync::Arc;
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    let eph_kp = Ed25519KeyPair::generate(&mut rand::thread_rng());
    let secrets = Secrets::from_env()?;
    let state = Arc::new(AppState { eph_kp, secrets });

    // No CORS layer: only the runner, on the host's private network, calls this server.
    let app = Router::new()
        .route("/", get(ping))
        .route("/get_attestation", get(get_attestation))
        .route("/health_check", get(health_check))
        .route("/spike", post(spike))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    info!("listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app.into_make_service())
        .await
        .map_err(|e| anyhow::anyhow!("Server error: {e}"))
}

async fn ping() -> &'static str {
    "Pong!"
}
