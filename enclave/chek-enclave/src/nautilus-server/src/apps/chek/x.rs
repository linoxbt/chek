// Copyright (c) 2026 Chek contributors
// SPDX-License-Identifier: Apache-2.0

//! X API v2 client: the giveaway post and every reply in its conversation, read oldest first in
//! time slices so the read cap keeps the earliest replies. Only IDs, timestamps, author facts,
//! media presence, URLs and (for the filter and the judge, never the output) text are kept.

use super::{http_client, send_with_retry, UpstreamError, X_API};
use chek_core::filter::{Author, Reply};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::time::Duration;

/// Search is read in slices of this length, oldest first.
pub const SLICE_MS: u64 = 6 * 60 * 60 * 1000;
const PAGE_SIZE: u32 = 500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PostInfo {
    pub post_id: u64,
    pub author_id: u64,
    pub created_at_ms: u64,
    pub conversation_id: u64,
    /// `entities.urls[].expanded_url` of the post.
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Conversation {
    pub replies: Vec<Reply>,
    /// Expanded URLs in the post author's own replies made before close (post linkage).
    pub author_reply_urls: Vec<String>,
    /// First image of each reply that has one, for the judge.
    pub media: HashMap<u64, String>,
    /// Billable resources returned, for the snapshot's cost record (NFR3).
    pub posts_read: u64,
    pub users_read: u64,
}

pub trait XSource: Send + Sync {
    fn post(&self, post_id: u64) -> impl Future<Output = Result<PostInfo, UpstreamError>> + Send;
    /// Replies in `post`'s conversation created in [start_ms, end_ms], stopping after the slice
    /// in which `cap` replies have been collected.
    fn conversation(
        &self,
        post: &PostInfo,
        start_ms: u64,
        end_ms: u64,
        cap: u32,
    ) -> impl Future<Output = Result<Conversation, UpstreamError>> + Send;
}

// === Time ===

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (i64::from(m) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `2026-11-26T12:34:56Z`, truncated to the second (the precision X search takes).
pub fn iso_seconds(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (y, mo, d) = civil_from_days(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}Z",
        s / 3600,
        s % 3600 / 60,
        s % 60
    )
}

/// Parses X's `created_at` (`2026-11-26T12:34:56.000Z`) into milliseconds.
pub fn parse_iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<u32>().ok();
    let (y, mo, d, h, mi, se) = (
        num(0..4)?,
        num(5..7)?,
        num(8..10)?,
        num(11..13)?,
        num(14..16)?,
        num(17..19)?,
    );
    let rest = &s[19..];
    let (frac, tail) = match rest.strip_prefix('.') {
        Some(r) => {
            let digits: String = r.chars().take_while(char::is_ascii_digit).collect();
            let ms = format!("{digits:0<3}")[..3].parse::<u64>().ok()?;
            (ms, &r[digits.len()..])
        }
        None => (0, rest),
    };
    if tail != "Z"
        || !(1..=12).contains(&mo)
        || !(1..=31).contains(&d)
        || h > 23
        || mi > 59
        || se > 60
    {
        return None;
    }
    let days = days_from_civil(i64::from(y), mo, d);
    let secs = days * 86_400 + i64::from(h * 3600 + mi * 60 + se);
    u64::try_from(secs).ok().map(|s| s * 1000 + frac)
}

// === Parsing ===

/// X returns text with `&`, `<` and `>` HTML-escaped.
pub fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn id(v: &Value, key: &str) -> Option<u64> {
    v.get(key)?.as_str()?.parse().ok()
}

