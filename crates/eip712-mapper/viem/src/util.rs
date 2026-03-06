use alloy_primitives::{Address, FixedBytes, U256};
use serde_json::Value;

pub fn parse_bigint(v: &U256) -> Value {
    Value::String(v.to_string())
}

pub fn addr_to_json(a: &Address) -> Value {
    Value::String(format!(
        "0x{}",
        alloy_primitives::hex::encode(a.as_slice())
    ))
}

pub fn fixed_bytes_to_hex<const N: usize>(b: &FixedBytes<N>) -> String {
    format!("0x{}", alloy_primitives::hex::encode(b.as_slice()))
}
