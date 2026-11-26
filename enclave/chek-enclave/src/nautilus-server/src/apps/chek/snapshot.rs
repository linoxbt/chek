// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

//! `POST /snapshot` (spec section 12): the only way an entrant list reaches the chain.
//!
//! The request carries the campaign's on-chain values; the enclave trusts none of them for
//! anything but echoing back, because `commit_snapshot` rejects a payload whose fields differ from
//! the campaign. Rules are accepted only as canonical bytes, so their hash is the on-chain one.

use super::judge::{AnthropicJudge, Judge};
use super::suins::{NameService, SuiRpcNames};
use super::x::{XClient, XSource};
use super::{UpstreamError, LLM_MODEL_ID};
use crate::AppState;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use bytes::Bytes;
use chek_core::blake2b256;
use chek_core::filter::{finalize, is_linked, names_to_resolve, select, FilterContext, Verdict};
use chek_core::json::u64_string;
use chek_core::rules::{parse_canonical_rules, Mode};
use chek_core::snapshot::{build_snapshot, AiInfo, SnapshotFacts, SnapshotPayload};
use fastcrypto::ed25519::Ed25519KeyPair;
use fastcrypto::traits::{KeyPair, Signer, ToFromBytes};
use futures_util::future::join_all;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;
use tracing::info;

pub const AUTH_HEADER: &str = "x-chek-auth";
/// The enclave fetches only within 6 h after close (MD12)…
pub const FETCH_WINDOW_MS: u64 = 6 * 60 * 60 * 1000;
/// …and not before 30 s after close: X search's `end_time` must be at least 10 s in the past.
pub const SETTLE_MS: u64 = 30_000;
pub const CACHE_TTL: Duration = Duration::from_secs(60 * 60);
/// Concurrent LLM calls in Judged Draw.
pub const JUDGE_CONCURRENCY: usize = 8;
/// Concurrent SuiNS lookups.
pub const NAME_CONCURRENCY: usize = 8;
const X_EPOCH_MS: u64 = 1_288_834_974_657;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SnapshotRequest {
    pub campaign_id: String,
    #[serde(with = "u64_string")]
    pub post_id: u64,
    pub opened_at: u64,
    pub closes_at: u64,
    pub mode: u8,
    pub k: u16,
    pub max_entrants: u32,
    pub max_judged: u32,
    pub max_replies_read: u32,
    /// The canonical rules JSON, exactly as stored on Walrus.
    pub rules_json: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SnapshotResponse {
    /// Payload fields, IDs as strings and bytes as hex (packages/core `SnapshotPayload`).
    pub payload: Value,
    pub payload_bcs: String,
    /// Ed25519 over BCS(IntentMessage { intent: 1, timestamp_ms: fetched_at, payload }).
    pub signature: String,
    pub public_key: String,
    /// The exact bytes to upload to Walrus; `payload.snapshot_hash` is their Blake2b-256.
    pub snapshot_json: String,
    pub posts_read: u64,
    pub users_read: u64,
    pub llm_calls: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SnapshotError {
    BadRequest(String),
    Unauthorized,
    /// Outside the fetch window: too early or too late.
    Window(String),
    Upstream(String),
    Busy,
}

impl From<UpstreamError> for SnapshotError {
    fn from(e: UpstreamError) -> Self {
        SnapshotError::Upstream(e.0)
    }
}

impl IntoResponse for SnapshotError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            SnapshotError::BadRequest(m) => (StatusCode::BAD_REQUEST, m),
            SnapshotError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "missing or invalid X-Chek-Auth".into(),
            ),
            SnapshotError::Window(m) => (StatusCode::CONFLICT, m),
            SnapshotError::Upstream(m) => (StatusCode::BAD_GATEWAY, m),
            SnapshotError::Busy => (
                StatusCode::SERVICE_UNAVAILABLE,
                "a snapshot is already running".into(),
            ),
        };
        (status, Json(json!({ "error": msg }))).into_response()
    }
}

