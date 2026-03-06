use alloy_primitives::{Address, Bytes, U256};
use serde::Deserialize;

use crate::serde_helpers::{decimal_u256, decimal_u256_tuple_vec};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmInput {
    pub intent_op: IntentOp,
    pub context: WasmContext,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmContext {
    pub account_address: Address,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentOp {
    pub sponsor: Address,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub nonce: U256,
    #[allow(dead_code)]
    pub target_execution_nonce: Option<String>,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub expires: U256,
    pub elements: Vec<IntentOpElement>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentOpElement {
    pub arbiter: Address,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub chain_id: U256,
    #[serde(deserialize_with = "decimal_u256_tuple_vec::deserialize")]
    pub ids_and_amounts: Vec<(U256, U256)>,
    pub mandate: IntentOpElementMandate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentOpElementMandate {
    pub recipient: Address,
    #[serde(deserialize_with = "decimal_u256_tuple_vec::deserialize")]
    pub token_out: Vec<(U256, U256)>,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub destination_chain_id: U256,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub fill_deadline: U256,
    pub destination_ops: serde_json::Value,
    pub pre_claim_ops: serde_json::Value,
    pub qualifier: Qualifier,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub min_gas: U256,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Qualifier {
    pub settlement_context: SettlementContext,
    pub encoded_val: Bytes,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettlementContext {
    pub settlement_layer: String,
    pub funding_method: String,
    pub gas_refund: Option<GasRefund>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GasRefund {
    pub token: Address,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub exchange_rate: U256,
    #[serde(deserialize_with = "decimal_u256::deserialize")]
    pub overhead: U256,
}
