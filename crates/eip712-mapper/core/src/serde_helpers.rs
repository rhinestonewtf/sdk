use alloy_primitives::U256;
use serde::{Deserialize, Deserializer};

pub mod decimal_u256 {
    use super::*;

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<U256, D::Error> {
        let s = String::deserialize(d)?;
        U256::from_str_radix(&s, 10).map_err(serde::de::Error::custom)
    }
}

pub mod decimal_u256_tuple_vec {
    use super::*;

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(U256, U256)>, D::Error> {
        let raw: Vec<(String, String)> = Vec::deserialize(d)?;
        raw.into_iter()
            .map(|(a, b)| {
                let ua = U256::from_str_radix(&a, 10).map_err(serde::de::Error::custom)?;
                let ub = U256::from_str_radix(&b, 10).map_err(serde::de::Error::custom)?;
                Ok((ua, ub))
            })
            .collect()
    }
}
