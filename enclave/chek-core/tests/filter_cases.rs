//! Runs fixtures/filter-cases.json (hand-written expected outcomes) through the rules filter.

use chek_core::filter::{
    finalize, names_to_resolve, select, FilterContext, FilterError, Outcome, Reply, Verdict,
};
use chek_core::validate_rules;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
struct Case {
    name: String,
    context: FilterContext,
    rules: Value,
    names: HashMap<String, Option<String>>,
    verdicts: HashMap<String, Verdict>,
    replies: Vec<Reply>,
    expected: Value,
}

fn cases() -> Vec<Case> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/filter-cases.json"
    );
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    serde_json::from_value(v["cases"].clone()).unwrap()
}

fn addr(s: &str) -> [u8; 32] {
    hex::decode(s.trim_start_matches("0x"))
        .unwrap()
        .try_into()
        .unwrap()
}

fn run(c: &Case) -> Result<Outcome, FilterError> {
    let rules =
        validate_rules(&c.rules).unwrap_or_else(|e| panic!("{}: rules invalid: {e:?}", c.name));
    let names: HashMap<String, Option<[u8; 32]>> = c
        .names
        .iter()
        .map(|(k, v)| (k.clone(), v.as_deref().map(addr)))
        .collect();
    let verdicts: HashMap<u64, Verdict> = c
        .verdicts
        .iter()
        .map(|(k, v)| (k.parse().unwrap(), v.clone()))
        .collect();
    let sel = select(&c.context, &rules, &c.replies, &names);
    // The judge only ever sees replies that passed every other rule.
    for e in sel.to_judge(&c.context) {
        assert!(e.reply.reply_id != c.context.post_id);
    }
    finalize(&c.context, &rules, sel, &verdicts)
}

#[test]
fn every_case_matches_its_expected_outcome() {
    for c in cases() {
        match (run(&c), c.expected.get("error")) {
            (Ok(out), None) => {
                let got = serde_json::to_value(&out).unwrap();
                assert_eq!(got, c.expected, "{}", c.name);
            }
            (Err(FilterError::MissingVerdict(id)), Some(e)) => {
                assert_eq!(
                    format!("MissingVerdict:{id}"),
                    e.as_str().unwrap(),
                    "{}",
                    c.name
                )
            }
            (got, want) => panic!("{}: got {got:?}, want {want:?}", c.name),
        }
    }
}

#[test]
fn names_to_resolve_lists_only_names_that_reach_rule_6() {
    let c = cases()
        .into_iter()
        .find(|c| c.name == "every reason code in a draw")
        .unwrap();
    let rules = validate_rules(&c.rules).unwrap();
    let names: Vec<String> = names_to_resolve(&c.context, &rules, &c.replies)
        .into_iter()
        .collect();
    assert_eq!(names, ["ghost.sui", "nomap.sui", "yeti.sui"]);
}

#[test]
fn output_does_not_depend_on_reply_order() {
    for c in cases()
        .into_iter()
        .filter(|c| c.expected.get("error").is_none())
    {
        let mut reversed = Case {
            replies: c.replies.iter().rev().cloned().collect(),
            ..c
        };
        let want = reversed.expected.clone();
        let got = serde_json::to_value(run(&reversed).unwrap()).unwrap();
        assert_eq!(got, want, "{} (reversed)", reversed.name);
        reversed.replies.rotate_left(1);
        assert_eq!(
            serde_json::to_value(run(&reversed).unwrap()).unwrap(),
            want,
            "{} (rotated)",
            reversed.name
        );
    }
}

fn string_values(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Array(a) => a.iter().for_each(|x| string_values(x, out)),
        // Reason codes, addresses and SuiNS names are meant to be there.
        Value::Object(o) => o
            .iter()
            .filter(|(k, _)| !matches!(k.as_str(), "code" | "address" | "via"))
            .for_each(|(_, x)| string_values(x, out)),
        _ => {}
    }
}

/// MD10: no tweet text in the snapshot. Every word of every reply (other than addresses and
/// SuiNS names, which are meant to be there) must be absent from the outcome's values.
#[test]
fn no_reply_text_reaches_the_outcome() {
    for c in cases()
        .into_iter()
        .filter(|c| c.expected.get("error").is_none())
    {
        let mut values = Vec::new();
        string_values(
            &serde_json::to_value(run(&c).unwrap()).unwrap(),
            &mut values,
        );
        for r in &c.replies {
            for w in r.text.split_whitespace().filter(|w| w.chars().count() > 3) {
                let lw = w.to_lowercase();
                if lw.starts_with("0x") || lw.trim_end_matches('.').ends_with(".sui") {
                    continue;
                }
                assert!(
                    !values.iter().any(|v| v.to_lowercase().contains(&lw)),
                    "{}: '{w}' leaked",
                    c.name
                );
            }
        }
    }
}
