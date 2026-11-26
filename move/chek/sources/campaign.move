/// A Chek giveaway: prize escrow, lifecycle, snapshot commit, draw and payouts (spec sections 8,
/// 10 and 13). Nobody, including the Chek admin, can change a campaign's rules, prize, entrant
/// list or winners once it is open, and every step after opening can be triggered by anyone.
module chek::campaign;

use chek::config::Config;
use chek::enclave_app::CHEK;
use chek::merkle;
use chek::snapshot::{Self, SnapshotPayload};
use enclave::enclave::{Enclave, EnclaveConfig};
use std::type_name::{Self, TypeName};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::dynamic_object_field as dof;
use sui::event;
use sui::random::{Self, Random, RandomGenerator};
use sui::sui::SUI;

// === Errors (spec section 13) ===

const EPaused: u64 = 1;
const EBadParam: u64 = 2;
const EWrongFee: u64 = 3;
const EWrongState: u64 = 4;
const ENotOrganizer: u64 = 5;
const EWrongPrize: u64 = 6;
const ENotFunded: u64 = 7;
const EClosed: u64 = 8;
const EBadSig: u64 = 9;
const EMismatch: u64 = 10;
const EWindow: u64 = 11;
const ETooEarly: u64 = 12;
const EBadProof: u64 = 13;
const EPaid: u64 = 14;
const ENothingUnused: u64 = 15;
const EWrongEnclave: u64 = 16;

// === Constants ===

const MODE_DRAW: u8 = 0;
const MODE_JUDGED: u8 = 1;

const STATUS_DRAFT: u8 = 0;
const STATUS_OPEN: u8 = 1;
const STATUS_COMMITTED: u8 = 2;
const STATUS_DRAWN: u8 = 3;
const STATUS_SETTLED: u8 = 4;
const STATUS_EXPIRED: u8 = 5;
const STATUS_CANCELLED: u8 = 6;

const PRIZE_COIN: u8 = 0;
const PRIZE_OBJECTS: u8 = 1;

const K_MAX: u16 = 100;
const CLOSE_MIN_MS: u64 = 600_000; // 10 minutes
const CLOSE_MAX_MS: u64 = 2_592_000_000; // 30 days
const FETCH_WINDOW_MS: u64 = 21_600_000; // 6 hours (MD12)
const COMMIT_WINDOW_MS: u64 = 172_800_000; // 48 hours (MD12)

/// X post IDs are snowflakes: (id >> 22) is milliseconds since this epoch.
const X_EPOCH_MS: u64 = 1_288_834_974_657;

// === Objects ===

public struct OrganizerCap has key, store {
    id: UID,
    campaign_id: ID,
}

public struct SnapshotRef has copy, drop, store {
    enclave_id: ID,
    fetched_at: u64,
    n: u32,
    replies_seen: u32,
    root: vector<u8>,
    snapshot_hash: vector<u8>,
    blob_id: vector<u8>,
    linked: bool,
    post_author_id: u64,
    request_counter: u64,
}

/// Dynamic object field key of the object prize for `rank`, in deposit order.
public struct Slot has copy, drop, store {
    rank: u16,
}

/// `C` is the coin type of a coin prize; object-prize campaigns use SUI and keep `pool` empty.
public struct Campaign<phantom C> has key {
    id: UID,
    organizer: address,
    mode: u8,
    status: u8,
    k: u16,
    created_at: u64,
    closes_at: u64,
    rules_blob: vector<u8>,
    rules_hash: vector<u8>,
    post_id: u64,
    /// The post's own creation time, decoded from its ID by `open`; the entry window starts here.
    opened_at: u64,
    prize_kind: u8,
    prize_type: Option<TypeName>,
    pool: Balance<C>,
    deposited: u16,
    per_winner: u64,
    remainder: u64,
    /// Set by `draw` while a coin remainder or unowed object slots wait to go back to the organizer.
    unused_pending: bool,
    max_entrants: u32,
    max_judged: u32,
    max_replies_read: u32,
    enclave_version: u64,
    snapshot: Option<SnapshotRef>,
    /// Entrant indices by rank, set by `draw`.
    winners: vector<u32>,
    paid: vector<bool>,
}

