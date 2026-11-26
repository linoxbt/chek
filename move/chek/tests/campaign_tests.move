#[test_only]
module chek::campaign_tests;

use chek::campaign::{Self, Campaign, OrganizerCap};
use chek::config::{Self, AdminCap, Config};
use chek::enclave_app::{Self, CHEK, PcrAdmin};
use chek::snapshot::{Self, SnapshotPayload};
use chek::test_entrants;
use enclave::enclave::{Self, EnclaveConfig};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::random::{Self, Random};
use sui::sui::SUI;
use sui::test_scenario::{Self as ts, Scenario};

const SYSTEM: address = @0x0;
const ADMIN: address = @0xAD;
const ORG: address = @0xA11CE;
const OTHER: address = @0xB0B;
const FEES: address = @0xFEE5;

const T0: u64 = 1_764_000_000_000;
const MINUTE: u64 = 60_000;
const HOUR: u64 = 3_600_000;
const DAY: u64 = 86_400_000;
const CLOSE: u64 = 1_764_086_400_000; // T0 + 1 day
const X_EPOCH_MS: u64 = 1_288_834_974_657;

const COIN: u8 = 0;
const OBJECTS: u8 = 1;
const DRAW: u8 = 0;
const JUDGED: u8 = 1;

const S_OPEN: u8 = 1;
const S_COMMITTED: u8 = 2;
const S_DRAWN: u8 = 3;
const S_SETTLED: u8 = 4;
const S_EXPIRED: u8 = 5;
const S_CANCELLED: u8 = 6;

const RULES_HASH: vector<u8> = x"67318f313ecd20e925ffbdb179e8094e40b51daeca1ff0cdf0cd584ab764a694";
const SNAPSHOT_HASH: vector<u8> = x"5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
const TEST_PK: vector<u8> = x"ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c";

public struct Prize has key, store { id: UID }

public struct OtherPrize has key, store { id: UID }

// === Harness ===

fun begin(): (Scenario, Clock) {
    let mut sc = ts::begin(SYSTEM);
    random::create_for_testing(sc.ctx());
    sc.next_tx(SYSTEM);
    {
        let mut r = sc.take_shared<Random>();
        r.update_randomness_state_for_testing(
            0,
            x"1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f",
            sc.ctx(),
        );
        ts::return_shared(r);
    };
    sc.next_tx(ADMIN);
    config::init_for_testing(sc.ctx());
    enclave_app::init_for_testing(sc.ctx());
    sc.next_tx(ADMIN);
    {
        let mut admin = sc.take_from_sender<PcrAdmin>();
        enclave_app::create_config(&mut admin, b"chek".to_string(), x"01", x"02", x"03", sc.ctx());
        sc.return_to_sender(admin);
    };
    let mut clock = clock::create_for_testing(sc.ctx());
    clock.set_for_testing(T0);
    (sc, clock)
}

fun finish(sc: Scenario, clock: Clock) {
    clock.destroy_for_testing();
    sc.end();
}

fun post_at(t: u64): u64 { (t - X_EPOCH_MS) << 22 }

fun new_campaign<C>(
    sc: &mut Scenario,
    clock: &Clock,
    mode: u8,
    k: u16,
    closes_at: u64,
    prize_kind: u8,
): (Campaign<C>, OrganizerCap) {
    let cfg = sc.take_shared<Config>();
    let ec = sc.take_shared<EnclaveConfig<CHEK>>();
    let fee = coin::mint_for_testing<SUI>(cfg.fee_mist(), sc.ctx());
    let (c, cap) = campaign::create<C>(
        &cfg,
        &ec,
        fee,
        mode,
        k,
        closes_at,
        b"walrus-rules-blob",
        RULES_HASH,
        prize_kind,
        clock,
        sc.ctx(),
    );
    ts::return_shared(cfg);
    ts::return_shared(ec);
    (c, cap)
}

fun keep<C>(c: Campaign<C>, cap: OrganizerCap): ID {
    let id = object::id(&c);
    campaign::share(c);
    transfer::public_transfer(cap, ORG);
    id
}

/// A coin campaign funded with `amount` SUI, created by ORG.
fun coin_campaign(sc: &mut Scenario, clock: &Clock, mode: u8, k: u16, amount: u64): ID {
    sc.next_tx(ORG);
    let (mut c, cap) = new_campaign<SUI>(sc, clock, mode, k, CLOSE, COIN);
    if (amount > 0) campaign::fund_coin(&mut c, &cap, coin::mint_for_testing(amount, sc.ctx()));
    keep(c, cap)
}

