//! The entrant rules (spec section 10), applied in this order to every reply in the post's
//! conversation:
//!
//! 0. Replies beyond `max_replies_read` (by reply ID) are not read: OVER_CAP.
//! 1. Created outside [opened_at, closes_at]: LATE.
//! 2. `direct_replies_only` and the parent is not the post: NOT_DIRECT.
//! 3. The post's author, or a listed author: EXCLUDED.
//! 4. Account younger than `min_account_age_days` at close: TOO_YOUNG; fewer followers than
//!    `min_followers` at fetch: FEW_FOLLOWERS.
//! 5. A required text missing (case-insensitive): MISSING_TEXT; no media when required: NO_MEDIA.
//! 6. Address: the first full `0x` + 64-hex address, else the first `.sui` name, resolved through
//!    SuiNS (SUINS_UNRESOLVED), else NO_ADDRESS.
//! 7. Per author, the earliest reply that passed 0–6 is kept: later ones DUP_ACCOUNT.
//! 8. Per address, the earliest is kept: later ones DUP_ADDRESS.
//! 9. Judged Draw: the first `max_judged` remaining replies are judged (AI_FAIL with a reason);
//!    the rest OVER_CAP.
//! 10. Sorted by reply ID, capped at `max_entrants` (OVER_CAP), indexed 0..n−1.
//!
//! The filter does no I/O. SuiNS lookups and AI verdicts are passed in, so the enclave can make
//! those calls concurrently around it, and the same inputs always give the same snapshot.

use crate::json::{u64_string, u64_string_opt};
use crate::rules::{Mode, Rules};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};

pub const DAY_MS: u64 = 86_400_000;
pub const MAX_AI_REASON_CHARS: usize = 200;
/// Host of giveaway links: `https://chek.app/g/<campaign id>` (name clearance is open question Q3).
pub const CHEK_LINK_HOST: &str = "chek.app";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Reason {
    NoAddress,
    DupAccount,
    DupAddress,
    TooYoung,
    FewFollowers,
    MissingText,
    NoMedia,
    Excluded,
    Late,
    SuinsUnresolved,
    AiFail,
    OverCap,
    NotDirect,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Author {
    #[serde(with = "u64_string")]
    pub id: u64,
    pub handle: String,
    pub created_at_ms: u64,
    pub followers: u64,
}

/// One post from the conversation, as the X client hands it over. `text` is plain text: the X
/// client undoes the API's `&amp;`, `&lt;` and `&gt;` escaping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reply {
    #[serde(with = "u64_string")]
    pub reply_id: u64,
    /// The post this one replies to; None if X gave no `replied_to` reference.
    #[serde(with = "u64_string_opt")]
    pub parent_id: Option<u64>,
    pub created_at_ms: u64,
    pub text: String,
    pub has_media: bool,
    pub author: Author,
}