// === Events ===

public struct Created has copy, drop {
    campaign_id: ID,
    organizer: address,
    mode: u8,
    k: u16,
    closes_at: u64,
    prize_kind: u8,
    rules_blob: vector<u8>,
    rules_hash: vector<u8>,
    enclave_version: u64,
}

public struct Funded has copy, drop {
    campaign_id: ID,
    amount: u64,
    objects: u16,
}

public struct Cancelled has copy, drop {
    campaign_id: ID,
}

public struct Opened has copy, drop {
    campaign_id: ID,
    post_id: u64,
    opened_at: u64,
}

public struct SnapshotCommitted has copy, drop {
    campaign_id: ID,
    enclave_id: ID,
    n: u32,
    replies_seen: u32,
    root: vector<u8>,
    snapshot_hash: vector<u8>,
    blob_id: vector<u8>,
    linked: bool,
    request_counter: u64,
}

public struct Expired has copy, drop {
    campaign_id: ID,
}

public struct Drawn has copy, drop {
    campaign_id: ID,
    winners: vector<u32>,
}

public struct Paid has copy, drop {
    campaign_id: ID,
    rank: u16,
    to: address,
    amount: u64,
    object_id: Option<ID>,
}

/// Prize returned to the organizer: cancel, expiry, no entrants, or unused after the draw.
public struct Reclaimed has copy, drop {
    campaign_id: ID,
    to: address,
    amount: u64,
    objects: u16,
}

// === Create and fund (DRAFT) ===

/// Creates a DRAFT campaign. The caller funds it and must pass it to `share` in the same
/// transaction: Campaign has no `store` or `drop`, so it cannot be kept or discarded.
public fun create<C>(
    cfg: &Config,
    enclave_config: &EnclaveConfig<CHEK>,
    fee: Coin<SUI>,
    mode: u8,
    k: u16,
    closes_at: u64,
    rules_blob: vector<u8>,
    rules_hash: vector<u8>,
    prize_kind: u8,
    clock: &Clock,
    ctx: &mut TxContext,
): (Campaign<C>, OrganizerCap) {
    assert!(!cfg.paused(), EPaused);
    assert!(fee.value() == cfg.fee_mist(), EWrongFee);
    assert!(mode == MODE_DRAW || mode == MODE_JUDGED, EBadParam);
    assert!(prize_kind == PRIZE_COIN || prize_kind == PRIZE_OBJECTS, EBadParam);
    assert!(
        prize_kind == PRIZE_COIN || type_name::get<C>() == type_name::get<SUI>(),
        EBadParam,
    );
    assert!(k >= 1 && k <= K_MAX, EBadParam);
    let now = clock.timestamp_ms();
    assert!(closes_at >= now + CLOSE_MIN_MS && closes_at <= now + CLOSE_MAX_MS, EBadParam);
    assert!(rules_hash.length() == 32 && !rules_blob.is_empty(), EBadParam);

    if (fee.value() == 0) {
        fee.destroy_zero();
    } else {
        transfer::public_transfer(fee, cfg.fee_recipient());
    };

    let enclave_version = enclave_config.version();
    let c = Campaign<C> {
        id: object::new(ctx),
        organizer: ctx.sender(),
        mode,
        status: STATUS_DRAFT,
        k,
        created_at: now,
        closes_at,
        rules_blob,
        rules_hash,
        post_id: 0,
        opened_at: 0,
        prize_kind,
        prize_type: option::none(),
        pool: balance::zero(),
        deposited: 0,
        per_winner: 0,
        remainder: 0,
        unused_pending: false,
        max_entrants: cfg.max_entrants(),
        max_judged: cfg.max_judged(),
        max_replies_read: cfg.max_replies_read(),
        enclave_version,
        snapshot: option::none(),
        winners: vector[],
        paid: vector[],
    };
    let campaign_id = object::id(&c);
    event::emit(Created {
        campaign_id,
        organizer: c.organizer,
        mode,
        k,
        closes_at,
        prize_kind,
        rules_blob: c.rules_blob,
        rules_hash: c.rules_hash,
        enclave_version,
    });
    (c, OrganizerCap { id: object::new(ctx), campaign_id })
}

