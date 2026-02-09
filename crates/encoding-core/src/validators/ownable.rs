use alloy_primitives::{Address, U256};
use alloy_sol_types::SolValue;
use std::str::FromStr;

use crate::types::{ModuleOutput, OwnableValidatorInput};

const OWNABLE_VALIDATOR_ADDRESS: &str = "0x000000000013fdb5234e4e3162a810f54d9f7e98";

pub fn encode(input: OwnableValidatorInput) -> Result<ModuleOutput, String> {
    let threshold = U256::from(input.threshold);

    let mut owners: Vec<Address> = input
        .owners
        .iter()
        .map(|o| Address::from_str(o).map_err(|e| format!("invalid owner address: {e}")))
        .collect::<Result<Vec<_>, _>>()?;

    // Sort owners by lowercase hex (matching TS: owners.map(o => o.toLowerCase()).sort())
    owners.sort();

    let init_data = (threshold, owners).abi_encode_params();
    let init_data_hex = format!("0x{}", alloy_primitives::hex::encode(&init_data));

    let address = input
        .address
        .unwrap_or_else(|| OWNABLE_VALIDATOR_ADDRESS.to_string());

    Ok(ModuleOutput::validator(&address, init_data_hex))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn golden_single_owner() {
        // accountA address from TS test consts
        let input = OwnableValidatorInput {
            threshold: 1,
            owners: vec!["0xf6c02c78ded62973b43bfa523b247da099486936".to_string()],
            address: None,
        };
        let result = encode(input).unwrap();
        assert_eq!(result.address, OWNABLE_VALIDATOR_ADDRESS);
        assert_eq!(result.de_init_data, "0x");
        assert_eq!(result.module_type, "validator");
        assert_eq!(
            result.init_data,
            "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936"
        );
    }

    #[test]
    fn golden_two_owners_sorted() {
        // accountA: 0xf6c02c78..., accountB: 0x6092086a...
        // After sorting: accountB < accountA
        let input = OwnableValidatorInput {
            threshold: 1,
            owners: vec![
                "0xf6c02c78ded62973b43bfa523b247da099486936".to_string(),
                "0x6092086a3dc0020cd604a68fcf5d430007d51bb7".to_string(),
            ],
            address: None,
        };
        let result = encode(input).unwrap();
        assert_eq!(
            result.init_data,
            "0x0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936"
        );
    }

    #[test]
    fn golden_three_owners_threshold_2() {
        let input = OwnableValidatorInput {
            threshold: 2,
            owners: vec![
                "0xf6c02c78ded62973b43bfa523b247da099486936".to_string(),
                "0x6092086a3dc0020cd604a68fcf5d430007d51bb7".to_string(),
                "0xc27b7578151c5ef713c62c65db09763d57ac3596".to_string(),
            ],
            address: None,
        };
        let result = encode(input).unwrap();
        assert_eq!(
            result.init_data,
            "0x0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000030000000000000000000000006092086a3dc0020cd604a68fcf5d430007d51bb7000000000000000000000000c27b7578151c5ef713c62c65db09763d57ac3596000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936"
        );
    }
}
