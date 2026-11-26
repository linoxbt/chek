#[test_only]
module chek::draw_tests;

use chek::campaign;
use sui::random::{Self, Random, RandomGenerator};
use sui::test_scenario::{Self as ts, Scenario};

fun with_generator(seed: vector<u8>): (Scenario, RandomGenerator) {
    let mut sc = ts::begin(@0x0);
    random::create_for_testing(sc.ctx());
    sc.next_tx(@0x0);
    let mut r = sc.take_shared<Random>();
    r.update_randomness_state_for_testing(0, seed, sc.ctx());
    let g = random::new_generator(&r, sc.ctx());
    ts::return_shared(r);
    (sc, g)
}

fun all_distinct_and_below(w: &vector<u32>, n: u32): bool {
    let len = w.length();
    let mut a = 0;
    while (a < len) {
        if (w[a] >= n) return false;
        let mut b = a + 1;
        while (b < len) {
            if (w[a] == w[b]) return false;
            b = b + 1;
        };
        a = a + 1;
    };
    true
}

#[test]
fun winners_are_distinct_and_in_range() {
    let (sc, mut g) = with_generator(x"0101010101010101010101010101010101010101010101010101010101010101");
    let ns = vector[1u32, 2, 3, 7, 100, 5000];
    let mut t = 0;
    while (t < ns.length()) {
        let n = ns[t];
        let mut k = 1;
        while (k <= 100 && k <= n) {
            let w = campaign::select_winners(&mut g, n, k);
            assert!(w.length() == (k as u64));
            assert!(all_distinct_and_below(&w, n));
            k = if (k < 10) k + 1 else k + 30;
        };
        t = t + 1;
    };
    sc.end();
}

#[test]
fun choosing_everyone_gives_a_permutation() {
    let (sc, mut g) = with_generator(x"0202020202020202020202020202020202020202020202020202020202020202");
    let w = campaign::select_winners(&mut g, 50, 50);
    assert!(all_distinct_and_below(&w, 50));
    sc.end();
}

/// k = 3 from n = 10, 6 000 draws: each index should win about 30% of draws (1 800 times).
/// The bound of ±150 is about 4.2 standard deviations.
#[test]
fun each_entrant_wins_at_the_expected_rate() {
    let (sc, mut g) = with_generator(x"0303030303030303030303030303030303030303030303030303030303030303");
    let mut counts = vector[0u64, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let mut d = 0;
    while (d < 6_000) {
        let w = campaign::select_winners(&mut g, 10, 3);
        let mut r = 0;
        while (r < 3) {
            *counts.borrow_mut(w[r] as u64) = counts[w[r] as u64] + 1;
            r = r + 1;
        };
        d = d + 1;
    };
    let mut i = 0;
    while (i < 10) {
        assert!(counts[i] >= 1_650 && counts[i] <= 1_950);
        i = i + 1;
    };
    sc.end();
}

/// All 6 orderings of 3 entrants should be about equally likely (1 000 of 6 000 each, ±130).
#[test]
fun every_ordering_is_equally_likely() {
    let (sc, mut g) = with_generator(x"0404040404040404040404040404040404040404040404040404040404040404");
    let mut counts = vector[0u64, 0, 0, 0, 0, 0, 0, 0, 0];
    let mut d = 0;
    while (d < 6_000) {
        let w = campaign::select_winners(&mut g, 3, 3);
        let key = (w[0] as u64) * 3 + (w[1] as u64);
        *counts.borrow_mut(key) = counts[key] + 1;
        d = d + 1;
    };
    // Valid (first, second) pairs: the six with first != second.
    let pairs = vector[1u64, 2, 3, 5, 6, 7];
    let mut p = 0;
    while (p < pairs.length()) {
        let c = counts[pairs[p]];
        assert!(c >= 870 && c <= 1_130);
        p = p + 1;
    };
    assert!(counts[0] == 0 && counts[4] == 0 && counts[8] == 0);
    sc.end();
}