public fun share<C>(c: Campaign<C>) {
    transfer::share_object(c);
}

public fun fund_coin<C>(c: &mut Campaign<C>, cap: &OrganizerCap, coin: Coin<C>) {
    assert_organizer(c, cap);
    assert!(c.status == STATUS_DRAFT, EWrongState);
    assert!(c.prize_kind == PRIZE_COIN, EWrongPrize);
    let amount = coin.value();
    c.pool.join(coin.into_balance());
    event::emit(Funded { campaign_id: object::id(c), amount, objects: 0 });
}

/// Deposits the object prize for the next rank. All objects must share one type.
public fun deposit_object<C, P: key + store>(c: &mut Campaign<C>, cap: &OrganizerCap, prize: P) {
    assert_organizer(c, cap);
    assert!(c.status == STATUS_DRAFT, EWrongState);
    assert!(c.prize_kind == PRIZE_OBJECTS, EWrongPrize);
    assert!(c.deposited < c.k, EWrongPrize);
    let t = type_name::get<P>();
    if (c.prize_type.is_some()) {
        assert!(*c.prize_type.borrow() == t, EWrongPrize);
    } else {
        c.prize_type.fill(t);
    };
    dof::add(&mut c.id, Slot { rank: c.deposited }, prize);
    c.deposited = c.deposited + 1;
    event::emit(Funded { campaign_id: object::id(c), amount: 0, objects: 1 });
}

/// Cancels a DRAFT. Coins return at once; object prizes return through `refund_objects`.
public fun cancel<C>(c: &mut Campaign<C>, cap: &OrganizerCap, ctx: &mut TxContext) {
    assert_organizer(c, cap);
    assert!(c.status == STATUS_DRAFT, EWrongState);
    c.status = STATUS_CANCELLED;
    return_pool(c, ctx);
    event::emit(Cancelled { campaign_id: object::id(c) });
}

// === Open ===

/// Opens entries on X post `post_id`. The entry window starts at the post's own creation time,
/// which must fall between the campaign's creation and now.
public fun open<C>(c: &mut Campaign<C>, cap: &OrganizerCap, post_id: u64, clock: &Clock) {
    assert_organizer(c, cap);
    assert!(c.status == STATUS_DRAFT, EWrongState);
    let funded = if (c.prize_kind == PRIZE_COIN) {
        let v = c.pool.value();
        v > 0 && v % (c.k as u64) == 0
    } else {
        c.deposited == c.k
    };
    assert!(funded, ENotFunded);
    let now = clock.timestamp_ms();
    assert!(now < c.closes_at, EClosed);
    let posted_at = post_time_ms(post_id);
    assert!(posted_at >= c.created_at && posted_at <= now, EBadParam);
    c.post_id = post_id;
    c.opened_at = posted_at;
    c.status = STATUS_OPEN;
    event::emit(Opened { campaign_id: object::id(c), post_id, opened_at: posted_at });
}

/// Creation time in ms encoded in an X post ID.
public fun post_time_ms(post_id: u64): u64 {
    (post_id >> 22) + X_EPOCH_MS
}

// === Snapshot ===