/// HMAC-SHA256 of the raw request body under the runner's shared key (MD14, AC22).
pub fn verify_hmac(key: &[u8], body: &[u8], header_hex: &str) -> bool {
    let Ok(tag) = hex::decode(header_hex.trim()) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&tag).is_ok()
}

fn parse_campaign_id(s: &str) -> Option<[u8; 32]> {
    let h = s.strip_prefix("0x")?;
    let mut out = [0u8; 32];
    (h.len() == 64).then_some(())?;
    hex::decode_to_slice(h.to_ascii_lowercase(), &mut out).ok()?;
    Some(out)
}

pub struct Deps<X, N, J> {
    pub x: X,
    pub names: N,
    pub judge: J,
}

/// The whole snapshot, from request to signed payload. `now_ms` is the enclave clock;
/// `request_counter` counts snapshots computed since the enclave started (shown on Verify).
pub async fn take_snapshot<X: XSource, N: NameService, J: Judge>(
    deps: &Deps<X, N, J>,
    kp: &Ed25519KeyPair,
    req: &SnapshotRequest,
    now_ms: u64,
    request_counter: u64,
) -> Result<SnapshotResponse, SnapshotError> {
    let bad = |m: &str| SnapshotError::BadRequest(m.to_owned());
    let campaign_id = parse_campaign_id(&req.campaign_id)
        .ok_or_else(|| bad("campaign_id must be 0x + 64 hex"))?;
    let (rules, rules_hash) = parse_canonical_rules(&req.rules_json)
        .map_err(|e| bad(&format!("rules_json: {}", e.join("; "))))?;
    let mode = match rules.mode {
        Mode::Draw => 0,
        Mode::Judged => 1,
    };
    if req.mode != mode {
        return Err(bad("mode does not match the rules"));
    }
    if !(1..=100).contains(&req.k)
        || !(1..=5_000).contains(&req.max_entrants)
        || !(1..=1_000).contains(&req.max_judged)
        || req.max_replies_read < req.max_entrants
        || req.max_replies_read > 20_000
    {
        return Err(bad("k or caps out of range"));
    }
    if req.opened_at != (req.post_id >> 22) + X_EPOCH_MS || req.opened_at >= req.closes_at {
        return Err(bad(
            "opened_at must be the post's creation time and before closes_at",
        ));
    }
    if now_ms < req.closes_at + SETTLE_MS {
        return Err(SnapshotError::Window(
            "too early: the giveaway has not closed".into(),
        ));
    }
    if now_ms > req.closes_at + FETCH_WINDOW_MS {
        return Err(SnapshotError::Window(
            "too late: more than 6 hours after close".into(),
        ));
    }

    // 1. The post and its conversation.
    let post = deps.x.post(req.post_id).await?;
    if post.post_id != req.post_id {
        return Err(SnapshotError::Upstream(
            "X returned a different post".into(),
        ));
    }
    let conv = deps
        .x
        .conversation(&post, req.opened_at, req.closes_at, req.max_replies_read)
        .await?;
    let linked = is_linked(
        &campaign_id,
        post.urls
            .iter()
            .chain(&conv.author_reply_urls)
            .map(String::as_str),
    );

    let ctx = FilterContext {
        post_id: req.post_id,
        post_author_id: post.author_id,
        opened_at_ms: req.opened_at,
        closes_at_ms: req.closes_at,
        max_entrants: req.max_entrants,
        max_judged: req.max_judged,
        max_replies_read: req.max_replies_read,
    };

    // 2. SuiNS names of replies that pass every other rule.
    let wanted: Vec<String> = names_to_resolve(&ctx, &rules, &conv.replies)
        .into_iter()
        .collect();
    let mut names = HashMap::new();
    for chunk in wanted.chunks(NAME_CONCURRENCY) {
        let found = join_all(chunk.iter().map(|n| deps.names.resolve(n))).await;
        for (n, r) in chunk.iter().zip(found) {
            names.insert(n.clone(), r?);
        }
    }

    // 3. Rules, then the judge (Judged Draw), then the caps.
    let sel = select(&ctx, &rules, &conv.replies, &names);
    let mut verdicts: HashMap<u64, Verdict> = HashMap::new();
    let mut llm_calls = 0u64;
    let ai = match (&rules.mode, &rules.rubric) {
        (Mode::Judged, Some(rubric)) => {
            let to_judge = sel.to_judge(&ctx);
            for chunk in to_judge.chunks(JUDGE_CONCURRENCY) {
                let results = join_all(chunk.iter().map(|e| {
                    let image = conv.media.get(&e.reply.reply_id).map(String::as_str);
                    deps.judge.judge(&rubric.prompt, &e.reply.text, image)
                }))
                .await;
                for (e, r) in chunk.iter().zip(results) {
                    verdicts.insert(e.reply.reply_id, r?);
                }
            }
            llm_calls = to_judge.len() as u64;
            Some(AiInfo {
                model: LLM_MODEL_ID.to_owned(),
                rubric_hash: blake2b256(rubric.prompt.as_bytes()),
                judged: to_judge.len() as u32,
            })
        }
        _ => None,
    };
    let outcome = finalize(&ctx, &rules, sel, &verdicts)
        .map_err(|e| SnapshotError::Upstream(e.to_string()))?;

    // 4. Document, root and signed payload.
    let built = build_snapshot(
        &SnapshotFacts {
            campaign_id,
            post_id: req.post_id,
            post_author_id: post.author_id,
            linked,
            fetched_at: now_ms,
            rules_hash,
            posts_read: conv.posts_read + 1,
            users_read: conv.users_read,
            ai,
        },
        &outcome,
    );
    let payload = SnapshotPayload {
        campaign_id,
        post_id: req.post_id,
        rules_hash: rules_hash.to_vec(),
        opened_at: req.opened_at,
        closes_at: req.closes_at,
        mode,
        k: req.k,
        max_entrants: req.max_entrants,
        max_judged: req.max_judged,
        max_replies_read: req.max_replies_read,
        fetched_at: now_ms,
        n: built.n,
        replies_seen: built.replies_seen,
        root: built.root.to_vec(),
        snapshot_hash: built.snapshot_hash.to_vec(),
        linked,
        post_author_id: post.author_id,
        request_counter,
    };
    let signature = kp.sign(&payload.signing_bytes());
    info!(
        "snapshot: replies_seen={} n={} linked={} llm_calls={llm_calls}",
        built.replies_seen, built.n, linked
    );
    Ok(SnapshotResponse {
        payload: payload.to_json(),
        payload_bcs: hex::encode(payload.bcs()),
        signature: hex::encode(signature.as_ref()),
        public_key: hex::encode(kp.public().as_bytes()),
        snapshot_json: built.document,
        posts_read: conv.posts_read + 1,
        users_read: conv.users_read,
        llm_calls,
    })
}