/// An object campaign with `count` Prize objects deposited.
fun object_campaign(sc: &mut Scenario, clock: &Clock, k: u16, count: u16): ID {
    sc.next_tx(ORG);
    let (mut c, cap) = new_campaign<SUI>(sc, clock, DRAW, k, CLOSE, OBJECTS);
    let mut d = 0;
    while (d < count) {
        campaign::deposit_object(&mut c, &cap, Prize { id: object::new(sc.ctx()) });
        d = d + 1;
    };
    keep(c, cap)
}

fun take(sc: &Scenario, id: ID): Campaign<SUI> {
    sc.take_shared_by_id<Campaign<SUI>>(id)
}

fun take_cap(sc: &Scenario, id: ID): OrganizerCap {
    let ids = ts::ids_for_sender<OrganizerCap>(sc);
    let mut t = 0;
    while (t < ids.length()) {
        let cap = sc.take_from_sender_by_id<OrganizerCap>(ids[t]);
        if (campaign::cap_campaign_id(&cap) == id) return cap;
        sc.return_to_sender(cap);
        t = t + 1;
    };
    abort 999
}

fun open_at(sc: &mut Scenario, clock: &mut Clock, id: ID, now: u64, posted: u64) {
    clock.set_for_testing(now);
    sc.next_tx(ORG);
    let mut c = take(sc, id);
    let cap = take_cap(sc, id);
    campaign::open(&mut c, &cap, post_at(posted), clock);
    sc.return_to_sender(cap);
    ts::return_shared(c);
}

fun open(sc: &mut Scenario, clock: &mut Clock, id: ID) {
    open_at(sc, clock, id, T0 + MINUTE, T0 + 1000);
}

fun payload_with(
    c: &Campaign<SUI>,
    n: u32,
    replies_seen: u32,
    fetched_at: u64,
    root: vector<u8>,
): SnapshotPayload {
    snapshot::new(
        object::id(c),
        campaign::post_id(c),
        campaign::rules_hash(c),
        campaign::opened_at(c),
        campaign::closes_at(c),
        campaign::mode(c),
        campaign::k(c),
        campaign::max_entrants(c),
        campaign::max_judged(c),
        campaign::max_replies_read(c),
        fetched_at,
        n,
        replies_seen,
        root,
        SNAPSHOT_HASH,
        true,
        44196397,
        1,
    )
}

fun payload(c: &Campaign<SUI>, n: u32): SnapshotPayload {
    payload_with(c, n, n + 7, CLOSE + 30 * MINUTE, test_entrants::root(n as u64))
}

/// Commits `p` at time `now` through the post-signature path.
fun commit_payload(sc: &mut Scenario, clock: &mut Clock, c: &mut Campaign<SUI>, p: SnapshotPayload, now: u64) {
    clock.set_for_testing(now);
    let version = campaign::enclave_version(c);
    campaign::commit_verified_for_testing(c, object::id_from_address(@0xE1), version, p, b"walrus-snapshot", clock, sc.ctx());
}

fun commit(sc: &mut Scenario, clock: &mut Clock, id: ID, n: u32) {
    sc.next_tx(OTHER);
    let mut c = take(sc, id);
    let p = payload(&c, n);
    commit_payload(sc, clock, &mut c, p, CLOSE + HOUR);
    ts::return_shared(c);
}

fun draw(sc: &mut Scenario, id: ID) {
    sc.next_tx(OTHER);
    let r = sc.take_shared<Random>();
    let mut g = random::new_generator(&r, sc.ctx());
    let mut c = take(sc, id);
    campaign::draw_for_testing(&mut c, &mut g);
    ts::return_shared(c);
    ts::return_shared(r);
}

fun pay_all_coin(sc: &mut Scenario, id: ID, n: u64) {
    sc.next_tx(OTHER);
    let mut c = take(sc, id);
    let winners = campaign::winners(&c);
    let mut rank = 0;
    while (rank < winners.length()) {
        let i = winners[rank];
        campaign::distribute_coin(
            &mut c,
            rank as u16,
            i,
            test_entrants::author(i),
            test_entrants::addr(i),
            test_entrants::proof(n, i),
            sc.ctx(),
        );
        rank = rank + 1;
    };
    ts::return_shared(c);
}

fun pay_all_objects(sc: &mut Scenario, id: ID, n: u64) {
    sc.next_tx(OTHER);
    let mut c = take(sc, id);
    let winners = campaign::winners(&c);
    let mut rank = 0;
    while (rank < winners.length()) {
        let i = winners[rank];
        campaign::distribute_object<SUI, Prize>(
            &mut c,
            rank as u16,
            i,
            test_entrants::author(i),
            test_entrants::addr(i),
            test_entrants::proof(n, i),
        );
        rank = rank + 1;
    };
    ts::return_shared(c);
}