/// Commits the enclave's signed snapshot. Anyone may submit it; only a valid signature from an
/// enclave registered against this campaign's pinned config version is accepted.
public fun commit_snapshot<C>(
    c: &mut Campaign<C>,
    enclave: &Enclave<CHEK>,
    payload: SnapshotPayload,
    signature: vector<u8>,
    blob_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(c.status == STATUS_OPEN, EWrongState);
    assert!(snapshot::verify_signature(enclave, &payload, &signature), EBadSig);
    commit_verified(
        c,
        object::id(enclave),
        enclave.config_version(),
        payload,
        blob_id,
        clock,
        ctx,
    );
}

fun commit_verified<C>(
    c: &mut Campaign<C>,
    enclave_id: ID,
    enclave_version: u64,
    payload: SnapshotPayload,
    blob_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(c.status == STATUS_OPEN, EWrongState);
    assert!(enclave_version == c.enclave_version, EWrongEnclave);

    assert!(payload.campaign_id() == object::id(c), EMismatch);
    assert!(payload.post_id() == c.post_id, EMismatch);
    assert!(payload.rules_hash() == c.rules_hash, EMismatch);
    assert!(payload.opened_at() == c.opened_at, EMismatch);
    assert!(payload.closes_at() == c.closes_at, EMismatch);
    assert!(payload.mode() == c.mode, EMismatch);
    assert!(payload.k() == c.k, EMismatch);
    assert!(payload.max_entrants() == c.max_entrants, EMismatch);
    assert!(payload.max_judged() == c.max_judged, EMismatch);
    assert!(payload.max_replies_read() == c.max_replies_read, EMismatch);

    let n = payload.n();
    let replies_seen = payload.replies_seen();
    assert!(payload.root().length() == 32 && payload.snapshot_hash().length() == 32, EMismatch);
    assert!(n <= c.max_entrants && n <= replies_seen && replies_seen <= c.max_replies_read, EMismatch);
    assert!(c.mode == MODE_DRAW || n <= c.max_judged, EMismatch);

    let now = clock.timestamp_ms();
    let fetched_at = payload.fetched_at();
    assert!(
        fetched_at >= c.closes_at && fetched_at <= c.closes_at + FETCH_WINDOW_MS && fetched_at <= now,
        EWindow,
    );
    assert!(now <= c.closes_at + COMMIT_WINDOW_MS, EWindow);
    assert!(!blob_id.is_empty(), EBadParam);

    let snap = SnapshotRef {
        enclave_id,
        fetched_at,
        n,
        replies_seen,
        root: payload.root(),
        snapshot_hash: payload.snapshot_hash(),
        blob_id,
        linked: payload.linked(),
        post_author_id: payload.post_author_id(),
        request_counter: payload.request_counter(),
    };
    event::emit(SnapshotCommitted {
        campaign_id: object::id(c),
        enclave_id,
        n,
        replies_seen,
        root: snap.root,
        snapshot_hash: snap.snapshot_hash,
        blob_id: snap.blob_id,
        linked: snap.linked,
        request_counter: snap.request_counter,
    });
    c.snapshot.fill(snap);

    if (n == 0) {
        // Nobody qualified: coins go back now, objects through `refund_objects`.
        return_pool(c, ctx);
        c.status = STATUS_SETTLED;
    } else {
        c.status = STATUS_COMMITTED;
    };
}

/// Returns the prize if no snapshot was committed within 48 hours of close.
public fun expire<C>(c: &mut Campaign<C>, clock: &Clock, ctx: &mut TxContext) {
    assert!(c.status == STATUS_OPEN, EWrongState);
    assert!(clock.timestamp_ms() > c.closes_at + COMMIT_WINDOW_MS, ETooEarly);
    c.status = STATUS_EXPIRED;
    return_pool(c, ctx);
    event::emit(Expired { campaign_id: object::id(c) });
}

// === Draw ===

/// Picks min(k, n) distinct winners with Sui Random. Private entry, so it cannot be composed
/// with a check of its result; it transfers nothing, and its work does not depend on who wins.
entry fun draw<C>(c: &mut Campaign<C>, r: &Random, ctx: &mut TxContext) {
    let mut generator = random::new_generator(r, ctx);
    draw_with(c, &mut generator);
}

