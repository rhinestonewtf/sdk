use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolValue};
use std::str::FromStr;

use crate::types::{ENSValidatorInput, ModuleOutput};

const ENS_VALIDATOR_ADDRESS: &str = "0xdc38f07b060374b6480c4bf06231e7d10955bca4";

sol! {
    struct Owner {
        address addr;
        uint48 expiration;
    }
}

pub fn encode(input: ENSValidatorInput) -> Result<ModuleOutput, String> {
    let threshold = U256::from(input.threshold);

    let max_uint48: u64 = (1u64 << 48) - 1;

    let mut owner_pairs: Vec<(Address, u64)> = input
        .owners
        .iter()
        .enumerate()
        .map(|(i, o)| {
            let addr =
                Address::from_str(o).map_err(|e| format!("invalid owner address: {e}"))?;
            let expiration = input
                .owner_expirations
                .get(i)
                .copied()
                .unwrap_or(max_uint48);
            Ok((addr, expiration))
        })
        .collect::<Result<Vec<_>, String>>()?;

    // Sort by address (matching TS: ownerPairs.sort((a, b) => a.addr.localeCompare(b.addr)))
    owner_pairs.sort_by_key(|(addr, _)| *addr);

    let owners: Vec<Owner> = owner_pairs
        .into_iter()
        .map(|(addr, expiration)| Owner {
            addr,
            expiration: expiration.try_into().unwrap_or(u64::from(u32::MAX).try_into().unwrap()),
        })
        .collect();

    let init_data = (threshold, owners).abi_encode_params();
    let init_data_hex = format!("0x{}", alloy_primitives::hex::encode(&init_data));

    let address = input
        .address
        .unwrap_or_else(|| ENS_VALIDATOR_ADDRESS.to_string());

    Ok(ModuleOutput::validator(&address, init_data_hex))
}
