use eip712_mapper_core::types::*;
use serde_json::{json, Value};

use crate::types::{SerializedTypedData, TypedDataDomain, WasmOutput};
use crate::util::{addr_to_json, fixed_bytes_to_hex, parse_bigint};

pub fn to_wasm_output(result: TypedDataResult) -> WasmOutput {
    match result {
        TypedDataResult::Compact(data) => {
            let count = data.elements.len();
            let typed_data = serialize_compact(&data);
            let origin = vec![typed_data; count];
            WasmOutput { origin }
        }
        TypedDataResult::Permit2(data_vec) => {
            let origin = data_vec.iter().map(serialize_permit2).collect();
            WasmOutput { origin }
        }
        TypedDataResult::SingleChain(data_vec) => {
            let origin = data_vec.iter().map(serialize_single_chain).collect();
            WasmOutput { origin }
        }
    }
}

fn serialize_domain(domain: &Eip712Domain) -> TypedDataDomain {
    TypedDataDomain {
        name: domain.name.to_string(),
        version: domain.version.map(|v| v.to_string()),
        chain_id: domain.chain_id,
        verifying_contract: format!(
            "0x{}",
            alloy_primitives::hex::encode(domain.verifying_contract.as_slice())
        ),
    }
}

fn serialize_mandate(mandate: &Mandate) -> Value {
    let token_out: Vec<Value> = mandate
        .target
        .token_out
        .iter()
        .map(|t| {
            json!({
                "token": addr_to_json(&t.token),
                "amount": parse_bigint(&t.amount)
            })
        })
        .collect();

    json!({
        "target": {
            "recipient": addr_to_json(&mandate.target.recipient),
            "tokenOut": token_out,
            "targetChain": parse_bigint(&mandate.target.destination_chain_id),
            "fillExpiry": parse_bigint(&mandate.target.fill_deadline)
        },
        "minGas": parse_bigint(&mandate.min_gas),
        "originOps": mandate.origin_ops.0,
        "destOps": mandate.dest_ops.0,
        "q": fixed_bytes_to_hex(&mandate.q)
    })
}

// --- Compact ---

fn compact_types() -> Value {
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

fn serialize_compact(data: &CompactTypedData) -> SerializedTypedData {
    let elements: Vec<Value> = data
        .elements
        .iter()
        .map(|el| {
            let commitments: Vec<Value> = el
                .commitments
                .iter()
                .map(|c| {
                    json!({
                        "lockTag": fixed_bytes_to_hex(&c.lock_tag),
                        "token": addr_to_json(&c.token),
                        "amount": parse_bigint(&c.amount)
                    })
                })
                .collect();

            json!({
                "arbiter": addr_to_json(&el.arbiter),
                "chainId": parse_bigint(&el.chain_id),
                "commitments": commitments,
                "mandate": serialize_mandate(&el.mandate)
            })
        })
        .collect();

    let message = json!({
        "sponsor": addr_to_json(&data.sponsor),
        "nonce": parse_bigint(&data.nonce),
        "expires": parse_bigint(&data.expires),
        "elements": elements
    });

    SerializedTypedData {
        domain: serialize_domain(&data.domain),
        types: compact_types(),
        primary_type: "MultichainCompact".to_string(),
        message,
    }
}

// --- Permit2 ---

fn permit2_types() -> Value {
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

fn serialize_permit2(data: &Permit2TypedData) -> SerializedTypedData {
    let token_permissions: Vec<Value> = data
        .permitted
        .iter()
        .map(|t| {
            json!({
                "token": addr_to_json(&t.token),
                "amount": parse_bigint(&t.amount)
            })
        })
        .collect();

    let token_out: Vec<Value> = data
        .mandate
        .target
        .token_out
        .iter()
        .map(|t| {
            json!({
                "token": addr_to_json(&t.token),
                "amount": parse_bigint(&t.amount)
            })
        })
        .collect();

    let message = json!({
        "permitted": token_permissions,
        "spender": addr_to_json(&data.spender),
        "nonce": parse_bigint(&data.nonce),
        "deadline": parse_bigint(&data.deadline),
        "mandate": {
            "target": {
                "recipient": addr_to_json(&data.mandate.target.recipient),
                "tokenOut": token_out,
                "targetChain": parse_bigint(&data.mandate.target.destination_chain_id),
                "fillExpiry": parse_bigint(&data.mandate.target.fill_deadline)
            },
            "minGas": parse_bigint(&data.mandate.min_gas),
            "originOps": data.mandate.origin_ops.0,
            "destOps": data.mandate.dest_ops.0,
            "q": fixed_bytes_to_hex(&data.mandate.q)
        }
    });

    SerializedTypedData {
        domain: serialize_domain(&data.domain),
        types: permit2_types(),
        primary_type: "PermitBatchWitnessTransferFrom".to_string(),
        message,
    }
}

// --- SingleChainOps ---

fn single_chain_types() -> Value {
    json!({
        "SingleChainOps": [
            { "name": "account", "type": "address" },
            { "name": "nonce", "type": "uint256" },
            { "name": "op", "type": "Op" },
            { "name": "gasRefund", "type": "GasRefund" }
        ],
        "Op": [
            { "name": "vt", "type": "bytes32" },
            { "name": "ops", "type": "Ops[]" }
        ],
        "GasRefund": [
            { "name": "token", "type": "address" },
            { "name": "exchangeRate", "type": "uint256" },
            { "name": "overhead", "type": "uint256" }
        ],
        "Ops": [
            { "name": "to", "type": "address" },
            { "name": "value", "type": "uint256" },
            { "name": "data", "type": "bytes" }
        ]
    })
}

fn serialize_single_chain(data: &SingleChainTypedData) -> SerializedTypedData {
    let gas_refund = json!({
        "token": addr_to_json(&data.gas_refund.token),
        "exchangeRate": parse_bigint(&data.gas_refund.exchange_rate),
        "overhead": parse_bigint(&data.gas_refund.overhead)
    });

    let message = json!({
        "account": addr_to_json(&data.account),
        "nonce": parse_bigint(&data.nonce),
        "op": data.op.0,
        "gasRefund": gas_refund
    });

    SerializedTypedData {
        domain: serialize_domain(&data.domain),
        types: single_chain_types(),
        primary_type: "SingleChainOps".to_string(),
        message,
    }
}