fun draw_with<C>(c: &mut Campaign<C>, generator: &mut RandomGenerator) {
    assert!(c.status == STATUS_COMMITTED, EWrongState);
    let n = c.snapshot.borrow().n;
    let k_eff = min_u32(c.k as u32, n);
    c.winners = select_winners(generator, n, k_eff);

    let mut paid = vector[];
    let mut r = 0;
    while (r < k_eff) {
        paid.push_back(false);
        r = r + 1;
    };
    c.paid = paid;

    if (c.prize_kind == PRIZE_COIN) {
        let pool = c.pool.value();
        c.per_winner = pool / (k_eff as u64);
        c.remainder = pool - c.per_winner * (k_eff as u64);
        c.unused_pending = c.remainder > 0;
    } else {
        c.unused_pending = k_eff < (c.k as u32);
    };
    c.status = STATUS_DRAWN;
    event::emit(Drawn { campaign_id: object::id(c), winners: c.winners });
}

/// Sparse Fisher–Yates: for i in 0..k_eff pick j uniformly in [i, n), take the value at j as
/// rank i's winner and move the value at i to position j. Overrides live in a local list with
/// one entry added per round, and every lookup scans the whole list, so each round does the same
/// work whatever the draw. Nothing is written to storage but the result.
public(package) fun select_winners(
    generator: &mut RandomGenerator,
    n: u32,
    k_eff: u32,
): vector<u32> {
    let mut keys = vector<u32>[];
    let mut vals = vector<u32>[];
    let mut winners = vector<u32>[];
    let mut i = 0;
    while (i < k_eff) {
        let j = generator.generate_u32_in_range(i, n - 1);
        let value_i = lookup(&keys, &vals, i);
        let value_j = lookup(&keys, &vals, j);
        winners.push_back(value_j);
        keys.push_back(j);
        vals.push_back(value_i);
        i = i + 1;
    };
    winners
}

/// Value at `pos`: the latest override recorded for it, else `pos` itself.
fun lookup(keys: &vector<u32>, vals: &vector<u32>, pos: u32): u32 {
    let mut found = pos;
    let len = keys.length();
    let mut t = 0;
    while (t < len) {
        found = if (keys[t] == pos) vals[t] else found;
        t = t + 1;
    };
    found
}

// === Payouts ===

/// Pays rank `rank` its share of a coin prize. Anyone can call it; the coin goes only to the
/// address in the winner's committed leaf.
public fun distribute_coin<C>(
    c: &mut Campaign<C>,
    rank: u16,
    i: u32,
    author_id: u64,
    to: address,
    proof: vector<vector<u8>>,
    ctx: &mut TxContext,
) {
    check_winner(c, rank, i, author_id, to, &proof);
    assert!(c.prize_kind == PRIZE_COIN, EWrongPrize);
    let amount = c.per_winner;
    transfer::public_transfer(coin::from_balance(c.pool.split(amount), ctx), to);
    mark_paid(c, rank, to, amount, option::none());
}

/// Sends rank `rank` the object in slot `rank`.
public fun distribute_object<C, P: key + store>(
    c: &mut Campaign<C>,
    rank: u16,
    i: u32,
    author_id: u64,
    to: address,
    proof: vector<vector<u8>>,
) {
    check_winner(c, rank, i, author_id, to, &proof);
    assert_object_type<C, P>(c);
    let prize: P = dof::remove(&mut c.id, Slot { rank });
    let object_id = object::id(&prize);
    transfer::public_transfer(prize, to);
    mark_paid(c, rank, to, 0, option::some(object_id));
}