fn expanded_urls(t: &Value) -> Vec<String> {
    t.pointer("/entities/urls")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|u| u.get("expanded_url")?.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_post(v: &Value) -> Result<PostInfo, String> {
    let d = v.get("data").ok_or("post lookup returned no data")?;
    Ok(PostInfo {
        post_id: id(d, "id").ok_or("post id")?,
        author_id: id(d, "author_id").ok_or("post author_id")?,
        created_at_ms: d
            .get("created_at")
            .and_then(Value::as_str)
            .and_then(parse_iso_ms)
            .ok_or("post created_at")?,
        conversation_id: id(d, "conversation_id").ok_or("post conversation_id")?,
        urls: expanded_urls(d),
    })
}

/// One page of `GET /2/tweets/search/all` with author, media and user expansions.
#[derive(Debug, Default)]
pub struct SearchPage {
    pub replies: Vec<Reply>,
    /// (author id, created_at, expanded URLs) for every post on the page.
    pub urls: Vec<(u64, u64, Vec<String>)>,
    pub media: Vec<(u64, String)>,
    pub next_token: Option<String>,
    pub posts: u64,
    pub users: u64,
}

pub fn parse_search_page(v: &Value) -> Result<SearchPage, String> {
    let mut page = SearchPage {
        next_token: v
            .pointer("/meta/next_token")
            .and_then(Value::as_str)
            .map(str::to_owned),
        ..SearchPage::default()
    };
    let users: HashMap<u64, &Value> = v
        .pointer("/includes/users")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|u| Some((id(u, "id")?, u))).collect())
        .unwrap_or_default();
    page.users = users.len() as u64;
    let media: HashMap<&str, String> = v
        .pointer("/includes/media")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|m| {
                    let key = m.get("media_key")?.as_str()?;
                    let url = m
                        .get("url")
                        .or_else(|| m.get("preview_image_url"))?
                        .as_str()?;
                    Some((key, url.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default();

    let Some(data) = v.get("data").and_then(Value::as_array) else {
        return Ok(page); // no results in this slice
    };
    page.posts = data.len() as u64;
    for t in data {
        let reply_id = id(t, "id").ok_or("reply id")?;
        let author_id = id(t, "author_id").ok_or("reply author_id")?;
        let created_at_ms = t
            .get("created_at")
            .and_then(Value::as_str)
            .and_then(parse_iso_ms)
            .ok_or("reply created_at")?;
        let parent_id = t
            .get("referenced_tweets")
            .and_then(Value::as_array)
            .and_then(|r| {
                r.iter()
                    .find(|x| x.get("type").and_then(Value::as_str) == Some("replied_to"))
            })
            .and_then(|x| id(x, "id"));
        let keys: Vec<&str> = t
            .pointer("/attachments/media_keys")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        if let Some(url) = keys.iter().find_map(|k| media.get(k)) {
            page.media.push((reply_id, url.clone()));
        }
        // An author X did not expand (suspended, protected) counts as a brand-new account with no
        // followers, so the account-age and follower rules exclude it rather than let it through.
        let author = match users.get(&author_id) {
            Some(u) => Author {
                id: author_id,
                handle: u
                    .get("username")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                created_at_ms: u
                    .get("created_at")
                    .and_then(Value::as_str)
                    .and_then(parse_iso_ms)
                    .unwrap_or(u64::MAX),
                followers: u
                    .pointer("/public_metrics/followers_count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            },
            None => Author {
                id: author_id,
                handle: String::new(),
                created_at_ms: u64::MAX,
                followers: 0,
            },
        };
        page.urls.push((author_id, created_at_ms, expanded_urls(t)));
        page.replies.push(Reply {
            reply_id,
            parent_id,
            created_at_ms,
            text: unescape(t.get("text").and_then(Value::as_str).unwrap_or_default()),
            has_media: !keys.is_empty(),
            author,
        });
    }
    Ok(page)
}

/// [start, end) slices covering [start_ms, end_ms] at second precision, oldest first.
pub fn slices(start_ms: u64, end_ms: u64) -> Vec<(u64, u64)> {
    let start = start_ms / 1000 * 1000;
    let end = (end_ms / 1000 + 1) * 1000; // X's end_time is exclusive
    let mut out = Vec::new();
    let mut s = start;
    while s < end {
        let e = (s + SLICE_MS).min(end);
        out.push((s, e));
        s = e;
    }
    out
}

/// Folds search pages into a conversation, keeping each reply once.
#[derive(Default)]
pub struct Collector {
    replies: BTreeMap<u64, Reply>,
    conv: Conversation,
    seen_urls: HashSet<u64>,
}

impl Collector {
    pub fn add(&mut self, page: SearchPage, post: &PostInfo, closes_at_ms: u64) {
        self.conv.posts_read += page.posts;
        self.conv.users_read += page.users;
        for (rid, url) in page.media {
            self.conv.media.entry(rid).or_insert(url);
        }
        for (reply, (author, at, urls)) in page.replies.into_iter().zip(page.urls) {
            if author == post.author_id
                && at <= closes_at_ms
                && self.seen_urls.insert(reply.reply_id)
            {
                self.conv.author_reply_urls.extend(urls);
            }
            if reply.reply_id != post.post_id {
                self.replies.entry(reply.reply_id).or_insert(reply);
            }
        }
    }

    pub fn len(&self) -> usize {
        self.replies.len()
    }

    pub fn is_empty(&self) -> bool {
        self.replies.is_empty()
    }

    pub fn finish(mut self) -> Conversation {
        self.conv.replies = self.replies.into_values().collect();
        self.conv
    }
}

// === Client ===

pub struct XClient {
    http: reqwest::Client,
    bearer: String,
}

impl XClient {
    pub fn new(bearer: String) -> Self {
        Self {
            http: http_client(Duration::from_secs(30)),
            bearer,
        }
    }

    async fn get(&self, what: &str, url: &str) -> Result<Value, UpstreamError> {
        let resp = send_with_retry(what, || self.http.get(url).bearer_auth(&self.bearer)).await?;
        let status = resp.status().as_u16();
        let body: Value = resp.json().await.unwrap_or(Value::Null);
        if status != 200 {
            let detail = body
                .get("detail")
                .or_else(|| body.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("");
            return Err(UpstreamError(format!("{what}: HTTP {status} {detail}")));
        }
        Ok(body)
    }
}

pub fn search_url(
    conversation_id: u64,
    start_ms: u64,
    end_ms: u64,
    next_token: Option<&str>,
) -> String {
    let mut url = format!(
        "{X_API}/2/tweets/search/all?query=conversation_id:{conversation_id}&start_time={}&end_time={}&max_results={PAGE_SIZE}\
         &tweet.fields=author_id,created_at,referenced_tweets,entities,attachments\
         &expansions=author_id,attachments.media_keys&user.fields=username,created_at,public_metrics&media.fields=url,preview_image_url,type",
        iso_seconds(start_ms),
        iso_seconds(end_ms),
    );
    if let Some(t) = next_token {
        url.push_str("&next_token=");
        url.push_str(t);
    }
    url
}

impl XSource for XClient {
    async fn post(&self, post_id: u64) -> Result<PostInfo, UpstreamError> {
        let url = format!(
            "{X_API}/2/tweets/{post_id}?tweet.fields=author_id,created_at,conversation_id,entities"
        );
        let body = self.get("X post lookup", &url).await?;
        parse_post(&body).map_err(|e| UpstreamError(format!("X post lookup: {e}")))
    }

    async fn conversation(
        &self,
        post: &PostInfo,
        start_ms: u64,
        end_ms: u64,
        cap: u32,
    ) -> Result<Conversation, UpstreamError> {
        let mut c = Collector::default();
        for (s, e) in slices(start_ms, end_ms) {
            let mut token: Option<String> = None;
            loop {
                let body = self
                    .get(
                        "X search",
                        &search_url(post.post_id, s, e, token.as_deref()),
                    )
                    .await?;
                let page = parse_search_page(&body)
                    .map_err(|m| UpstreamError(format!("X search: {m}")))?;
                token = page.next_token.clone();
                c.add(page, post, end_ms);
                if token.is_none() {
                    break;
                }
            }
            if c.len() >= cap as usize {
                break;
            }
        }
        Ok(c.finish())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn iso_round_trips() {
        for ms in [
            0u64,
            1_764_000_000_000,
            1_764_086_399_999,
            951_782_400_000, /* 2000-02-29 */
        ] {
            let s = iso_seconds(ms);
            assert_eq!(parse_iso_ms(&s), Some(ms / 1000 * 1000), "{s}");
        }
        assert_eq!(iso_seconds(1_764_158_096_000), "2025-11-26T11:54:56Z");
        assert_eq!(
            parse_iso_ms("2025-11-26T11:54:56.123Z"),
            Some(1_764_158_096_123)
        );
        assert_eq!(
            parse_iso_ms("2025-11-26T11:54:56.1Z"),
            Some(1_764_158_096_100)
        );
        for bad in [
            "2025-11-26 11:54:56Z",
            "2025-13-01T00:00:00Z",
            "2025-11-26T11:54:56",
            "x",
        ] {
            assert_eq!(parse_iso_ms(bad), None, "{bad}");
        }
    }

    #[test]
    fn slices_cover_the_window_oldest_first() {
        let open = 1_764_000_000_500;
        let close = open + 13 * 60 * 60 * 1000;
        let s = slices(open, close);
        assert_eq!(s.first().unwrap().0, 1_764_000_000_000);
        assert!(s.last().unwrap().1 > close);
        assert!(s.windows(2).all(|w| w[0].1 == w[1].0));
        assert_eq!(s.len(), 3);
    }

    fn page() -> Value {
        json!({
            "data": [
                {"id": "1002", "author_id": "21", "created_at": "2025-11-26T10:00:00.000Z",
                 "text": "#Yeti &amp; friends &lt;3 0xabc", "referenced_tweets": [{"type": "replied_to", "id": "1000"}],
                 "attachments": {"media_keys": ["3_1"]}},
                {"id": "1003", "author_id": "99", "created_at": "2025-11-26T10:01:00.000Z", "text": "no expansion",
                 "referenced_tweets": [{"type": "quoted", "id": "5"}]},
                {"id": "1004", "author_id": "10", "created_at": "2025-11-26T10:02:00.000Z", "text": "link",
                 "entities": {"urls": [{"expanded_url": "https://chek.app/g/0x01"}]}}
            ],
            "includes": {
                "users": [
                    {"id": "21", "username": "yetifan", "created_at": "2020-01-01T00:00:00.000Z", "public_metrics": {"followers_count": 42}},
                    {"id": "10", "username": "org", "created_at": "2019-01-01T00:00:00.000Z", "public_metrics": {"followers_count": 9000}}
                ],
                "media": [{"media_key": "3_1", "type": "photo", "url": "https://pbs.twimg.com/media/a.jpg"}]
            },
            "meta": {"result_count": 3, "next_token": "abc"}
        })
    }

    #[test]
    fn parses_a_search_page() {
        let p = parse_search_page(&page()).unwrap();
        assert_eq!(p.next_token.as_deref(), Some("abc"));
        assert_eq!((p.posts, p.users), (3, 2));
        let r = &p.replies[0];
        assert_eq!(r.text, "#Yeti & friends <3 0xabc");
        assert_eq!(
            (r.parent_id, r.has_media, r.author.followers),
            (Some(1000), true, 42)
        );
        assert_eq!(r.author.handle, "yetifan");
        assert_eq!(
            p.media,
            vec![(1002, "https://pbs.twimg.com/media/a.jpg".to_owned())]
        );
        // Not a reply (quoted) and an author X did not expand.
        let q = &p.replies[1];
        assert_eq!(
            (q.parent_id, q.author.followers, q.author.created_at_ms),
            (None, 0, u64::MAX)
        );
        assert!(parse_search_page(&json!({"meta": {"result_count": 0}}))
            .unwrap()
            .replies
            .is_empty());
    }

    #[test]
    fn collector_dedupes_and_keeps_author_reply_links() {
        let post = PostInfo {
            post_id: 1000,
            author_id: 10,
            created_at_ms: 0,
            conversation_id: 1000,
            urls: vec![],
        };
        let mut c = Collector::default();
        c.add(parse_search_page(&page()).unwrap(), &post, u64::MAX);
        c.add(parse_search_page(&page()).unwrap(), &post, u64::MAX); // the same page again
        assert_eq!(c.len(), 3);
        let conv = c.finish();
        assert_eq!(
            conv.author_reply_urls,
            vec!["https://chek.app/g/0x01".to_owned()]
        );
        assert_eq!(conv.posts_read, 6);
        // Author replies after close don't count towards linkage.
        let mut late = Collector::default();
        late.add(parse_search_page(&page()).unwrap(), &post, 0);
        assert!(late.finish().author_reply_urls.is_empty());
    }

    #[test]
    fn search_url_has_the_window_and_expansions() {
        let u = search_url(1000, 1_764_000_000_000, 1_764_021_600_000, Some("tok"));
        assert!(u.starts_with("https://api.x.com/2/tweets/search/all?query=conversation_id:1000&start_time=2025-11-24T16:00:00Z"));
        assert!(
            u.contains("expansions=author_id,attachments.media_keys")
                && u.ends_with("&next_token=tok")
        );
    }
}
