use wasm_bindgen::prelude::*;
use rhinestone_encoding_core as core;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[wasm_bindgen]
pub fn version() -> String {
    VERSION.to_string()
}

// --- Validator Exports ---

#[wasm_bindgen]
pub fn get_ownable_validator(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::OwnableValidatorInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result =
        core::validators::ownable::encode(parsed).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_ens_validator(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::ENSValidatorInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result =
        core::validators::ens::encode(parsed).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_webauthn_validator(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::WebAuthnValidatorInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result =
        core::validators::webauthn::encode(parsed).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_multi_factor_validator(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::MultiFactorValidatorInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result =
        core::validators::multi_factor::encode(parsed).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

// --- EIP712 Typed Data Exports ---

#[wasm_bindgen]
pub fn get_compact_typed_data(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::CompactInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result =
        core::typed_data::compact::build_typed_data(parsed).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_permit2_typed_data(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::Permit2Input =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result =
        core::typed_data::permit2::build_typed_data(parsed).map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_single_chain_typed_data_legacy(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::SingleChainLegacyInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = core::typed_data::single_chain::build_typed_data_legacy(parsed)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn get_single_chain_typed_data_with_gas_refund(input: JsValue) -> Result<JsValue, JsValue> {
    let parsed: core::types::SingleChainGasRefundInput =
        serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = core::typed_data::single_chain::build_typed_data_with_gas_refund(parsed)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