/// Returns the coin remainder (pool not divisible by n < k) to the organizer.
public fun reclaim_unused<C>(c: &mut Campaign<C>, ctx: &mut TxContext) {
    assert!(c.status == STATUS_DRAWN || c.status == STATUS_SETTLED, EWrongState);
    assert!(c.prize_kind == PRIZE_COIN, EWrongPrize);
    assert!(c.unused_pending, ENothingUnused);
    let amount = c.remainder;
    c.remainder = 0;
    c.unused_pending = false;
    transfer::public_transfer(coin::from_balance(c.pool.split(amount), ctx), c.organizer);
    event::emit(Reclaimed { campaign_id: object::id(c), to: c.organizer, amount, objects: 0 });
    settle_if_done(c);
}

/// Returns up to `max` object prizes for ranks n..k−1 to the organizer.
public fun reclaim_unused_objects<C, P: key + store>(c: &mut Campaign<C>, max: u16) {
    assert!(c.status == STATUS_DRAWN || c.status == STATUS_SETTLED, EWrongState);
    assert_object_type<C, P>(c);
    assert!(c.unused_pending, ENothingUnused);
    let from = c.winners.length() as u16;
    let (moved, left) = return_slots<C, P>(c, from, max);
    event::emit(Reclaimed { campaign_id: object::id(c), to: c.organizer, amount: 0, objects: moved });
    if (!left) {
        c.unused_pending = false;
        settle_if_done(c);
    };
}

/// Returns up to `max` object prizes to the organizer after cancel, expiry or a snapshot with no
/// entrants. Anyone can call it; the objects go only to the organizer.
public fun refund_objects<C, P: key + store>(c: &mut Campaign<C>, max: u16) {
    let no_entrants = c.status == STATUS_SETTLED && c.snapshot.is_some() && c.snapshot.borrow().n == 0;
    assert!(
        c.status == STATUS_CANCELLED || c.status == STATUS_EXPIRED || no_entrants,
        EWrongState,
    );
    assert!(c.prize_kind == PRIZE_OBJECTS, EWrongPrize);
    assert!(c.prize_type.is_some(), ENothingUnused);
    assert_object_type<C, P>(c);
    let (moved, _) = return_slots<C, P>(c, 0, max);
    assert!(moved > 0, ENothingUnused);
    event::emit(Reclaimed { campaign_id: object::id(c), to: c.organizer, amount: 0, objects: moved });
}

// === Internal ===

fun assert_organizer<C>(c: &Campaign<C>, cap: &OrganizerCap) {
    assert!(cap.campaign_id == object::id(c), ENotOrganizer);
}

fun assert_object_type<C, P>(c: &Campaign<C>) {
    assert!(c.prize_kind == PRIZE_OBJECTS, EWrongPrize);
    assert!(c.prize_type.is_some() && *c.prize_type.borrow() == type_name::get<P>(), EWrongPrize);
}

fun check_winner<C>(
    c: &Campaign<C>,
    rank: u16,
    i: u32,
    author_id: u64,
    to: address,
    proof: &vector<vector<u8>>,
) {
    assert!(c.status == STATUS_DRAWN || c.status == STATUS_SETTLED, EWrongState);
    let r = rank as u64;
    assert!(r < c.winners.length(), EBadProof);
    assert!(!c.paid[r], EPaid);
    assert!(c.winners[r] == i, EBadProof);
    assert!(merkle::verify(&c.snapshot.borrow().root, i, author_id, to, proof), EBadProof);
}

fun mark_paid<C>(c: &mut Campaign<C>, rank: u16, to: address, amount: u64, object_id: Option<ID>) {
    *c.paid.borrow_mut(rank as u64) = true;
    event::emit(Paid { campaign_id: object::id(c), rank, to, amount, object_id });
    settle_if_done(c);
}

fun settle_if_done<C>(c: &mut Campaign<C>) {
    if (c.status != STATUS_DRAWN || c.unused_pending) return;
    let len = c.paid.length();
    let mut r = 0;
    while (r < len) {
        if (!c.paid[r]) return;
        r = r + 1;
    };
    c.status = STATUS_SETTLED;
}

