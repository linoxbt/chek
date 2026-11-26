//! JSON canonicalisation per RFC 8785 (JCS), restricted to null, booleans, safe integers,
//! strings, arrays and objects, exactly like `packages/core/src/canonical.ts`.

use serde_json::Value;
use std::fmt::Write;

const MAX_SAFE: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalError(pub String);

impl std::fmt::Display for CanonicalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CanonicalError {}

pub fn canonicalize(value: &Value) -> Result<String, CanonicalError> {
    let mut out = String::new();
    write_value(&mut out, value)?;
    Ok(out)
}

fn write_value(out: &mut String, value: &Value) -> Result<(), CanonicalError> {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            let i = if let Some(i) = n.as_i64() {
                i
            } else if let Some(u) = n.as_u64() {
                i64::try_from(u).map_err(|_| CanonicalError(format!("integer {u} is not safe")))?
            } else {
                return Err(CanonicalError(format!(
                    "only safe integers are allowed, got {n}"
                )));
            };
            if !(-MAX_SAFE..=MAX_SAFE).contains(&i) {
                return Err(CanonicalError(format!("integer {i} is not safe")));
            }
            write!(out, "{i}").expect("writing to a String cannot fail");
        }
        Value::String(s) => write_string(out, s),
        Value::Array(items) => {
            out.push('[');
            for (k, item) in items.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                write_value(out, item)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            // RFC 8785 orders keys by UTF-16 code units, not by code points or UTF-8 bytes.
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (k, key) in keys.iter().enumerate() {
                if k > 0 {
                    out.push(',');
                }
                write_string(out, key);
                out.push(':');
                write_value(out, &map[key.as_str()])?;
            }
            out.push('}');
        }
    }
    Ok(())
}

/// The ECMAScript JSON.stringify string escaping that RFC 8785 adopts.
fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                write!(out, "\\u{:04x}", c as u32).expect("writing to a String cannot fail");
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn refuses_non_integers_and_unsafe_integers() {
        assert!(canonicalize(&json!(1.5)).is_err());
        assert!(canonicalize(&json!(9_007_199_254_740_992u64)).is_err());
        assert!(canonicalize(&json!(u64::MAX)).is_err());
        assert_eq!(
            canonicalize(&json!(-9_007_199_254_740_991i64)).unwrap(),
            "-9007199254740991"
        );
    }
}
