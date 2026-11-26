/// Operator settings for giveaways created from now on (spec MD11). Every Campaign copies the
/// values it uses at creation, so nothing here can change a giveaway that already exists.
module chek::config;

use sui::event;

const EBadParam: u64 = 2;

const MAX_ENTRANTS_CEILING: u32 = 5_000;
const MAX_JUDGED_CEILING: u32 = 1_000;
const MAX_REPLIES_READ_CEILING: u32 = 20_000;

public struct AdminCap has key, store {
    id: UID,
}

public struct Config has key {
    id: UID,
    fee_mist: u64,
    fee_recipient: address,
    max_entrants: u32,
    max_judged: u32,
    max_replies_read: u32,
    paused: bool,
}

public struct ConfigChanged has copy, drop {
    fee_mist: u64,
    fee_recipient: address,
    max_entrants: u32,
    max_judged: u32,
    max_replies_read: u32,
    paused: bool,
}

fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(Config {
        id: object::new(ctx),
        fee_mist: 0,
        fee_recipient: ctx.sender(),
        max_entrants: MAX_ENTRANTS_CEILING,
        max_judged: MAX_JUDGED_CEILING,
        max_replies_read: MAX_REPLIES_READ_CEILING,
        paused: false,
    });
}

public fun set_fee(cfg: &mut Config, _: &AdminCap, fee_mist: u64, fee_recipient: address) {
    cfg.fee_mist = fee_mist;
    cfg.fee_recipient = fee_recipient;
    emit_changed(cfg);
}

public fun set_limits(
    cfg: &mut Config,
    _: &AdminCap,
    max_entrants: u32,
    max_judged: u32,
    max_replies_read: u32,
) {
    assert!(max_entrants >= 1 && max_entrants <= MAX_ENTRANTS_CEILING, EBadParam);
    assert!(max_judged >= 1 && max_judged <= MAX_JUDGED_CEILING, EBadParam);
    assert!(
        max_replies_read >= max_entrants && max_replies_read <= MAX_REPLIES_READ_CEILING,
        EBadParam,
    );
    cfg.max_entrants = max_entrants;
    cfg.max_judged = max_judged;
    cfg.max_replies_read = max_replies_read;
    emit_changed(cfg);
}

/// Pausing stops new giveaways only; live ones finish under their own rules.
public fun set_paused(cfg: &mut Config, _: &AdminCap, paused: bool) {
    cfg.paused = paused;
    emit_changed(cfg);
}

fun emit_changed(cfg: &Config) {
    event::emit(ConfigChanged {
        fee_mist: cfg.fee_mist,
        fee_recipient: cfg.fee_recipient,
        max_entrants: cfg.max_entrants,
        max_judged: cfg.max_judged,
        max_replies_read: cfg.max_replies_read,
        paused: cfg.paused,
    });
}

public fun fee_mist(cfg: &Config): u64 { cfg.fee_mist }

public fun fee_recipient(cfg: &Config): address { cfg.fee_recipient }

public fun max_entrants(cfg: &Config): u32 { cfg.max_entrants }

public fun max_judged(cfg: &Config): u32 { cfg.max_judged }

public fun max_replies_read(cfg: &Config): u32 { cfg.max_replies_read }

public fun paused(cfg: &Config): bool { cfg.paused }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx)
}
