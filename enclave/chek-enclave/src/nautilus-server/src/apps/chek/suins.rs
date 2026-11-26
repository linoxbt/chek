// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

//! SuiNS name → address through the pinned Sui full node (assumption A4: the JSON-RPC method
//! `suix_resolveNameServiceAddress`; confirm against the node before Mainnet).

use super::{http_client, send_with_retry, UpstreamError, SUI_RPC};
use serde_json::{json, Value};
use std::future::Future;
use std::time::Duration;

pub trait NameService: Send + Sync {
    /// The address `name` points to, or None if it has none. Err only if the node can't answer.
    fn resolve(
        &self,
        name: &str,
    ) -> impl Future<Output = Result<Option<[u8; 32]>, UpstreamError>> + Send;
}

/// `0x`-prefixed hex of up to 32 bytes, left-padded (Sui accepts short addresses).
pub fn parse_address(s: &str) -> Option<[u8; 32]> {
    let h = s.strip_prefix("0x")?;
    if h.is_empty() || h.len() > 64 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 32];
    hex::decode_to_slice(format!("{h:0>64}"), &mut out).ok()?;
    Some(out)
}

pub fn request_body(name: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": 1, "method": "suix_resolveNameServiceAddress", "params": [name]})
}

pub fn parse_response(v: &Value) -> Result<Option<[u8; 32]>, String> {
    if let Some(e) = v.get("error") {
        return Err(format!("RPC error {e}"));
    }
    match v.get("result") {
        None => Err("RPC response has no result".into()),
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => parse_address(s)
            .map(Some)
            .ok_or_else(|| format!("bad address {s}")),
        Some(other) => Err(format!("unexpected result {other}")),
    }
}

pub struct SuiRpcNames {
    http: reqwest::Client,
}

impl Default for SuiRpcNames {
    fn default() -> Self {
        Self {
            http: http_client(Duration::from_secs(15)),
        }
    }
}

impl NameService for SuiRpcNames {
    async fn resolve(&self, name: &str) -> Result<Option<[u8; 32]>, UpstreamError> {
        let resp = send_with_retry("SuiNS lookup", || {
            self.http.post(SUI_RPC).json(&request_body(name))
        })
        .await?;
        let v: Value = resp
            .json()
            .await
            .map_err(|e| UpstreamError(format!("SuiNS lookup: {e}")))?;
        parse_response(&v).map_err(|e| UpstreamError(format!("SuiNS lookup: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses() {
        let a = parse_response(&json!({"result": "0x2"})).unwrap().unwrap();
        assert_eq!(a[31], 2);
        assert_eq!(parse_response(&json!({"result": null})).unwrap(), None);
        assert!(parse_response(&json!({"error": {"code": -32000}})).is_err());
        assert!(parse_response(&json!({"result": "nope"})).is_err());
        assert_eq!(request_body("yeti.sui")["params"][0], "yeti.sui");
    }
}
