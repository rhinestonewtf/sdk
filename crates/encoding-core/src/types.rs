use serde::{Deserialize, Serialize};

/// Output for all validator encoding functions.
/// Maps to the TypeScript `Module` interface.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleOutput {
    pub address: String,
    pub init_data: String,
    pub de_init_data: String,
    pub additional_context: String,
    #[serde(rename = "type")]
    pub module_type: String,
}

impl ModuleOutput {
    pub fn validator(address: &str, init_data: String) -> Self {
        Self {
            address: address.to_string(),
            init_data,
            de_init_data: "0x".to_string(),
            additional_context: "0x".to_string(),
            module_type: "validator".to_string(),
        }
    }
}

// --- Validator Input DTOs ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnableValidatorInput {
    pub threshold: u64,
    pub owners: Vec<String>,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ENSValidatorInput {
    pub threshold: u64,
    pub owners: Vec<String>,
    pub owner_expirations: Vec<u64>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebAuthnCredentialInput {
    pub pub_key_x: String, // hex U256
    pub pub_key_y: String, // hex U256
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebAuthnValidatorInput {
    pub threshold: u64,
    pub credentials: Vec<WebAuthnCredentialInput>,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiFactorValidatorEntry {
    #[serde(rename = "type")]
    pub validator_type: String,
    pub threshold: Option<u64>,
    pub owners: Option<Vec<String>>,
    pub owner_expirations: Option<Vec<u64>>,
    pub credentials: Option<Vec<WebAuthnCredentialInput>>,
    pub address: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiFactorValidatorInput {
    pub threshold: u64,
    pub validators: Vec<Option<MultiFactorValidatorEntry>>,
}

// --- EIP712 Typed Data DTOs ---

#[derive(Debug, Serialize)]
pub struct TypedDataField {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedDataOutput {
    pub domain: serde_json::Value,
    pub types: serde_json::Value,
    pub primary_type: String,
    pub message: serde_json::Value,
}

// --- Compact Typed Data Input ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactInput {
    pub sponsor: String,
    pub nonce: String,
    pub expires: String,
    pub elements: Vec<CompactElementInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactElementInput {
    pub arbiter: String,
    pub chain_id: String,
    pub ids_and_amounts: Vec<(String, String)>,
    pub mandate: CompactMandateInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactMandateInput {
    pub recipient: String,
    pub token_out: Vec<(String, String)>,
    pub destination_chain_id: String,
    pub fill_deadline: String,
    pub min_gas: String,
    pub pre_claim_ops: serde_json::Value,
    pub destination_ops: serde_json::Value,
    pub qualifier_encoded_val: String, // raw hex — keccak256 computed in WASM
}

// --- Permit2 Typed Data Input ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permit2Input {
    pub element: Permit2ElementInput,
    pub nonce: String,
    pub expires: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permit2ElementInput {
    pub arbiter: String,
    pub chain_id: String,
    pub ids_and_amounts: Vec<(String, String)>,
    pub mandate: Permit2MandateInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permit2MandateInput {
    pub recipient: String,
    pub token_out: Vec<(String, String)>,
    pub destination_chain_id: String,
    pub fill_deadline: String,
    pub min_gas: String,
    pub pre_claim_ops: serde_json::Value,
    pub destination_ops: serde_json::Value,
    pub qualifier_encoded_val: String, // raw hex — keccak256 computed in WASM
}

// --- SingleChainOps Typed Data Input ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChainLegacyInput {
    pub account: String,
    pub intent_executor_address: String,
    pub destination_chain_id: String,
    pub destination_ops: serde_json::Value,
    pub nonce: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GasRefundInput {
    pub token: String,
    pub exchange_rate: String,
    pub overhead: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SingleChainGasRefundInput {
    pub account: String,
    pub intent_executor_address: String,
    pub destination_chain_id: String,
    pub destination_ops: serde_json::Value,
    pub nonce: String,
    pub gas_refund: GasRefundInput,
}
