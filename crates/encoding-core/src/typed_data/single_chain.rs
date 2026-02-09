use serde_json::{json, Value};

use crate::types::{SingleChainGasRefundInput, SingleChainLegacyInput};

fn base_types() -> Value {
    json!({
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

fn parse_bigint(s: &str) -> Value {
    Value::String(s.to_string())
}

pub fn build_typed_data_legacy(input: SingleChainLegacyInput) -> Result<Value, String> {
    let chain_id: u64 = input
        .destination_chain_id
        .parse()
        .map_err(|e| format!("invalid chainId: {e}"))?;

    let mut types = base_types();
    let types_obj = types.as_object_mut().unwrap();
    types_obj.insert(
        "SingleChainOps".to_string(),
        json!([
            { "name": "account", "type": "address" },
            { "name": "nonce", "type": "uint256" },
            { "name": "op", "type": "Op" },
            { "name": "gasRefund", "type": "GasRefund" }
        ]),
    );
    types_obj.insert(
        "GasRefund".to_string(),
        json!([
            { "name": "token", "type": "address" },
            { "name": "exchangeRate", "type": "uint256" }
        ]),
    );

    Ok(json!({
        "domain": {
            "name": "IntentExecutor",
            "version": "v0.0.1",
            "chainId": chain_id,
            "verifyingContract": input.intent_executor_address
        },
        "types": types,
        "primaryType": "SingleChainOps",
        "message": {
            "account": input.account,
            "nonce": parse_bigint(&input.nonce),
            "op": input.destination_ops,
            "gasRefund": {
                "token": "0x0000000000000000000000000000000000000000",
                "exchangeRate": parse_bigint("0")
            }
        }
    }))
}

pub fn build_typed_data_with_gas_refund(input: SingleChainGasRefundInput) -> Result<Value, String> {
    let chain_id: u64 = input
        .destination_chain_id
        .parse()
        .map_err(|e| format!("invalid chainId: {e}"))?;

    let mut types = base_types();
    let types_obj = types.as_object_mut().unwrap();
    types_obj.insert(
        "SingleChainOps".to_string(),
        json!([
            { "name": "account", "type": "address" },
            { "name": "nonce", "type": "uint256" },
            { "name": "op", "type": "Op" },
            { "name": "gasRefund", "type": "GasRefund" }
        ]),
    );
    types_obj.insert(
        "GasRefund".to_string(),
        json!([
            { "name": "token", "type": "address" },
            { "name": "exchangeRate", "type": "uint256" },
            { "name": "overhead", "type": "uint256" }
        ]),
    );

    Ok(json!({
        "domain": {
            "name": "IntentExecutor",
            "version": "v0.0.1",
            "chainId": chain_id,
            "verifyingContract": input.intent_executor_address
        },
        "types": types,
        "primaryType": "SingleChainOps",
        "message": {
            "account": input.account,
            "nonce": parse_bigint(&input.nonce),
            "op": input.destination_ops,
            "gasRefund": {
                "token": input.gas_refund.token,
                "exchangeRate": parse_bigint(&input.gas_refund.exchange_rate),
                "overhead": parse_bigint(&input.gas_refund.overhead)
            }
        }
    }))
}
