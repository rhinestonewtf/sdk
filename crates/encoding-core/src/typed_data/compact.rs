use alloy_primitives::keccak256;
use serde_json::{json, Value};

use crate::types::CompactInput;

const COMPACT_VERIFYING_CONTRACT: &str = "0x73d2dc0c21fca4ec1601895d50df7f5624f07d3f";

fn types() -> Value {
    json!({
        "MultichainCompact": [
            { "name": "sponsor", "type": "address" },
            { "name": "nonce", "type": "uint256" },
            { "name": "expires", "type": "uint256" },
            { "name": "elements", "type": "Element[]" }
        ],
        "Element": [
            { "name": "arbiter", "type": "address" },
            { "name": "chainId", "type": "uint256" },
            { "name": "commitments", "type": "Lock[]" },
            { "name": "mandate", "type": "Mandate" }
        ],
        "Lock": [
            { "name": "lockTag", "type": "bytes12" },
            { "name": "token", "type": "address" },
            { "name": "amount", "type": "uint256" }
        ],
        "Mandate": [
            { "name": "target", "type": "Target" },
            { "name": "minGas", "type": "uint128" },
            { "name": "originOps", "type": "Op" },
            { "name": "destOps", "type": "Op" },
            { "name": "q", "type": "bytes32" }
        ],
        "Target": [
            { "name": "recipient", "type": "address" },
            { "name": "tokenOut", "type": "Token[]" },
            { "name": "targetChain", "type": "uint256" },
            { "name": "fillExpiry", "type": "uint256" }
        ],
        "Token": [
            { "name": "token", "type": "address" },
            { "name": "amount", "type": "uint256" }
        ],
        "Op": [
            { "name": "vt", "type": "bytes32" },
            { "name": "ops", "type": "Ops[]" }
        ],
        "Ops": [
            { "name": "to", "type": "address" },
            { "name": "value", "type": "uint256" },
            { "name": "data", "type": "bytes" }
        ]
    })
}

/// Extracts lockTag (first 12 bytes) and token address (last 20 bytes) from a packed token ID.
/// Mirrors TS: slice(toHex(BigInt(token[0])), 0, 12) for lockTag and slice(..., 12, 32) for token.
fn split_token_id(id_str: &str) -> Result<(String, String), String> {
    let id = alloy_primitives::U256::from_str_radix(
        id_str.trim_start_matches("0x"),
        if id_str.starts_with("0x") { 16 } else { 10 },
    )
    .map_err(|e| format!("invalid token id: {e}"))?;

    let bytes: [u8; 32] = id.to_be_bytes();
    let lock_tag = format!("0x{}", alloy_primitives::hex::encode(&bytes[..12]));
    let token = format!("0x{}", alloy_primitives::hex::encode(&bytes[12..32]));
    Ok((lock_tag, token))
}

/// Extracts just the token address (last 20 bytes) from a packed token ID.
fn extract_token_address(id_str: &str) -> Result<String, String> {
    let id = alloy_primitives::U256::from_str_radix(
        id_str.trim_start_matches("0x"),
        if id_str.starts_with("0x") { 16 } else { 10 },
    )
    .map_err(|e| format!("invalid token id: {e}"))?;

    let bytes: [u8; 32] = id.to_be_bytes();
    let token = format!("0x{}", alloy_primitives::hex::encode(&bytes[12..32]));
    Ok(token)
}

fn parse_bigint(s: &str) -> Value {
    // Return as a string for viem to handle BigInt conversion on the TS side
    Value::String(s.to_string())
}

pub fn build_typed_data(input: CompactInput) -> Result<Value, String> {
    let chain_id: u64 = input
        .elements
        .first()
        .ok_or("elements must not be empty")?
        .chain_id
        .parse()
        .map_err(|e| format!("invalid chainId: {e}"))?;

    let elements: Result<Vec<Value>, String> = input
        .elements
        .iter()
        .map(|element| {
            let commitments: Result<Vec<Value>, String> = element
                .ids_and_amounts
                .iter()
                .map(|(id, amount)| {
                    let (lock_tag, token) = split_token_id(id)?;
                    Ok(json!({
                        "lockTag": lock_tag,
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
                    let token = extract_token_address(id)?;
                    Ok(json!({
                        "token": token,
                        "amount": parse_bigint(amount)
                    }))
                })
                .collect();

            Ok(json!({
                "arbiter": element.arbiter,
                "chainId": parse_bigint(&element.chain_id),
                "commitments": commitments?,
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
            }))
        })
        .collect();

    Ok(json!({
        "domain": {
            "name": "The Compact",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": COMPACT_VERIFYING_CONTRACT
        },
        "types": types(),
        "primaryType": "MultichainCompact",
        "message": {
            "sponsor": input.sponsor,
            "nonce": parse_bigint(&input.nonce),
            "expires": parse_bigint(&input.expires),
            "elements": elements?
        }
    }))
}
