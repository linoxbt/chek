/// Chek's Nautilus enclave identity. `PcrAdmin` holds the only `Cap<CHEK>` and never hands it
/// out, so its holder can create exactly one `EnclaveConfig<CHEK>` and afterwards only update
/// that config's PCRs. Each campaign pins the config version current at its creation, so a build
/// registered later cannot sign for it.
module chek::enclave_app;

use enclave::enclave::{Self, Cap, EnclaveConfig};
use std::string::String;

const EConfigExists: u64 = 100;

/// Type tag of Chek's enclave objects: `EnclaveConfig<CHEK>` and `Enclave<CHEK>`.
public struct CHEK has drop {}

public struct PcrAdmin has key, store {
    id: UID,
    cap: Cap<CHEK>,
    config_created: bool,
}

fun init(ctx: &mut TxContext) {
    let admin = PcrAdmin {
        id: object::new(ctx),
        cap: enclave::new_cap(CHEK {}, ctx),
        config_created: false,
    };
    transfer::public_transfer(admin, ctx.sender());
}

/// Creates and shares the single EnclaveConfig<CHEK> with the release build's PCRs.
public fun create_config(
    admin: &mut PcrAdmin,
    name: String,
    pcr0: vector<u8>,
    pcr1: vector<u8>,
    pcr2: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(!admin.config_created, EConfigExists);
    admin.config_created = true;
    enclave::create_enclave_config(&admin.cap, name, pcr0, pcr1, pcr2, ctx);
}

/// Registers a new enclave build. Campaigns created before this call keep requiring the old one.
public fun update_pcrs(
    admin: &PcrAdmin,
    config: &mut EnclaveConfig<CHEK>,
    pcr0: vector<u8>,
    pcr1: vector<u8>,
    pcr2: vector<u8>,
) {
    enclave::update_pcrs(config, &admin.cap, pcr0, pcr1, pcr2);
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    init(ctx)
}
