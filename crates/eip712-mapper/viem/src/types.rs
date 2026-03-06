use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct WasmOutput {
    pub origin: Vec<SerializedTypedData>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SerializedTypedData {
    pub domain: TypedDataDomain,
    pub types: serde_json::Value,
    pub primary_type: String,
    pub message: serde_json::Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TypedDataDomain {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub chain_id: u64,
    pub verifying_contract: String,
}

#[derive(Debug, Serialize)]
pub struct WasmError {
    pub error: String,
}