/// The campaign values the filter needs, all taken from the chain or the signed request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilterContext {
    #[serde(with = "u64_string")]
    pub post_id: u64,
    #[serde(with = "u64_string")]
    pub post_author_id: u64,
    pub opened_at_ms: u64,
    pub closes_at_ms: u64,
    pub max_entrants: u32,
    pub max_judged: u32,
    pub max_replies_read: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddressSource {
    Hex([u8; 32]),
    /// A SuiNS name, lowercased, e.g. `yeti.sui`.
    Name(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verdict {
    pub pass: bool,
    pub reason: String,
}

/// A reply that passed rules 0–8 (and, after `finalize`, the judge and the caps).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Eligible {
    pub reply: Reply,
    pub address: [u8; 32],
    /// `None` for a hex address, else the SuiNS name it was resolved from.
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entrant {
    pub i: u32,
    #[serde(with = "u64_string")]
    pub reply_id: u64,
    #[serde(with = "u64_string")]
    pub author_id: u64,
    pub handle: String,
    pub address: String,
    /// `"hex"` or `"suins:<name>"`.
    pub via: String,
    pub verdict: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Excluded {
    #[serde(with = "u64_string")]
    pub reply_id: u64,
    #[serde(with = "u64_string")]
    pub author_id: u64,
    pub code: Reason,
    /// Only for AI_FAIL: the model's reason, at most 200 characters.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    pub replies_seen: u32,
    pub entrants: Vec<Entrant>,
    pub excluded: Vec<Excluded>,
}

/// Result of rules 0–8: who is eligible, before the judge and the entrant cap.
#[derive(Debug, Clone)]
pub struct Selection {
    pub replies_seen: u32,
    /// In reply-ID order.
    pub eligible: Vec<Eligible>,
    pub excluded: Vec<Excluded>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterError {
    /// Judged Draw: a reply that must be judged has no verdict. The whole snapshot fails, so an
    /// LLM outage never fails entries.
    MissingVerdict(u64),
}

impl std::fmt::Display for FilterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FilterError::MissingVerdict(id) => write!(f, "no AI verdict for reply {id}"),
        }
    }
}

impl std::error::Error for FilterError {}

// === Address extraction (rule 6) ===

fn is_hex(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

/// The first full Sui address in `text`: `0x` or `0X`, exactly 64 hex digits, with no ASCII
/// letter or digit directly before the `0` or after the last digit. Lowercased.
pub fn first_hex_address(text: &str) -> Option<[u8; 32]> {
    let b = text.as_bytes();
    let mut i = 0;
    while i + 2 <= b.len() {
        let starts = b[i] == b'0'
            && (b[i + 1] == b'x' || b[i + 1] == b'X')
            && (i == 0 || !b[i - 1].is_ascii_alphanumeric());
        if starts {
            let mut j = i + 2;
            while j < b.len() && is_hex(b[j]) {
                j += 1;
            }
            let run = j - (i + 2);
            let bounded = j == b.len() || !b[j].is_ascii_alphanumeric();
            if run == 64 && bounded {
                let hex = text[i + 2..j].to_ascii_lowercase();
                let mut out = [0u8; 32];
                hex::decode_to_slice(hex, &mut out).ok()?;
                return Some(out);
            }
        }
        i += 1;
    }
    None
}

fn valid_label(l: &str) -> bool {
    !l.is_empty()
        && l.len() <= 63
        && !l.starts_with('-')
        && !l.ends_with('-')
        && l.bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// The first SuiNS name in `text`: a token of ASCII letters, digits, dots and hyphens (trailing
/// dots dropped) that ends in `.sui`, with valid labels and a main label of 3+ characters, e.g.
/// `yeti.sui` or `blue.yeti.sui`. `@` and punctuation end a token. Lowercased.
pub fn first_sui_name(text: &str) -> Option<String> {
    let is_tok = |c: char| c.is_ascii_alphanumeric() || c == '.' || c == '-';
    for raw in text.split(|c: char| !is_tok(c)) {
        let tok = raw.trim_end_matches('.').to_ascii_lowercase();
        let Some(stem) = tok.strip_suffix(".sui") else {
            continue;
        };
        let labels: Vec<&str> = stem.split('.').collect();
        let main_ok = labels.last().is_some_and(|m| m.len() >= 3);
        if main_ok && labels.iter().all(|l| valid_label(l)) {
            return Some(tok);
        }
    }
    None
}

pub fn extract_address(text: &str) -> Option<AddressSource> {
    first_hex_address(text)
        .map(AddressSource::Hex)
        .or_else(|| first_sui_name(text).map(AddressSource::Name))
}

// === Rules 0–8 ===

fn contains_ci(haystack_lower: &str, needle: &str) -> bool {
    haystack_lower.contains(&needle.to_lowercase())
}

/// Replies in the conversation, the post itself and repeated IDs removed, in reply-ID order,
/// split into those read (within `max_replies_read`) and those beyond the cap.
fn conversation<'a>(ctx: &FilterContext, replies: &'a [Reply]) -> (Vec<&'a Reply>, Vec<&'a Reply>) {
    let mut seen = HashSet::new();
    let mut all: Vec<&Reply> = replies
        .iter()
        .filter(|r| r.reply_id != ctx.post_id && seen.insert(r.reply_id))
        .collect();
    all.sort_by_key(|r| r.reply_id);
    let cap = (ctx.max_replies_read as usize).min(all.len());
    let rest = all.split_off(cap);
    (all, rest)
}

/// Rules 1–6 for one reply, up to (not including) SuiNS resolution.
fn check(ctx: &FilterContext, rules: &Rules, r: &Reply) -> Result<AddressSource, Reason> {
    if r.created_at_ms < ctx.opened_at_ms || r.created_at_ms > ctx.closes_at_ms {
        return Err(Reason::Late);
    }
    if rules.direct_replies_only && r.parent_id != Some(ctx.post_id) {
        return Err(Reason::NotDirect);
    }
    if r.author.id == ctx.post_author_id || rules.exclude_author_ids.contains(&r.author.id) {
        return Err(Reason::Excluded);
    }
    let min_age = u64::from(rules.min_account_age_days) * DAY_MS;
    if ctx.closes_at_ms.saturating_sub(r.author.created_at_ms) < min_age {
        return Err(Reason::TooYoung);
    }
    if r.author.followers < u64::from(rules.min_followers) {
        return Err(Reason::FewFollowers);
    }
    let lower = r.text.to_lowercase();
    if !rules.required_text.iter().all(|t| contains_ci(&lower, t)) {
        return Err(Reason::MissingText);
    }
    if rules.require_media && !r.has_media {
        return Err(Reason::NoMedia);
    }
    extract_address(&r.text).ok_or(Reason::NoAddress)
}

/// SuiNS names the enclave must resolve before `select`: those of replies that pass rules 0–5.
pub fn names_to_resolve(ctx: &FilterContext, rules: &Rules, replies: &[Reply]) -> BTreeSet<String> {
    let (read, _) = conversation(ctx, replies);
    read.into_iter()
        .filter_map(|r| match check(ctx, rules, r) {
            Ok(AddressSource::Name(n)) => Some(n),
            _ => None,
        })
        .collect()
}

fn excluded(r: &Reply, code: Reason) -> Excluded {
    Excluded {
        reply_id: r.reply_id,
        author_id: r.author.id,
        code,
        reason: None,
    }
}

/// Rules 0–8. `names` maps each SuiNS name to its address, or None if it did not resolve; a
/// name missing from the map counts as unresolved.
pub fn select(
    ctx: &FilterContext,
    rules: &Rules,
    replies: &[Reply],
    names: &HashMap<String, Option<[u8; 32]>>,
) -> Selection {
    let (read, beyond) = conversation(ctx, replies);
    let mut out = Selection {
        replies_seen: read.len() as u32,
        eligible: Vec::new(),
        excluded: Vec::new(),
    };
    out.excluded
        .extend(beyond.iter().map(|r| excluded(r, Reason::OverCap)));

    let mut authors = HashSet::new();
    let mut addresses = HashSet::new();
    for r in read {
        let resolved = check(ctx, rules, r).and_then(|src| match src {
            AddressSource::Hex(a) => Ok((a, None)),
            AddressSource::Name(n) => match names.get(&n) {
                Some(Some(a)) => Ok((*a, Some(n))),
                _ => Err(Reason::SuinsUnresolved),
            },
        });
        let (address, name) = match resolved {
            Ok(v) => v,
            Err(code) => {
                out.excluded.push(excluded(r, code));
                continue;
            }
        };
        if !authors.insert(r.author.id) {
            out.excluded.push(excluded(r, Reason::DupAccount));
            continue;
        }
        if !addresses.insert(address) {
            out.excluded.push(excluded(r, Reason::DupAddress));
            continue;
        }
        out.eligible.push(Eligible {
            reply: r.clone(),
            address,
            name,
        });
    }
    out
}

impl Selection {
    /// Judged Draw: the replies to send to the judge, in reply-ID order.
    pub fn to_judge(&self, ctx: &FilterContext) -> &[Eligible] {
        let n = (ctx.max_judged as usize).min(self.eligible.len());
        &self.eligible[..n]
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Rules 9–10. `verdicts` (reply ID → verdict) is used only in Judged Draw and must cover every
/// reply `to_judge` returned.
pub fn finalize(
    ctx: &FilterContext,
    rules: &Rules,
    sel: Selection,
    verdicts: &HashMap<u64, Verdict>,
) -> Result<Outcome, FilterError> {
    let Selection {
        replies_seen,
        eligible,
        mut excluded,
    } = sel;
    let mut passed = Vec::new();
    for (k, e) in eligible.into_iter().enumerate() {
        if rules.mode == Mode::Judged {
            if k >= ctx.max_judged as usize {
                excluded.push(self::excluded(&e.reply, Reason::OverCap));
                continue;
            }
            let v = verdicts
                .get(&e.reply.reply_id)
                .ok_or(FilterError::MissingVerdict(e.reply.reply_id))?;
            if !v.pass {
                excluded.push(Excluded {
                    reply_id: e.reply.reply_id,
                    author_id: e.reply.author.id,
                    code: Reason::AiFail,
                    reason: Some(truncate_chars(&v.reason, MAX_AI_REASON_CHARS)),
                });
                continue;
            }
        }
        passed.push(e);
    }

    let mut entrants = Vec::new();
    for e in passed {
        if entrants.len() >= ctx.max_entrants as usize {
            excluded.push(self::excluded(&e.reply, Reason::OverCap));
            continue;
        }
        entrants.push(Entrant {
            i: entrants.len() as u32,
            reply_id: e.reply.reply_id,
            author_id: e.reply.author.id,
            handle: e.reply.author.handle.clone(),
            address: format!("0x{}", hex::encode(e.address)),
            via: e
                .name
                .map_or_else(|| "hex".to_owned(), |n| format!("suins:{n}")),
            verdict: "pass".to_owned(),
        });
    }
    excluded.sort_by_key(|x| x.reply_id);
    Ok(Outcome {
        replies_seen,
        entrants,
        excluded,
    })
}

/// Draw mode in one call (no verdicts needed).
pub fn run_draw(
    ctx: &FilterContext,
    rules: &Rules,
    replies: &[Reply],
    names: &HashMap<String, Option<[u8; 32]>>,
) -> Result<Outcome, FilterError> {
    finalize(
        ctx,
        rules,
        select(ctx, rules, replies, names),
        &HashMap::new(),
    )
}

// === Post linkage (spec section 10) ===

/// The link an organizer puts in the post: `https://chek.app/g/0x<campaign id>`.
pub fn chek_link(campaign_id: &[u8; 32]) -> String {
    format!("https://{CHEK_LINK_HOST}/g/0x{}", hex::encode(campaign_id))
}

/// True when any of `expanded_urls` (X's `entities.urls[].expanded_url` of the post, and of the
/// author's own replies before close) is this campaign's link. Scheme http or https, host
/// `chek.app` or `www.chek.app`, path `/g/0x<64 hex>` with an optional trailing slash, query or
/// fragment; case-insensitive.
pub fn is_linked<'a>(
    campaign_id: &[u8; 32],
    expanded_urls: impl IntoIterator<Item = &'a str>,
) -> bool {
    let want = format!("/g/0x{}", hex::encode(campaign_id));
    expanded_urls.into_iter().any(|u| {
        let u = u.trim().to_ascii_lowercase();
        let Some(rest) = u
            .strip_prefix("https://")
            .or_else(|| u.strip_prefix("http://"))
        else {
            return false;
        };
        let rest = rest.strip_prefix("www.").unwrap_or(rest);
        let Some(path) = rest.strip_prefix(CHEK_LINK_HOST) else {
            return false;
        };
        let path = path.split(['?', '#']).next().unwrap_or("");
        let path = path.strip_suffix('/').unwrap_or(path);
        path == want
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "c8a20d333f56027d0936daa4a1e616d0c13ae1d880b70944dc3198cb30e6464b";

    #[test]
    fn hex_addresses_need_exactly_64_digits_and_clean_edges() {
        let want = Some(hex::decode(A).unwrap().try_into().unwrap());
        assert_eq!(first_hex_address(&format!("send to 0x{A} thanks")), want);
        assert_eq!(first_hex_address(&format!("0X{}", A.to_uppercase())), want);
        assert_eq!(first_hex_address(&format!("(0x{A}).")), want);
        assert_eq!(
            first_hex_address(&format!("0x{}", &A[1..])),
            None,
            "63 digits"
        );
        assert_eq!(first_hex_address(&format!("0x{A}0")), None, "65 digits");
        assert_eq!(first_hex_address(&format!("a0x{A}")), None, "letter before");
        assert_eq!(first_hex_address(&format!("0x{A}g")), None, "letter after");
        let second = "1".repeat(64);
        assert_eq!(
            first_hex_address(&format!("0x{A} or 0x{second}")),
            want,
            "first wins"
        );
        assert_eq!(
            first_hex_address(&format!("0x{}  0x{A}", &A[1..])),
            want,
            "skips a short one"
        );
        assert_eq!(first_hex_address("é0x"), None);
    }

    #[test]
    fn sui_names() {
        assert_eq!(first_sui_name("gm @yeti.sui!"), Some("yeti.sui".into()));
        assert_eq!(
            first_sui_name("Blue.Yeti.SUI."),
            Some("blue.yeti.sui".into())
        );
        assert_eq!(first_sui_name("ab.sui"), None, "main label under 3");
        assert_eq!(first_sui_name("-yeti.sui"), None);
        assert_eq!(first_sui_name("yeti.suix"), None);
        assert_eq!(first_sui_name("x.com/yeti.sui"), Some("yeti.sui".into()));
        assert_eq!(
            first_sui_name("yeti_x.sui"),
            None,
            "underscore ends a token"
        );
    }

    #[test]
    fn hex_beats_name_wherever_it_appears() {
        let t = format!("yeti.sui then 0x{A}");
        assert!(matches!(extract_address(&t), Some(AddressSource::Hex(_))));
    }

    #[test]
    fn links() {
        let id: [u8; 32] = hex::decode(A).unwrap().try_into().unwrap();
        let link = chek_link(&id);
        assert!(is_linked(&id, [link.as_str()]));
        assert!(is_linked(
            &id,
            [format!("HTTPS://www.CHEK.app/g/0x{A}/?ref=x").as_str()]
        ));
        assert!(!is_linked(
            &id,
            [format!("https://chek.app.evil.com/g/0x{A}").as_str()]
        ));
        assert!(!is_linked(
            &id,
            [format!("https://evil.com/chek.app/g/0x{A}").as_str()]
        ));
        assert!(!is_linked(
            &id,
            [format!("https://chek.app/g/0x{A}extra").as_str()]
        ));
        assert!(!is_linked(&id, ["https://t.co/abc"]));
    }
}