fun status(sc: &mut Scenario, id: ID): u8 {
    sc.next_tx(OTHER);
    let c = take(sc, id);
    let s = campaign::status(&c);
    ts::return_shared(c);
    s
}

fun received_sui(sc: &mut Scenario, who: address): u64 {
    sc.next_tx(who);
    let coin = sc.take_from_sender<Coin<SUI>>();
    let v = coin.value();
    sc.return_to_sender(coin);
    v
}

// === Full lifecycles ===

#[test]
fun coin_draw_pays_every_winner_and_settles() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 3, 300);
    open(&mut sc, &mut clock, id);
    assert!(status(&mut sc, id) == S_OPEN);
    commit(&mut sc, &mut clock, id, 5);
    assert!(status(&mut sc, id) == S_COMMITTED);
    draw(&mut sc, id);

    sc.next_tx(OTHER);
    let c = take(&sc, id);
    let winners = campaign::winners(&c);
    assert!(campaign::status(&c) == S_DRAWN);
    assert!(winners.length() == 3);
    assert!(winners[0] != winners[1] && winners[0] != winners[2] && winners[1] != winners[2]);
    assert!(winners[0] < 5 && winners[1] < 5 && winners[2] < 5);
    assert!(campaign::per_winner(&c) == 100);
    assert!(!campaign::unused_pending(&c));
    ts::return_shared(c);

    pay_all_coin(&mut sc, id, 5);
    sc.next_tx(OTHER);
    let c = take(&sc, id);
    assert!(campaign::status(&c) == S_SETTLED);
    assert!(campaign::pool_value(&c) == 0);
    ts::return_shared(c);
    assert!(received_sui(&mut sc, test_entrants::addr(winners[0])) == 100);
    finish(sc, clock);
}

#[test]
fun object_draw_sends_each_rank_its_slot() {
    let (mut sc, mut clock) = begin();
    let id = object_campaign(&mut sc, &clock, 2, 2);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 13);
    draw(&mut sc, id);
    pay_all_objects(&mut sc, id, 13);
    assert!(status(&mut sc, id) == S_SETTLED);

    sc.next_tx(OTHER);
    let c = take(&sc, id);
    let first = campaign::winners(&c)[0];
    ts::return_shared(c);
    sc.next_tx(test_entrants::addr(first));
    let prize = sc.take_from_sender<Prize>();
    sc.return_to_sender(prize);
    finish(sc, clock);
}

// === AC1: creation limits and fee ===

#[test]
fun create_accepts_k_1_and_100_and_close_bounds() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, T0 + 10 * MINUTE, COIN);
    keep(c, cap);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, JUDGED, 100, T0 + 30 * DAY, COIN);
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun create_rejects_k_0() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 0, CLOSE, COIN);
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun create_rejects_k_101() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 101, CLOSE, COIN);
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun create_rejects_close_too_soon() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, T0 + 10 * MINUTE - 1, COIN);
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun create_rejects_close_too_late() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, T0 + 30 * DAY + 1, COIN);
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun create_rejects_unknown_mode() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<SUI>(&mut sc, &clock, 2, 1, CLOSE, COIN);
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun create_rejects_object_prize_with_non_sui_type() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (c, cap) = new_campaign<Prize>(&mut sc, &clock, DRAW, 1, CLOSE, OBJECTS);
    campaign::share(c);
    transfer::public_transfer(cap, ORG);
    finish(sc, clock);
}

#[test]
fun create_sends_the_exact_fee_to_the_recipient() {
    let (mut sc, clock) = begin();
    sc.next_tx(ADMIN);
    {
        let mut cfg = sc.take_shared<Config>();
        let cap = sc.take_from_sender<AdminCap>();
        config::set_fee(&mut cfg, &cap, 1_000, FEES);
        sc.return_to_sender(cap);
        ts::return_shared(cfg);
    };
    coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    assert!(received_sui(&mut sc, FEES) == 1_000);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 3, location = chek::campaign)]