/// Per-enclave snapshot state: one snapshot at a time, a counter, and a 1-hour cache of results
/// keyed by request body, so a retried request doesn't spend X credit twice (R13).
pub struct SnapshotState {
    busy: Semaphore,
    counter: AtomicU64,
    cache: Mutex<HashMap<[u8; 32], (Instant, SnapshotResponse)>>,
}

impl Default for SnapshotState {
    fn default() -> Self {
        Self {
            busy: Semaphore::new(1),
            counter: AtomicU64::new(0),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl SnapshotState {
    fn cached(&self, key: &[u8; 32]) -> Option<SnapshotResponse> {
        let mut cache = self.cache.lock().expect("cache lock");
        cache.retain(|_, (at, _)| at.elapsed() < CACHE_TTL);
        cache.get(key).map(|(_, r)| r.clone())
    }

    fn store(&self, key: [u8; 32], r: &SnapshotResponse) {
        self.cache
            .lock()
            .expect("cache lock")
            .insert(key, (Instant::now(), r.clone()));
    }
}

pub async fn snapshot(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<SnapshotResponse>, SnapshotError> {
    let auth = headers
        .get(AUTH_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !verify_hmac(state.secrets.enclave_hmac_key.as_bytes(), &body, auth) {
        return Err(SnapshotError::Unauthorized);
    }
    let req: SnapshotRequest = serde_json::from_slice(&body)
        .map_err(|e| SnapshotError::BadRequest(format!("request: {e}")))?;
    let key = blake2b256(&body);
    if let Some(r) = state.snapshots.cached(&key) {
        return Ok(Json(r));
    }
    let _permit = state
        .snapshots
        .busy
        .try_acquire()
        .map_err(|_| SnapshotError::Busy)?;
    let counter = state.snapshots.counter.fetch_add(1, Ordering::SeqCst) + 1;
    let deps = Deps {
        x: XClient::new(state.secrets.x_bearer_token.clone()),
        names: SuiRpcNames::default(),
        judge: AnthropicJudge::new(state.secrets.anthropic_api_key.clone()),
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let r = take_snapshot(&deps, &state.eph_kp, &req, now_ms, counter).await?;
    state.snapshots.store(key, &r);
    Ok(Json(r))
}

#[cfg(test)]
mod tests {
    use super::super::x::{Conversation, PostInfo};
    use super::*;
    use chek_core::filter::{Author, Reply};
    use fastcrypto::ed25519::{Ed25519PrivateKey, Ed25519PublicKey, Ed25519Signature};
    use fastcrypto::traits::VerifyingKey;
    use std::sync::atomic::AtomicUsize;

    const DAY: u64 = 86_400_000;
    // A post ID whose snowflake time is a fixed instant.
    const POST: u64 = 1_994_000_000_000_000_000;
    fn opened() -> u64 {
        (POST >> 22) + X_EPOCH_MS
    }
    fn closes() -> u64 {
        opened() + DAY
    }
    const CAMPAIGN: &str = "0xc0ffee0000000000000000000000000000000000000000000000000000000000";
    fn addr(c: char) -> String {
        format!("0x{}", c.to_string().repeat(64))
    }

    struct MockX {
        replies: Vec<Reply>,
        fail: bool,
    }
    impl XSource for MockX {
        async fn post(&self, post_id: u64) -> Result<PostInfo, UpstreamError> {
            if self.fail {
                return Err(UpstreamError("X down".into()));
            }
            Ok(PostInfo {
                post_id,
                author_id: 10,
                created_at_ms: opened(),
                conversation_id: post_id,
                urls: vec![format!("https://chek.app/g/{CAMPAIGN}")],
            })
        }
        async fn conversation(
            &self,
            _: &PostInfo,
            _: u64,
            _: u64,
            _: u32,
        ) -> Result<Conversation, UpstreamError> {
            Ok(Conversation {
                replies: self.replies.clone(),
                author_reply_urls: vec![],
                media: [(POST + 3, "https://pbs.twimg.com/media/y.jpg".to_owned())].into(),
                posts_read: self.replies.len() as u64,
                users_read: 4,
            })
        }
    }

    struct MockNames {
        down: bool,
    }
    impl NameService for MockNames {
        async fn resolve(&self, name: &str) -> Result<Option<[u8; 32]>, UpstreamError> {
            if self.down {
                return Err(UpstreamError("node down".into()));
            }
            Ok((name == "yeti.sui").then_some([0xbb; 32]))
        }
    }

    /// Passes entries that mention a drawing; records how many calls it got.
    struct MockJudge {
        calls: AtomicUsize,
        down: bool,
    }
    impl Judge for MockJudge {
        async fn judge(
            &self,
            _: &str,
            text: &str,
            image: Option<&str>,
        ) -> Result<Verdict, UpstreamError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.down {
                return Err(UpstreamError("LLM down".into()));
            }
            let pass = text.contains("drawing") || image.is_some();
            Ok(Verdict {
                pass,
                reason: if pass {
                    "a yeti drawing".into()
                } else {
                    "no drawing".into()
                },
            })
        }
    }

    fn reply(id: u64, author: u64, text: &str) -> Reply {
        Reply {
            reply_id: POST + id,
            parent_id: Some(POST),
            created_at_ms: opened() + 1000,
            text: text.into(),
            has_media: false,
            author: Author {
                id: author,
                handle: format!("user{author}"),
                created_at_ms: opened() - 400 * DAY,
                followers: 100,
            },
        }
    }

    fn replies() -> Vec<Reply> {
        vec![
            reply(1, 21, &format!("#Yeti my drawing {}", addr('a'))),
            reply(2, 22, "#Yeti @yeti.sui"),
            reply(3, 23, &format!("#Yeti see image {}", addr('c'))),
            reply(4, 24, "#Yeti ghost.sui"),
            reply(5, 25, &format!("no tag {}", addr('d'))),
        ]
    }

    fn rules_json(judged: bool) -> String {
        let r = json!({
            "v": 1, "platform": "x", "mode": if judged { "judged" } else { "draw" }, "entry": "reply",
            "direct_replies_only": true, "min_account_age_days": 30, "min_followers": 10,
            "required_text": ["#Yeti"], "require_media": false, "exclude_author_ids": [],
            "exclude_post_author": true,
            "rubric": if judged { json!({"prompt": "Pass entries with a yeti drawing.", "model": LLM_MODEL_ID}) } else { Value::Null },
        });
        chek_core::canonicalize(&r).unwrap()
    }

    fn request(judged: bool) -> SnapshotRequest {
        SnapshotRequest {
            campaign_id: CAMPAIGN.into(),
            post_id: POST,
            opened_at: opened(),
            closes_at: closes(),
            mode: u8::from(judged),
            k: 3,
            max_entrants: 5000,
            max_judged: 1000,
            max_replies_read: 20000,
            rules_json: rules_json(judged),
        }
    }

    fn deps(down: (bool, bool, bool)) -> Deps<MockX, MockNames, MockJudge> {
        Deps {
            x: MockX {
                replies: replies(),
                fail: down.0,
            },
            names: MockNames { down: down.1 },
            judge: MockJudge {
                calls: AtomicUsize::new(0),
                down: down.2,
            },
        }
    }

    fn key() -> Ed25519KeyPair {
        Ed25519KeyPair::from(Ed25519PrivateKey::from_bytes(&[7u8; 32]).unwrap())
    }

    async fn run(
        req: &SnapshotRequest,
        d: &Deps<MockX, MockNames, MockJudge>,
    ) -> Result<SnapshotResponse, SnapshotError> {
        take_snapshot(d, &key(), req, closes() + 60_000, 3).await
    }

    #[tokio::test]
    async fn draw_snapshot_is_signed_and_hashes_its_document() {
        let r = run(&request(false), &deps((false, false, false)))
            .await
            .unwrap();
        let p = &r.payload;
        assert_eq!(p["n"], 3, "a, yeti.sui, c; ghost.sui unresolved; no tag");
        assert_eq!(p["replies_seen"], 5);
        assert_eq!(p["linked"], true);
        assert_eq!(p["request_counter"], "3");
        assert_eq!(
            p["snapshot_hash"],
            hex::encode(blake2b256(r.snapshot_json.as_bytes()))
        );
        let doc: Value = serde_json::from_str(&r.snapshot_json).unwrap();
        assert_eq!(doc["entrants"][1]["via"], "suins:yeti.sui");
        assert_eq!(doc["ai"], Value::Null);
        // The signature covers BCS(IntentMessage) and verifies under the reported key.
        let pk = Ed25519PublicKey::from_bytes(&hex::decode(&r.public_key).unwrap()).unwrap();
        let sig = Ed25519Signature::from_bytes(&hex::decode(&r.signature).unwrap()).unwrap();
        let mut msg = vec![1u8];
        msg.extend((closes() + 60_000).to_le_bytes());
        msg.extend(hex::decode(&r.payload_bcs).unwrap());
        assert!(pk.verify(&msg, &sig).is_ok());
        // No reply text in the document (MD10).
        for w in ["drawing", "image", "#Yeti", "tag"] {
            assert!(!r.snapshot_json.contains(w), "{w}");
        }
    }

    /// fixtures/snapshot-e2e.json: checked by packages/core (Verify-page checks in TypeScript).
    /// Regenerate with CHEK_WRITE_FIXTURES=1 cargo test --features chek.
    #[tokio::test]
    async fn judged_snapshot_matches_shared_fixture() {
        let d = deps((false, false, false));
        let r = run(&request(true), &d).await.unwrap();
        assert_eq!(
            d.judge.calls.load(Ordering::SeqCst),
            3,
            "only rule-passing entries are judged"
        );
        assert_eq!(r.llm_calls, 3);
        assert_eq!(
            r.payload["n"], 2,
            "a (drawing) and c (image) pass; yeti.sui fails the rubric"
        );
        let doc: Value = serde_json::from_str(&r.snapshot_json).unwrap();
        assert_eq!(doc["ai"]["judged"], 3);
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&json!({"request": request(true), "response": r}))
                .unwrap()
        );
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../fixtures/snapshot-e2e.json"
        );
        if std::env::var("CHEK_WRITE_FIXTURES").is_ok() {
            std::fs::write(path, &text).unwrap();
        }
        assert_eq!(std::fs::read_to_string(path).unwrap(), text);
    }

    #[tokio::test]
    async fn rejects_bad_requests_and_windows() {
        let d = deps((false, false, false));
        let (kp, req) = (key(), request(false));
        let at = |now: u64| take_snapshot(&d, &kp, &req, now, 1);
        assert!(matches!(
            at(closes() + SETTLE_MS - 1).await,
            Err(SnapshotError::Window(_))
        ));
        assert!(matches!(
            at(closes() + FETCH_WINDOW_MS + 1).await,
            Err(SnapshotError::Window(_))
        ));
        assert!(at(closes() + FETCH_WINDOW_MS).await.is_ok());

        let mut r = request(false);
        r.mode = 1;
        assert!(matches!(
            run(&r, &d).await,
            Err(SnapshotError::BadRequest(_))
        ));
        let mut r = request(false);
        r.rules_json = r.rules_json.replace(":", ": ");
        assert!(
            matches!(run(&r, &d).await, Err(SnapshotError::BadRequest(_))),
            "non-canonical rules"
        );
        let mut r = request(false);
        r.opened_at += 1;
        assert!(matches!(
            run(&r, &d).await,
            Err(SnapshotError::BadRequest(_))
        ));
        let mut r = request(false);
        r.campaign_id = "0x12".into();
        assert!(matches!(
            run(&r, &d).await,
            Err(SnapshotError::BadRequest(_))
        ));
        let mut r = request(false);
        r.max_replies_read = 10;
        r.max_entrants = 11;
        assert!(matches!(
            run(&r, &d).await,
            Err(SnapshotError::BadRequest(_))
        ));
    }

    #[tokio::test]
    async fn any_outage_fails_the_whole_snapshot() {
        for down in [
            (true, false, false),
            (false, true, false),
            (false, false, true),
        ] {
            let judged = down.2;
            assert!(
                matches!(
                    run(&request(judged), &deps(down)).await,
                    Err(SnapshotError::Upstream(_))
                ),
                "{down:?}"
            );
        }
        // A Draw never calls the judge, so a judge outage doesn't matter there.
        assert!(run(&request(false), &deps((false, false, true)))
            .await
            .is_ok());
    }

    #[test]
    fn hmac_is_checked_over_the_raw_body() {
        let key = b"runner-key";
        let body = br#"{"campaign_id":"0x00"}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(key).unwrap();
        mac.update(body);
        let tag = hex::encode(mac.finalize().into_bytes());
        assert!(verify_hmac(key, body, &tag));
        assert!(!verify_hmac(key, b"{}", &tag));
        assert!(!verify_hmac(b"other", body, &tag));
        assert!(!verify_hmac(key, body, ""));
        assert!(!verify_hmac(key, body, "zz"));
    }
}
