//! Rules document, version 1 (spec section 8). The checks match `packages/core/src/rules.ts`
//! one for one, so a document is accepted by the web app exactly when the enclave accepts it.

use crate::canonical::canonicalize;
use crate::hash::blake2b256;
use serde_json::{Map, Value};

pub const MAX_ACCOUNT_AGE_DAYS: u64 = 3650;
pub const MAX_MIN_FOLLOWERS: u64 = 1_000_000;
pub const MAX_REQUIRED_TEXT: usize = 5;
pub const MAX_REQUIRED_TEXT_CHARS: usize = 100;
pub const MAX_EXCLUDED_AUTHORS: usize = 50;
pub const MAX_PROMPT_CHARS: usize = 2000;
pub const MAX_MODEL_CHARS: usize = 100;

const RULE_KEYS: [&str; 12] = [
    "v",
    "platform",
    "mode",
    "entry",
    "direct_replies_only",
    "min_account_age_days",
    "min_followers",
    "required_text",
    "require_media",
    "exclude_author_ids",
    "exclude_post_author",
    "rubric",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Draw,
    Judged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rubric {
    pub prompt: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rules {
    pub mode: Mode,
    pub direct_replies_only: bool,
    pub min_account_age_days: u32,
    pub min_followers: u32,
    pub required_text: Vec<String>,
    pub require_media: bool,
    pub exclude_author_ids: Vec<u64>,
    pub rubric: Option<Rubric>,
}

/// JavaScript's `String.prototype.trim()` whitespace set (WhiteSpace + LineTerminator). It differs
/// from Rust's `char::is_whitespace` (U+FEFF is in it, U+0085 is not), and the two sides must agree.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn is_blank(s: &str) -> bool {
    s.chars().all(is_js_whitespace)
}

/// A non-blank string of at most `max` Unicode code points.
fn bounded_text(v: &Value, max: usize) -> Option<&str> {
    let s = v.as_str()?;
    (!is_blank(s) && s.chars().count() <= max).then_some(s)
}

/// An integer in `min..=max`. Numbers written with a fraction or exponent are refused, as in TS.
fn int_in_range(v: &Value, min: i64, max: i64) -> Option<i64> {
    let n = v.as_number()?;
    let i = n
        .as_i64()
        .or_else(|| n.as_u64().and_then(|u| i64::try_from(u).ok()))?;
    (min..=max).contains(&i).then_some(i)
}

fn decimal_u64(s: &str) -> Option<u64> {
    let digits_ok = !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
    let no_leading_zero = s == "0" || !s.starts_with('0');
    if digits_ok && no_leading_zero {
        s.parse::<u64>().ok()
    } else {
        None
    }
}

pub fn validate_rules(value: &Value) -> Result<Rules, Vec<String>> {
    let Some(r) = value.as_object() else {
        return Err(vec!["rules: must be an object".into()]);
    };
    let mut errors = Vec::new();
    for k in r.keys() {
        if !RULE_KEYS.contains(&k.as_str()) {
            errors.push(format!("{k}: unknown field"));
        }
    }
    for k in RULE_KEYS {
        if !r.contains_key(k) {
            errors.push(format!("{k}: missing"));
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    if r["v"].as_number().and_then(|n| n.as_u64()) != Some(1) || !r["v"].is_u64() {
        errors.push("v: must be 1".into());
    }
    if r["platform"].as_str() != Some("x") {
        errors.push("platform: must be \"x\"".into());
    }
    let mode = match r["mode"].as_str() {
        Some("draw") => Some(Mode::Draw),
        Some("judged") => Some(Mode::Judged),
        _ => {
            errors.push("mode: must be \"draw\" or \"judged\"".into());
            None
        }
    };
    if r["entry"].as_str() != Some("reply") {
        errors.push("entry: must be \"reply\"".into());
    }
    let direct_replies_only = r["direct_replies_only"].as_bool();
    if direct_replies_only.is_none() {
        errors.push("direct_replies_only: must be a boolean".into());
    }
    let min_age = int_in_range(&r["min_account_age_days"], 0, MAX_ACCOUNT_AGE_DAYS as i64);
    if min_age.is_none() {
        errors.push(format!(
            "min_account_age_days: integer 0..{MAX_ACCOUNT_AGE_DAYS}"
        ));
    }
    let min_followers = int_in_range(&r["min_followers"], 0, MAX_MIN_FOLLOWERS as i64);
    if min_followers.is_none() {
        errors.push(format!("min_followers: integer 0..{MAX_MIN_FOLLOWERS}"));
    }

    let mut required_text = Vec::new();
    match r["required_text"].as_array() {
        None => errors.push("required_text: must be an array".into()),
        Some(items) => {
            if items.len() > MAX_REQUIRED_TEXT {
                errors.push(format!(
                    "required_text: at most {MAX_REQUIRED_TEXT} strings"
                ));
            }
            for (i, t) in items.iter().enumerate() {
                match bounded_text(t, MAX_REQUIRED_TEXT_CHARS) {
                    Some(s) => required_text.push(s.to_owned()),
                    None => errors.push(format!(
                        "required_text[{i}]: non-blank string of at most {MAX_REQUIRED_TEXT_CHARS} characters"
                    )),
                }
            }
        }
    }

    let require_media = r["require_media"].as_bool();
    if require_media.is_none() {
        errors.push("require_media: must be a boolean".into());
    }

    let mut exclude_author_ids: Vec<u64> = Vec::new();
    match r["exclude_author_ids"].as_array() {
        None => errors.push("exclude_author_ids: must be an array".into()),
        Some(items) => {
            if items.len() > MAX_EXCLUDED_AUTHORS {
                errors.push(format!(
                    "exclude_author_ids: at most {MAX_EXCLUDED_AUTHORS} ids"
                ));
            }
            for (i, id) in items.iter().enumerate() {
                match id.as_str().and_then(decimal_u64) {
                    None => errors.push(format!(
                        "exclude_author_ids[{i}]: decimal u64 string without leading zeros"
                    )),
                    Some(id) if exclude_author_ids.contains(&id) => {
                        errors.push(format!("exclude_author_ids[{i}]: duplicate"))
                    }
                    Some(id) => exclude_author_ids.push(id),
                }
            }
        }
    }

    if r["exclude_post_author"].as_bool() != Some(true) {
        errors.push("exclude_post_author: must be true".into());
    }

    let rubric = match &r["rubric"] {
        Value::Null => {
            if mode == Some(Mode::Judged) {
                errors.push("rubric: required when mode is judged".into());
            }
            None
        }
        Value::Object(rb) => parse_rubric(rb, mode, &mut errors),
        _ => {
            errors.push("rubric: must be null or an object".into());
            None
        }
    };

    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(Rules {
        mode: mode.expect("checked above"),
        direct_replies_only: direct_replies_only.expect("checked above"),
        min_account_age_days: min_age.expect("checked above") as u32,
        min_followers: min_followers.expect("checked above") as u32,
        required_text,
        require_media: require_media.expect("checked above"),
        exclude_author_ids,
        rubric,
    })
}

fn parse_rubric(
    rb: &Map<String, Value>,
    mode: Option<Mode>,
    errors: &mut Vec<String>,
) -> Option<Rubric> {
    let mut keys: Vec<&str> = rb.keys().map(String::as_str).collect();
    keys.sort_unstable();
    if keys != ["model", "prompt"] {
        errors.push("rubric: must have exactly prompt and model".into());
    }
    let prompt = rb
        .get("prompt")
        .and_then(|v| bounded_text(v, MAX_PROMPT_CHARS));
    if prompt.is_none() {
        errors.push(format!(
            "rubric.prompt: non-blank string of at most {MAX_PROMPT_CHARS} characters"
        ));
    }
    let model = rb
        .get("model")
        .and_then(|v| bounded_text(v, MAX_MODEL_CHARS));
    if model.is_none() {
        errors.push(format!(
            "rubric.model: non-blank string of at most {MAX_MODEL_CHARS} characters"
        ));
    }
    if mode == Some(Mode::Draw) {
        errors.push("rubric: must be null when mode is draw".into());
    }
    Some(Rubric {
        prompt: prompt?.to_owned(),
        model: model?.to_owned(),
    })
}

/// What `/snapshot` does with the rules text it is sent: parse, validate and require that the
/// text is already canonical. Returns the rules and `rules_hash` = Blake2b-256 of the text.
pub fn parse_canonical_rules(text: &str) -> Result<(Rules, [u8; 32]), Vec<String>> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| vec!["rules: not valid JSON".to_owned()])?;
    let rules = validate_rules(&value)?;
    let canonical = canonicalize(&value).map_err(|e| vec![format!("rules: {e}")])?;
    if canonical != text {
        return Err(vec!["rules: text is not in canonical form".into()]);
    }
    Ok((rules, blake2b256(text.as_bytes())))
}