fun create_rejects_fee_one_mist_short() {
    let (mut sc, clock) = begin();
    sc.next_tx(ADMIN);
    {
        let mut cfg = sc.take_shared<Config>();
        let cap = sc.take_from_sender<AdminCap>();
        config::set_fee(&mut cfg, &cap, 1_000, FEES);
        sc.return_to_sender(cap);
        ts::return_shared(cfg);
    };
    sc.next_tx(ORG);
    let cfg = sc.take_shared<Config>();
    let ec = sc.take_shared<EnclaveConfig<CHEK>>();
    let fee = coin::mint_for_testing<SUI>(999, sc.ctx());
    let (c, cap) = campaign::create<SUI>(&cfg, &ec, fee, DRAW, 1, CLOSE, b"b", RULES_HASH, COIN, &clock, sc.ctx());
    keep(c, cap);
    ts::return_shared(cfg);
    ts::return_shared(ec);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 1, location = chek::campaign)]
fun create_rejects_when_paused() {
    let (mut sc, clock) = begin();
    sc.next_tx(ADMIN);
    {
        let mut cfg = sc.take_shared<Config>();
        let cap = sc.take_from_sender<AdminCap>();
        config::set_paused(&mut cfg, &cap, true);
        sc.return_to_sender(cap);
        ts::return_shared(cfg);
    };
    coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    finish(sc, clock);
}

// === AC2: funding ===

#[test, expected_failure(abort_code = 7, location = chek::campaign)]
fun open_rejects_pool_not_multiple_of_k() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 3, 10);
    open(&mut sc, &mut clock, id);
    finish(sc, clock);
}

#[test]
fun open_accepts_pool_multiple_of_k() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 3, 9);
    open(&mut sc, &mut clock, id);
    assert!(status(&mut sc, id) == S_OPEN);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 7, location = chek::campaign)]
fun open_rejects_empty_pool() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 0);
    open(&mut sc, &mut clock, id);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 7, location = chek::campaign)]
fun open_rejects_missing_objects() {
    let (mut sc, mut clock) = begin();
    let id = object_campaign(&mut sc, &clock, 2, 1);
    open(&mut sc, &mut clock, id);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 6, location = chek::campaign)]
fun deposit_rejects_more_than_k_objects() {
    let (mut sc, clock) = begin();
    object_campaign(&mut sc, &clock, 3, 4);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 6, location = chek::campaign)]
fun deposit_rejects_a_second_object_type() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (mut c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 2, CLOSE, OBJECTS);
    campaign::deposit_object(&mut c, &cap, Prize { id: object::new(sc.ctx()) });
    campaign::deposit_object(&mut c, &cap, OtherPrize { id: object::new(sc.ctx()) });
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 6, location = chek::campaign)]
fun fund_coin_rejects_object_campaign() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (mut c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, CLOSE, OBJECTS);
    campaign::fund_coin(&mut c, &cap, coin::mint_for_testing(1, sc.ctx()));
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 6, location = chek::campaign)]
fun deposit_rejects_coin_campaign() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (mut c, cap) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, CLOSE, COIN);
    campaign::deposit_object(&mut c, &cap, Prize { id: object::new(sc.ctx()) });
    keep(c, cap);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 5, location = chek::campaign)]
fun fund_rejects_another_campaigns_cap() {
    let (mut sc, clock) = begin();
    sc.next_tx(ORG);
    let (mut a, cap_a) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, CLOSE, COIN);
    let (b, cap_b) = new_campaign<SUI>(&mut sc, &clock, DRAW, 1, CLOSE, COIN);
    campaign::fund_coin(&mut a, &cap_b, coin::mint_for_testing(1, sc.ctx()));
    keep(a, cap_a);
    keep(b, cap_b);
    finish(sc, clock);
}

// === AC3: cancel ===

#[test]
fun cancel_returns_the_exact_coin_prize() {
    let (mut sc, clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 2, 500);
    sc.next_tx(ORG);
    let mut c = take(&sc, id);
    let cap = take_cap(&sc, id);
    campaign::cancel(&mut c, &cap, sc.ctx());
    assert!(campaign::status(&c) == S_CANCELLED);
    assert!(campaign::pool_value(&c) == 0);
    sc.return_to_sender(cap);
    ts::return_shared(c);
    assert!(received_sui(&mut sc, ORG) == 500);
    finish(sc, clock);
}

#[test]
fun cancel_then_refund_returns_object_prizes() {
    let (mut sc, clock) = begin();
    let id = object_campaign(&mut sc, &clock, 2, 2);
    sc.next_tx(ORG);
    let mut c = take(&sc, id);
    let cap = take_cap(&sc, id);
    campaign::cancel(&mut c, &cap, sc.ctx());
    sc.return_to_sender(cap);
    campaign::refund_objects<SUI, Prize>(&mut c, 1);
    campaign::refund_objects<SUI, Prize>(&mut c, 5);
    ts::return_shared(c);
    sc.next_tx(ORG);
    assert!(ts::ids_for_sender<Prize>(&sc).length() == 2);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 15, location = chek::campaign)]
