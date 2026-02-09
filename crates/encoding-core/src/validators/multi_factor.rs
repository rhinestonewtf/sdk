use alloy_primitives::{Address, FixedBytes};
use alloy_sol_types::{sol, SolValue};
use std::str::FromStr;

use crate::types::{ModuleOutput, MultiFactorValidatorInput};

const MULTI_FACTOR_VALIDATOR_ADDRESS: &str = "0xf6bdf42c9be18ceca5c06c42a43daf7fbbe7896b";

sol! {
    struct ValidatorEntry {
        bytes32 packedValidatorAndId;
        bytes data;
    }
}

pub fn encode(input: MultiFactorValidatorInput) -> Result<ModuleOutput, String> {
    let threshold = input.threshold as u8;

    let mut entries: Vec<ValidatorEntry> = Vec::new();

    for (index, validator_opt) in input.validators.iter().enumerate() {
        let validator = match validator_opt {
            Some(v) => v,
            None => continue,
        };

        // Encode the inner validator to get its address and initData
        let inner_module = match validator.validator_type.as_str() {
            "ecdsa" => {
                let owners = validator
                    .owners
                    .as_ref()
                    .ok_or("ecdsa validator requires owners")?;
                let threshold = validator.threshold.unwrap_or(1);
                super::ownable::encode(crate::types::OwnableValidatorInput {
                    threshold,
                    owners: owners.clone(),
                    address: validator.address.clone(),
                })?
            }
            "ens" => {
                let owners = validator
                    .owners
                    .as_ref()
                    .ok_or("ens validator requires owners")?;
                let expirations = validator
                    .owner_expirations
                    .as_ref()
                    .ok_or("ens validator requires ownerExpirations")?;
                let threshold = validator.threshold.unwrap_or(1);
                super::ens::encode(crate::types::ENSValidatorInput {
                    threshold,
                    owners: owners.clone(),
                    owner_expirations: expirations.clone(),
                    address: validator.address.clone(),
                })?
            }
            "passkey" => {
                let credentials = validator
                    .credentials
                    .as_ref()
                    .ok_or("passkey validator requires credentials")?;
                let threshold = validator.threshold.unwrap_or(1);
                super::webauthn::encode(crate::types::WebAuthnValidatorInput {
                    threshold,
                    credentials: credentials.clone(),
                    address: validator.address.clone(),
                })?
            }
            other => return Err(format!("unknown validator type: {other}")),
        };

        // Pack validator ID (index as bytes12) + validator address (20 bytes) into bytes32
        let validator_address = Address::from_str(&inner_module.address)
            .map_err(|e| format!("invalid validator address: {e}"))?;

        let mut packed = [0u8; 32];
        // Index as big-endian in first 12 bytes
        let index_bytes = (index as u128).to_be_bytes();
        packed[..12].copy_from_slice(&index_bytes[4..16]);
        // Address in last 20 bytes
        packed[12..32].copy_from_slice(validator_address.as_slice());

        let packed_validator_and_id = FixedBytes::<32>::from(packed);

        // Decode the inner initData hex to bytes
        let init_data_hex = inner_module.init_data.trim_start_matches("0x");
        let init_data_bytes =
            alloy_primitives::hex::decode(init_data_hex).map_err(|e| format!("hex decode: {e}"))?;

        entries.push(ValidatorEntry {
            packedValidatorAndId: packed_validator_and_id,
            data: init_data_bytes.into(),
        });
    }

    // ABI encode the validator entries array as a single parameter
    let abi_encoded = entries.abi_encode_params();

    // encodePacked(uint8, bytes): threshold byte + abi-encoded data
    let mut result = Vec::with_capacity(1 + abi_encoded.len());
    result.push(threshold);
    result.extend_from_slice(&abi_encoded);

    let init_data_hex = format!("0x{}", alloy_primitives::hex::encode(&result));

    Ok(ModuleOutput::validator(
        MULTI_FACTOR_VALIDATOR_ADDRESS,
        init_data_hex,
    ))
}
