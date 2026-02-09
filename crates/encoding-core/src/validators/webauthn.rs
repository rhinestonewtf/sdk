use alloy_primitives::U256;
use alloy_sol_types::{sol, SolValue};
use std::str::FromStr;

use crate::types::{ModuleOutput, WebAuthnValidatorInput};

const WEBAUTHN_VALIDATOR_ADDRESS: &str = "0x0000000000578c4cb0e472a5462da43c495c3f33";

sol! {
    struct Credential {
        uint256 pubKeyX;
        uint256 pubKeyY;
        bool requireUV;
    }
}

pub fn encode(input: WebAuthnValidatorInput) -> Result<ModuleOutput, String> {
    let threshold = U256::from(input.threshold);

    let credentials: Vec<Credential> = input
        .credentials
        .iter()
        .map(|c| {
            let pub_key_x =
                U256::from_str(&c.pub_key_x).map_err(|e| format!("invalid pubKeyX: {e}"))?;
            let pub_key_y =
                U256::from_str(&c.pub_key_y).map_err(|e| format!("invalid pubKeyY: {e}"))?;
            Ok(Credential {
                pubKeyX: pub_key_x,
                pubKeyY: pub_key_y,
                requireUV: false,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let init_data = (threshold, credentials).abi_encode_params();
    let init_data_hex = format!("0x{}", alloy_primitives::hex::encode(&init_data));

    let address = input
        .address
        .unwrap_or_else(|| WEBAUTHN_VALIDATOR_ADDRESS.to_string());

    Ok(ModuleOutput::validator(&address, init_data_hex))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::WebAuthnCredentialInput;

    #[test]
    fn golden_single_passkey() {
        let input = WebAuthnValidatorInput {
            threshold: 1,
            credentials: vec![WebAuthnCredentialInput {
                pub_key_x: "0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d373763".to_string(),
                pub_key_y: "0x7d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1".to_string(),
            }],
            address: None,
        };
        let result = encode(input).unwrap();
        assert_eq!(result.address, "0x0000000000578c4cb0e472a5462da43c495c3f33");
        assert_eq!(
            result.init_data,
            "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d10000000000000000000000000000000000000000000000000000000000000000"
        );
    }
}