fun refund_with_nothing_left_aborts() {
    let (mut sc, clock) = begin();
    let id = object_campaign(&mut sc, &clock, 1, 1);
    sc.next_tx(ORG);
    let mut c = take(&sc, id);
    let cap = take_cap(&sc, id);
    campaign::cancel(&mut c, &cap, sc.ctx());
    sc.return_to_sender(cap);
    campaign::refund_objects<SUI, Prize>(&mut c, 5);
    campaign::refund_objects<SUI, Prize>(&mut c, 5);
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun cancel_after_open_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    sc.next_tx(ORG);
    let mut c = take(&sc, id);
    let cap = take_cap(&sc, id);
    campaign::cancel(&mut c, &cap, sc.ctx());
    sc.return_to_sender(cap);
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun fund_after_open_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    sc.next_tx(ORG);
    let mut c = take(&sc, id);
    let cap = take_cap(&sc, id);
    campaign::fund_coin(&mut c, &cap, coin::mint_for_testing(5, sc.ctx()));
    sc.return_to_sender(cap);
    ts::return_shared(c);
    finish(sc, clock);
}

// === AC4 / AC23: opening ===

#[test, expected_failure(abort_code = 8, location = chek::campaign)]
fun open_at_close_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open_at(&mut sc, &mut clock, id, CLOSE, T0 + 1000);
    finish(sc, clock);
}

#[test]
fun open_one_ms_before_close_succeeds_and_starts_window_at_post_time() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open_at(&mut sc, &mut clock, id, CLOSE - 1, T0 + 5 * MINUTE);
    sc.next_tx(OTHER);
    let c = take(&sc, id);
    assert!(campaign::opened_at(&c) == T0 + 5 * MINUTE);
    assert!(campaign::post_time_ms(campaign::post_id(&c)) == T0 + 5 * MINUTE);
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun open_rejects_post_older_than_campaign() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open_at(&mut sc, &mut clock, id, T0 + MINUTE, T0 - 1);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 2, location = chek::campaign)]
fun open_rejects_post_from_the_future() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open_at(&mut sc, &mut clock, id, T0 + MINUTE, T0 + MINUTE + 1);
    finish(sc, clock);
}

// === AC6: fetch and commit windows ===

fun commit_at(fetched_at: u64, now: u64) {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let p = payload_with(&c, 5, 9, fetched_at, test_entrants::root(5));
    commit_payload(&mut sc, &mut clock, &mut c, p, now);
    assert!(campaign::status(&c) == S_COMMITTED);
    ts::return_shared(c);
    finish(sc, clock);
}

#[test]
fun commit_accepts_window_edges() {
    commit_at(CLOSE, CLOSE);
    commit_at(CLOSE + 6 * HOUR, CLOSE + 48 * HOUR);
}

#[test, expected_failure(abort_code = 11, location = chek::campaign)]
fun commit_rejects_fetch_before_close() {
    commit_at(CLOSE - 1, CLOSE + HOUR);
}

#[test, expected_failure(abort_code = 11, location = chek::campaign)]
fun commit_rejects_fetch_after_six_hours() {
    commit_at(CLOSE + 6 * HOUR + 1, CLOSE + 7 * HOUR);
}

#[test, expected_failure(abort_code = 11, location = chek::campaign)]
fun commit_rejects_after_48_hours() {
    commit_at(CLOSE + HOUR, CLOSE + 48 * HOUR + 1);
}

#[test, expected_failure(abort_code = 11, location = chek::campaign)]
fun commit_rejects_fetch_time_in_the_future() {
    commit_at(CLOSE + 2 * HOUR, CLOSE + HOUR);
}

// === AC7: payload binding, signer, enclave version ===