fun return_pool<C>(c: &mut Campaign<C>, ctx: &mut TxContext) {
    let amount = c.pool.value();
    if (amount > 0) {
        transfer::public_transfer(coin::from_balance(c.pool.withdraw_all(), ctx), c.organizer);
        event::emit(Reclaimed { campaign_id: object::id(c), to: c.organizer, amount, objects: 0 });
    };
}

/// Moves up to `max` object prizes from slots `from..deposited` to the organizer. Returns how many
/// moved and whether any remain in that range.
fun return_slots<C, P: key + store>(c: &mut Campaign<C>, from: u16, max: u16): (u16, bool) {
    let mut rank = from;
    let mut moved = 0;
    let mut left = false;
    while (rank < c.deposited) {
        let slot = Slot { rank };
        if (dof::exists_(&c.id, slot)) {
            if (moved < max) {
                let prize: P = dof::remove(&mut c.id, slot);
                transfer::public_transfer(prize, c.organizer);
                moved = moved + 1;
            } else {
                left = true;
            };
        };
        rank = rank + 1;
    };
    (moved, left)
}

fun min_u32(a: u32, b: u32): u32 {
    if (a < b) a else b
}

// === Views ===

public fun organizer<C>(c: &Campaign<C>): address { c.organizer }

public fun mode<C>(c: &Campaign<C>): u8 { c.mode }

public fun status<C>(c: &Campaign<C>): u8 { c.status }

public fun k<C>(c: &Campaign<C>): u16 { c.k }

public fun created_at<C>(c: &Campaign<C>): u64 { c.created_at }

public fun closes_at<C>(c: &Campaign<C>): u64 { c.closes_at }

public fun rules_blob<C>(c: &Campaign<C>): vector<u8> { c.rules_blob }

public fun rules_hash<C>(c: &Campaign<C>): vector<u8> { c.rules_hash }

public fun post_id<C>(c: &Campaign<C>): u64 { c.post_id }

public fun opened_at<C>(c: &Campaign<C>): u64 { c.opened_at }

public fun prize_kind<C>(c: &Campaign<C>): u8 { c.prize_kind }

public fun pool_value<C>(c: &Campaign<C>): u64 { c.pool.value() }

public fun deposited<C>(c: &Campaign<C>): u16 { c.deposited }

public fun per_winner<C>(c: &Campaign<C>): u64 { c.per_winner }

public fun remainder<C>(c: &Campaign<C>): u64 { c.remainder }

public fun unused_pending<C>(c: &Campaign<C>): bool { c.unused_pending }

public fun max_entrants<C>(c: &Campaign<C>): u32 { c.max_entrants }

public fun max_judged<C>(c: &Campaign<C>): u32 { c.max_judged }

public fun max_replies_read<C>(c: &Campaign<C>): u32 { c.max_replies_read }

public fun enclave_version<C>(c: &Campaign<C>): u64 { c.enclave_version }

public fun has_snapshot<C>(c: &Campaign<C>): bool { c.snapshot.is_some() }

public fun entrants<C>(c: &Campaign<C>): u32 { c.snapshot.borrow().n }

public fun winners<C>(c: &Campaign<C>): vector<u32> { c.winners }

public fun paid<C>(c: &Campaign<C>): vector<bool> { c.paid }

public fun cap_campaign_id(cap: &OrganizerCap): ID { cap.campaign_id }

// === Test-only ===

/// `commit_snapshot` after its signature check, for tests that cannot sign for a fresh object ID.
#[test_only]
public fun commit_verified_for_testing<C>(
    c: &mut Campaign<C>,
    enclave_id: ID,
    enclave_version: u64,
    payload: SnapshotPayload,
    blob_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    commit_verified(c, enclave_id, enclave_version, payload, blob_id, clock, ctx)
}

/// `draw` with a caller-supplied generator; the entry function itself cannot be called from tests.
#[test_only]
public fun draw_for_testing<C>(c: &mut Campaign<C>, generator: &mut RandomGenerator) {
    draw_with(c, generator)
}
