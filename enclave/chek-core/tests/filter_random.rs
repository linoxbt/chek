//! Seeded random giveaways run through the filter; outcomes are recorded in
//! fixtures/filter-random.json, which the TypeScript port must reproduce exactly.
//! Regenerate with CHEK_WRITE_FIXTURES=1 cargo test --test filter_random.

use chek_core::filter::{finalize, select, Author, FilterContext, Reply, Verdict, DAY_MS};
use chek_core::validate_rules;
use serde_json::{json, Value};
use std::collections::HashMap;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.below(100) < pct
    }
}

const OPEN: u64 = 1_764_000_000_000;
const CLOSE: u64 = OPEN + DAY_MS;
const POST: u64 = 1_994_000_000_000_000_000;

fn address(k: u64) -> String {
    format!("{:064x}", k.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
}

fn gen_case(seed: u64, judged: bool) -> Value {
    let mut g = Rng(seed);
    let rules = json!({
        "v": 1, "platform": "x", "mode": if judged { "judged" } else { "draw" }, "entry": "reply",
        "direct_replies_only": g.chance(50), "min_account_age_days": g.below(60),
        "min_followers": g.below(50), "required_text": if g.chance(60) { json!(["#Yeti"]) } else { json!([]) },
        "require_media": g.chance(20), "exclude_author_ids": ["7", "8"], "exclude_post_author": true,
        "rubric": if judged { json!({"prompt": "Pass yetis.", "model": "claude-opus-5-5"}) } else { Value::Null },
    });
    let ctx = json!({
        "post_id": POST.to_string(), "post_author_id": "1", "opened_at_ms": OPEN, "closes_at_ms": CLOSE,
        "max_entrants": 20 + g.below(60), "max_judged": 10 + g.below(60), "max_replies_read": 100 + g.below(60),
    });
    let names = [
        "yeti.sui",
        "blue.yeti.sui",
        "snow.sui",
        "ghost.sui",
        "lost.sui",
    ];
    let mut name_map = serde_json::Map::new();
    name_map.insert("yeti.sui".into(), json!(format!("0x{}", address(3))));
    name_map.insert("blue.yeti.sui".into(), json!(format!("0x{}", address(40))));
    name_map.insert("snow.sui".into(), json!(format!("0x{}", address(41))));
    name_map.insert("ghost.sui".into(), Value::Null);

    let mut replies = Vec::new();
    let mut verdicts = serde_json::Map::new();
    for k in 0..150u64 {
        let reply_id = POST + 1 + g.below(1_000_000);
        let author = 1 + g.below(70);
        let at = match g.below(20) {
            0 => CLOSE + 1 + g.below(1000),
            1 => OPEN,
            2 => CLOSE,
            _ => OPEN + g.below(DAY_MS),
        };
        let mut text = String::new();
        if g.chance(70) {
            text.push_str(["#Yeti ", "#YETI ", "#yeti! ", "yeti "][g.below(4) as usize]);
        }
        match g.below(10) {
            0..=4 => text.push_str(&format!("0x{} ", address(g.below(30)))),
            5 => text.push_str(&format!("0X{} ", address(g.below(30)).to_uppercase())),
            6 => text.push_str(&format!("0x{} ", &address(g.below(30))[1..])),
            7 | 8 => text.push_str(&format!("@{} ", names[g.below(5) as usize])),
            _ => text.push_str("no address here "),
        }
        if g.chance(10) {
            text.push_str(&format!("also 0x{}", address(100 + k)));
        }
        replies.push(Reply {
            reply_id,
            parent_id: if g.chance(80) {
                Some(POST)
            } else if g.chance(50) {
                Some(POST + 5)
            } else {
                None
            },
            created_at_ms: at,
            text,
            has_media: g.chance(50),
            author: Author {
                id: author,
                handle: format!("user{author}"),
                created_at_ms: CLOSE - g.below(90) * DAY_MS - g.below(2),
                followers: g.below(80),
            },
        });
        verdicts.insert(
            reply_id.to_string(),
            json!({"pass": g.chance(70), "reason": format!("reason {k}")}),
        );
    }
    if g.chance(50) {
        replies.push(replies[0].clone()); // a page repeated by the API
    }
    json!({
        "name": format!("seed {seed} ({})", if judged { "judged" } else { "draw" }),
        "context": ctx, "rules": rules, "names": name_map,
        "verdicts": if judged { Value::Object(verdicts) } else { json!({}) },
        "replies": serde_json::to_value(&replies).unwrap(),
    })
}

fn outcome(case: &Value) -> Value {
    let ctx: FilterContext = serde_json::from_value(case["context"].clone()).unwrap();
    let rules = validate_rules(&case["rules"]).unwrap();
    let replies: Vec<Reply> = serde_json::from_value(case["replies"].clone()).unwrap();
    let names: HashMap<String, Option<[u8; 32]>> = case["names"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            let a = v
                .as_str()
                .map(|s| hex::decode(&s[2..]).unwrap().try_into().unwrap());
            (k.clone(), a)
        })
        .collect();
    let verdicts: HashMap<u64, Verdict> = case["verdicts"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| {
            (
                k.parse().unwrap(),
                serde_json::from_value(v.clone()).unwrap(),
            )
        })
        .collect();
    let sel = select(&ctx, &rules, &replies, &names);
    serde_json::to_value(finalize(&ctx, &rules, sel, &verdicts).unwrap()).unwrap()
}

#[test]
fn random_cases_match_the_recorded_fixture() {
    let cases: Vec<Value> = (1..=8u64)
        .map(|s| {
            let mut c = gen_case(s, s % 2 == 0);
            c["expected"] = outcome(&c);
            c
        })
        .collect();
    // Sanity: the generator exercises most reason codes and produces entrants.
    let text = serde_json::to_string(&cases).unwrap();
    for code in [
        "LATE",
        "NOT_DIRECT",
        "EXCLUDED",
        "TOO_YOUNG",
        "FEW_FOLLOWERS",
        "MISSING_TEXT",
        "NO_MEDIA",
        "NO_ADDRESS",
        "SUINS_UNRESOLVED",
        "DUP_ACCOUNT",
        "DUP_ADDRESS",
        "AI_FAIL",
        "OVER_CAP",
    ] {
        assert!(
            text.contains(&format!("\"{code}\"")),
            "generator never produced {code}"
        );
    }
    assert!(cases
        .iter()
        .all(|c| !c["expected"]["entrants"].as_array().unwrap().is_empty()));

    let doc = json!({"about": "Seeded random filter cases; outcomes recorded from enclave/chek-core. Checked by packages/core.", "cases": cases});
    let out = format!("{}\n", serde_json::to_string(&doc).unwrap());
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/filter-random.json"
    );
    if std::env::var("CHEK_WRITE_FIXTURES").is_ok() {
        std::fs::write(path, &out).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(path).unwrap(),
        out,
        "fixture out of date"
    );
}