fun commit_tampered(field: u8) {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 3, 9);
    let other = coin_campaign(&mut sc, &clock, DRAW, 3, 9);
    open(&mut sc, &mut clock, id);
    open(&mut sc, &mut clock, other);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let o = take(&sc, other);
    let good = payload(&c, 5);
    let fetched = snapshot::fetched_at(&good);
    let root = snapshot::root(&good);
    let p = if (field == 0) {
        payload(&o, 5) // a valid payload for another campaign
    } else if (field == 1) {
        snapshot::new(object::id(&c), campaign::post_id(&c) + 1, campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 5000, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 2) {
        snapshot::new(object::id(&c), campaign::post_id(&c), SNAPSHOT_HASH, campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 5000, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 3) {
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c) - 1, campaign::closes_at(&c), DRAW, 3, 5000, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 4) {
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c) + 1, DRAW, 3, 5000, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 5) {
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), JUDGED, 3, 5000, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 6) {
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 2, 5000, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 7) {
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 4999, 1000, 20000, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 8) {
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 5000, 1000, 19999, fetched, 5, 9, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 9) {
        // more entrants than replies seen
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 5000, 1000, 20000, fetched, 5, 4, root, SNAPSHOT_HASH, true, 1, 1)
    } else if (field == 10) {
        // more replies seen than the read cap
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 5000, 1000, 20000, fetched, 5, 20001, root, SNAPSHOT_HASH, true, 1, 1)
    } else {
        // root of the wrong length
        snapshot::new(object::id(&c), campaign::post_id(&c), campaign::rules_hash(&c), campaign::opened_at(&c), campaign::closes_at(&c), DRAW, 3, 5000, 1000, 20000, fetched, 5, 9, x"00", SNAPSHOT_HASH, true, 1, 1)
    };
    commit_payload(&mut sc, &mut clock, &mut c, p, CLOSE + HOUR);
    ts::return_shared(c);
    ts::return_shared(o);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_payload_for_another_campaign() { commit_tampered(0) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_post() { commit_tampered(1) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_rules_hash() { commit_tampered(2) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_opened_at() { commit_tampered(3) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_closes_at() { commit_tampered(4) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_mode() { commit_tampered(5) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_k() { commit_tampered(6) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_entrant_cap() { commit_tampered(7) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_other_read_cap() { commit_tampered(8) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_more_entrants_than_replies() { commit_tampered(9) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_replies_over_read_cap() { commit_tampered(10) }

#[test, expected_failure(abort_code = 10, location = chek::campaign)]
fun commit_rejects_short_root() { commit_tampered(11) }

#[test, expected_failure(abort_code = 9, location = chek::campaign)]
fun commit_rejects_a_bad_signature() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    clock.set_for_testing(CLOSE + HOUR);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let e = enclave::new_enclave_for_testing<CHEK>(TEST_PK, sc.ctx());
    let p = payload(&c, 5);
    let sig = x"fc1583d7db7a7a5d91f475ade340f02e7ec0a09e6f3a4b2786d99bca32bab9ffd6750f48db7b534e00c4d0d49ef0a3c8371c8f411ce80fae2041fe76d5754403";
    campaign::commit_snapshot(&mut c, &e, p, sig, b"blob", &clock, sc.ctx());
    e.destroy();
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 16, location = chek::campaign)]
fun commit_rejects_an_enclave_from_another_config_version() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    clock.set_for_testing(CLOSE + HOUR);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let p = payload(&c, 5);
    let newer = campaign::enclave_version(&c) + 1;
    campaign::commit_verified_for_testing(&mut c, object::id_from_address(@0xE2), newer, p, b"blob", &clock, sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test]
fun campaigns_pin_the_enclave_version_current_at_creation() {
    let (mut sc, clock) = begin();
    let before = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    sc.next_tx(ADMIN);
    {
        let admin = sc.take_from_sender<PcrAdmin>();
        let mut ec = sc.take_shared<EnclaveConfig<CHEK>>();
        enclave_app::update_pcrs(&admin, &mut ec, x"04", x"05", x"06");
        ts::return_shared(ec);
        sc.return_to_sender(admin);
    };
    let after = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    sc.next_tx(OTHER);
    let a = take(&sc, before);
    let b = take(&sc, after);
    assert!(campaign::enclave_version(&a) == 0);
    assert!(campaign::enclave_version(&b) == 1);
    ts::return_shared(a);
    ts::return_shared(b);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun commit_twice_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 5);
    commit(&mut sc, &mut clock, id, 5);
    finish(sc, clock);
}

// === AC8: no entrants, fewer entrants than winners ===

#[test]
fun no_entrants_refunds_coins_at_commit() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 2, 40);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 0);
    sc.next_tx(OTHER);
    let c = take(&sc, id);
    assert!(campaign::status(&c) == S_SETTLED);
    assert!(campaign::pool_value(&c) == 0);
    ts::return_shared(c);
    assert!(received_sui(&mut sc, ORG) == 40);
    finish(sc, clock);
}

#[test]
fun no_entrants_lets_anyone_refund_objects_to_the_organizer() {
    let (mut sc, mut clock) = begin();
    let id = object_campaign(&mut sc, &clock, 3, 3);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 0);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::refund_objects<SUI, Prize>(&mut c, 100);
    ts::return_shared(c);
    sc.next_tx(ORG);
    assert!(ts::ids_for_sender<Prize>(&sc).length() == 3);
    finish(sc, clock);
}

#[test]
fun fewer_entrants_than_winners_splits_pool_and_returns_remainder() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 3, 9);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 2);
    draw(&mut sc, id);
    sc.next_tx(OTHER);
    let c = take(&sc, id);
    assert!(campaign::winners(&c).length() == 2);
    assert!(campaign::per_winner(&c) == 4);
    assert!(campaign::remainder(&c) == 1);
    ts::return_shared(c);
    pay_all_coin(&mut sc, id, 2);
    assert!(status(&mut sc, id) == S_DRAWN);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::reclaim_unused(&mut c, sc.ctx());
    assert!(campaign::status(&c) == S_SETTLED);
    assert!(campaign::pool_value(&c) == 0);
    ts::return_shared(c);
    assert!(received_sui(&mut sc, ORG) == 1);
    finish(sc, clock);
}

