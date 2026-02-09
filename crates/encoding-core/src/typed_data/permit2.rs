use alloy_primitives::keccak256;
use serde_json::{json, Value};

use crate::types::Permit2Input;

const PERMIT2_ADDRESS: &str = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

fn types() -> Value {
    json!({
        "TokenPermissions": [
            { "name": "token", "type": "address" },
            { "name": "amount", "type": "uint256" }
        ],
        "Token": [
            { "name": "token", "type": "address" },
            { "name": "amount", "type": "uint256" }
        ],
        "Target": [
            { "name": "recipient", "type": "address" },
            { "name": "tokenOut", "type": "Token[]" },
            { "name": "targetChain", "type": "uint256" },
            { "name": "fillExpiry", "type": "uint256" }
        ],
        "Ops": [
            { "name": "to", "type": "address" },
            { "name": "value", "type": "uint256" },
            { "name": "data", "type": "bytes" }
        ],
        "Op": [
            { "name": "vt", "type": "bytes32" },
            { "name": "ops", "type": "Ops[]" }
        ],
        "Mandate": [
            { "name": "target", "type": "Target" },
            { "name": "minGas", "type": "uint128" },
            { "name": "originOps", "type": "Op" },
            { "name": "destOps", "type": "Op" },
            { "name": "q", "type": "bytes32" }
        ],
        "PermitBatchWitnessTransferFrom": [
            { "name": "permitted", "type": "TokenPermissions[]" },
            { "name": "spender", "type": "address" },
            { "name": "nonce", "type": "uint256" },
            { "name": "deadline", "type": "uint256" },
            { "name": "mandate", "type": "Mandate" }
        ]
    })
}

/// Extract token address from packed ID (last 20 bytes of uint256).
fn to_token(id_str: &str) -> Result<String, String> {
    let id = alloy_primitives::U256::from_str_radix(
        id_str.trim_start_matches("0x"),
        if id_str.starts_with("0x") { 16 } else { 10 },
    )
    .map_err(|e| format!("invalid token id: {e}"))?;

    // token = id & ((1 << 160) - 1)  — extract last 20 bytes
    let mask = alloy_primitives::U256::from(1u64)
        .checked_shl(160)
        .unwrap_or(alloy_primitives::U256::ZERO)
        - alloy_primitives::U256::from(1u64);
    let token = id & mask;
    let bytes: [u8; 32] = token.to_be_bytes();
    Ok(format!(
        "0x{}",
        alloy_primitives::hex::encode(&bytes[12..32])
    ))
}

fn parse_bigint(s: &str) -> Value {
    Value::String(s.to_string())
}

pub fn build_typed_data(input: Permit2Input) -> Result<Value, String> {
    let element = &input.element;
    let chain_id: u64 = element
        .chain_id
        .parse()
        .map_err(|e| format!("invalid chainId: {e}"))?;

    let token_permissions: Result<Vec<Value>, String> = element
        .ids_and_amounts
        .iter()
        .map(|(id, amount)| {
            let token = to_token(id)?;
            Ok(json!({
                "token": token,
                "amount": parse_bigint(amount)
            }))
        })
        .collect();

    let token_out: Result<Vec<Value>, String> = element
        .mandate
        .token_out
        .iter()
        .map(|(id, amount)| {
            let token = to_token(id)?;
            Ok(json!({
                "token": token,
                "amount": parse_bigint(amount)
            }))
        })
        .collect();

    Ok(json!({
        "domain": {
            "name": "Permit2",
            "chainId": chain_id,
            "verifyingContract": PERMIT2_ADDRESS
        },
        "types": types(),
        "primaryType": "PermitBatchWitnessTransferFrom",
        "message": {
            "permitted": token_permissions?,
            "spender": element.arbiter,
            "nonce": parse_bigint(&input.nonce),
            "deadline": parse_bigint(&input.expires),
            "mandate": {
                "target": {
                    "recipient": element.mandate.recipient,
                    "tokenOut": token_out?,
                    "targetChain": parse_bigint(&element.mandate.destination_chain_id),
                    "fillExpiry": parse_bigint(&element.mandate.fill_deadline)
                },
                "minGas": parse_bigint(&element.mandate.min_gas),
                "originOps": element.mandate.pre_claim_ops,
                "destOps": element.mandate.destination_ops,
                "q": format!("0x{}", alloy_primitives::hex::encode(
                    keccak256(
                        alloy_primitives::hex::decode(
                            element.mandate.qualifier_encoded_val.trim_start_matches("0x")
                        ).map_err(|e| format!("invalid qualifier hex: {e}"))?
                    )
                ))
            }
        }
    }))
}
