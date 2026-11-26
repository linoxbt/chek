#[test_only]
module chek::config_tests;

use chek::config::{Self, AdminCap, Config};
use chek::enclave_app::{Self, PcrAdmin};
use sui::test_scenario as ts;

const ADMIN: address = @0xAD;

#[test]
fun defaults_and_setters() {
    let mut sc = ts::begin(ADMIN);
    config::init_for_testing(sc.ctx());
    sc.next_tx(ADMIN);
    let mut cfg = sc.take_shared<Config>();
    let cap = sc.take_from_sender<AdminCap>();
    assert!(cfg.fee_mist() == 0 && cfg.fee_recipient() == ADMIN && !cfg.paused());
    assert!(cfg.max_entrants() == 5_000 && cfg.max_judged() == 1_000 && cfg.max_replies_read() == 20_000);
    config::set_fee(&mut cfg, &cap, 5, @0xF);
    config::set_limits(&mut cfg, &cap, 10, 10, 10);
    config::set_paused(&mut cfg, &cap, true);
    assert!(cfg.fee_mist() == 5 && cfg.fee_recipient() == @0xF && cfg.paused());
    assert!(cfg.max_entrants() == 10 && cfg.max_replies_read() == 10);
    sc.return_to_sender(cap);
    ts::return_shared(cfg);
    sc.end();
}

#[test, expected_failure(abort_code = 2, location = chek::config)]
fun limits_above_ceiling_abort() {
    let mut sc = ts::begin(ADMIN);
    config::init_for_testing(sc.ctx());
    sc.next_tx(ADMIN);
    let mut cfg = sc.take_shared<Config>();
    let cap = sc.take_from_sender<AdminCap>();
    config::set_limits(&mut cfg, &cap, 5_001, 1_000, 20_000);
    sc.return_to_sender(cap);
    ts::return_shared(cfg);
    sc.end();
}

#[test, expected_failure(abort_code = 2, location = chek::config)]
fun read_cap_below_entrant_cap_aborts() {
    let mut sc = ts::begin(ADMIN);
    config::init_for_testing(sc.ctx());
    sc.next_tx(ADMIN);
    let mut cfg = sc.take_shared<Config>();
    let cap = sc.take_from_sender<AdminCap>();
    config::set_limits(&mut cfg, &cap, 100, 100, 99);
    sc.return_to_sender(cap);
    ts::return_shared(cfg);
    sc.end();
}

#[test, expected_failure(abort_code = 100, location = chek::enclave_app)]
fun only_one_enclave_config_can_exist() {
    let mut sc = ts::begin(ADMIN);
    enclave_app::init_for_testing(sc.ctx());
    sc.next_tx(ADMIN);
    let mut admin = sc.take_from_sender<PcrAdmin>();
    enclave_app::create_config(&mut admin, b"a".to_string(), x"01", x"02", x"03", sc.ctx());
    enclave_app::create_config(&mut admin, b"b".to_string(), x"01", x"02", x"03", sc.ctx());
    sc.return_to_sender(admin);
    sc.end();
}