#[test]
fun fewer_entrants_than_object_prizes_returns_unowed_slots() {
    let (mut sc, mut clock) = begin();
    let id = object_campaign(&mut sc, &clock, 3, 3);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 2);
    draw(&mut sc, id);
    pay_all_objects(&mut sc, id, 2);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    assert!(campaign::unused_pending(&c));
    campaign::reclaim_unused_objects<SUI, Prize>(&mut c, 10);
    assert!(campaign::status(&c) == S_SETTLED);
    ts::return_shared(c);
    sc.next_tx(ORG);
    assert!(ts::ids_for_sender<Prize>(&sc).length() == 1);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 15, location = chek::campaign)]
fun reclaim_with_nothing_unused_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 3, 9);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 5);
    draw(&mut sc, id);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::reclaim_unused(&mut c, sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test]
fun prize_is_conserved_for_every_k_and_n() {
    let sizes = vector[0, 1, 2, 3, 5];
    let mut k = 1;
    while (k <= 3) {
        let mut s = 0;
        while (s < sizes.length()) {
            let n = sizes[s];
            let (mut sc, mut clock) = begin();
            let pool = 7 * (k as u64);
            let id = coin_campaign(&mut sc, &clock, DRAW, k, pool);
            open(&mut sc, &mut clock, id);
            commit(&mut sc, &mut clock, id, n);
            if (n > 0) {
                draw(&mut sc, id);
                sc.next_tx(OTHER);
                let c = take(&sc, id);
                let k_eff = campaign::winners(&c).length();
                let expected = if ((n as u64) < (k as u64)) (n as u64) else (k as u64);
                assert!(k_eff == expected);
                assert!(campaign::per_winner(&c) * k_eff + campaign::remainder(&c) == pool);
                let pending = campaign::unused_pending(&c);
                ts::return_shared(c);
                pay_all_coin(&mut sc, id, n as u64);
                if (pending) {
                    sc.next_tx(OTHER);
                    let mut c = take(&sc, id);
                    campaign::reclaim_unused(&mut c, sc.ctx());
                    ts::return_shared(c);
                };
            };
            sc.next_tx(OTHER);
            let c = take(&sc, id);
            assert!(campaign::status(&c) == S_SETTLED);
            assert!(campaign::pool_value(&c) == 0);
            ts::return_shared(c);
            finish(sc, clock);
            s = s + 1;
        };
        k = k + 1;
    };
}

// === AC9: draw once ===

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun draw_twice_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 5);
    draw(&mut sc, id);
    draw(&mut sc, id);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun draw_before_commit_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    draw(&mut sc, id);
    finish(sc, clock);
}

// === AC11: payouts go only to winners, once ===

fun drawn_campaign(sc: &mut Scenario, clock: &mut Clock): ID {
    let id = coin_campaign(sc, clock, DRAW, 2, 10);
    open(sc, clock, id);
    commit(sc, clock, id, 13);
    draw(sc, id);
    id
}

#[test, expected_failure(abort_code = 13, location = chek::campaign)]
fun distribute_rejects_a_non_winner() {
    let (mut sc, mut clock) = begin();
    let id = drawn_campaign(&mut sc, &mut clock);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let w = campaign::winners(&c);
    let mut loser = 0;
    while (loser == w[0] || loser == w[1]) loser = loser + 1;
    // A valid proof, but for an entrant who did not win rank 0.
    campaign::distribute_coin(&mut c, 0, loser, test_entrants::author(loser), test_entrants::addr(loser), test_entrants::proof(13, loser), sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 13, location = chek::campaign)]
fun distribute_rejects_another_address() {
    let (mut sc, mut clock) = begin();
    let id = drawn_campaign(&mut sc, &mut clock);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let i = campaign::winners(&c)[0];
    campaign::distribute_coin(&mut c, 0, i, test_entrants::author(i), OTHER, test_entrants::proof(13, i), sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 13, location = chek::campaign)]
fun distribute_rejects_rank_out_of_range() {
    let (mut sc, mut clock) = begin();
    let id = drawn_campaign(&mut sc, &mut clock);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let i = campaign::winners(&c)[0];
    campaign::distribute_coin(&mut c, 2, i, test_entrants::author(i), test_entrants::addr(i), test_entrants::proof(13, i), sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 14, location = chek::campaign)]
fun distribute_twice_aborts() {
    let (mut sc, mut clock) = begin();
    let id = drawn_campaign(&mut sc, &mut clock);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let i = campaign::winners(&c)[0];
    campaign::distribute_coin(&mut c, 0, i, test_entrants::author(i), test_entrants::addr(i), test_entrants::proof(13, i), sc.ctx());
    campaign::distribute_coin(&mut c, 0, i, test_entrants::author(i), test_entrants::addr(i), test_entrants::proof(13, i), sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun distribute_before_draw_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 5);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::distribute_coin(&mut c, 0, 0, test_entrants::author(0), test_entrants::addr(0), test_entrants::proof(5, 0), sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 6, location = chek::campaign)]
fun distribute_object_of_the_wrong_type_aborts() {
    let (mut sc, mut clock) = begin();
    let id = object_campaign(&mut sc, &clock, 1, 1);
    open(&mut sc, &mut clock, id);
    commit(&mut sc, &mut clock, id, 5);
    draw(&mut sc, id);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    let i = campaign::winners(&c)[0];
    campaign::distribute_object<SUI, OtherPrize>(&mut c, 0, i, test_entrants::author(i), test_entrants::addr(i), test_entrants::proof(5, i));
    ts::return_shared(c);
    finish(sc, clock);
}

// === AC12: expiry ===

#[test, expected_failure(abort_code = 12, location = chek::campaign)]
fun expire_at_48_hours_is_too_early() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    clock.set_for_testing(CLOSE + 48 * HOUR);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::expire(&mut c, &clock, sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test]
fun expire_after_48_hours_refunds() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    clock.set_for_testing(CLOSE + 48 * HOUR + 1);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::expire(&mut c, &clock, sc.ctx());
    assert!(campaign::status(&c) == S_EXPIRED);
    ts::return_shared(c);
    assert!(received_sui(&mut sc, ORG) == 5);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun expire_a_draft_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    clock.set_for_testing(CLOSE + 49 * HOUR);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::expire(&mut c, &clock, sc.ctx());
    ts::return_shared(c);
    finish(sc, clock);
}

#[test, expected_failure(abort_code = 4, location = chek::campaign)]
fun commit_after_expiry_aborts() {
    let (mut sc, mut clock) = begin();
    let id = coin_campaign(&mut sc, &clock, DRAW, 1, 5);
    open(&mut sc, &mut clock, id);
    clock.set_for_testing(CLOSE + 49 * HOUR);
    sc.next_tx(OTHER);
    let mut c = take(&sc, id);
    campaign::expire(&mut c, &clock, sc.ctx());
    ts::return_shared(c);
    commit(&mut sc, &mut clock, id, 5);
    finish(sc, clock);
}

// === AC20: config changes leave existing campaigns alone ===

#[test]
fun config_changes_do_not_touch_existing_campaigns() {
    let (mut sc, clock) = begin();
    let id = coin_campaign(&mut sc, &clock, JUDGED, 1, 5);
    sc.next_tx(ADMIN);
    {
        let mut cfg = sc.take_shared<Config>();
        let cap = sc.take_from_sender<AdminCap>();
        config::set_limits(&mut cfg, &cap, 100, 50, 200);
        config::set_fee(&mut cfg, &cap, 7, FEES);
        sc.return_to_sender(cap);
        ts::return_shared(cfg);
    };
    sc.next_tx(OTHER);
    let c = take(&sc, id);
    assert!(campaign::max_entrants(&c) == 5_000);
    assert!(campaign::max_judged(&c) == 1_000);
    assert!(campaign::max_replies_read(&c) == 20_000);
    ts::return_shared(c);
    finish(sc, clock);
}
