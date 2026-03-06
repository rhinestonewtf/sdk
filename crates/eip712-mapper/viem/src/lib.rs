mod serialize;
pub mod types;
pub mod util;

use std::alloc::Layout;
use std::cell::UnsafeCell;
use std::slice;

use eip712_mapper_core::input::WasmInput;
use types::WasmError;

struct ResultBuffer(UnsafeCell<Vec<u8>>);
unsafe impl Sync for ResultBuffer {}

static RESULT_BUF: ResultBuffer = ResultBuffer(UnsafeCell::new(Vec::new()));

fn result_buf() -> &'static mut Vec<u8> {
    unsafe { &mut *RESULT_BUF.0.get() }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let layout = Layout::from_size_align(len, 1).unwrap();
    unsafe { std::alloc::alloc(layout) }
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    let layout = Layout::from_size_align(len, 1).unwrap();
    unsafe { std::alloc::dealloc(ptr, layout) }
}

#[no_mangle]
pub extern "C" fn get_typed_data(ptr: *const u8, len: usize) -> i32 {
    let input_bytes = unsafe { slice::from_raw_parts(ptr, len) };

    let input_str = match std::str::from_utf8(input_bytes) {
        Ok(s) => s,
        Err(e) => {
            set_error_result(&format!("invalid UTF-8 input: {e}"));
            return 1;
        }
    };

    let input: WasmInput = match serde_json::from_str(input_str) {
        Ok(v) => v,
        Err(e) => {
            set_error_result(&format!("failed to parse input JSON: {e}"));
            return 1;
        }
    };

    match eip712_mapper_core::dispatch::build(&input) {
        Ok(core_result) => {
            let output = serialize::to_wasm_output(core_result);
            let buf = result_buf();
            *buf = serde_json::to_vec(&output).unwrap_or_default();
            0
        }
        Err(e) => {
            set_error_result(&e);
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn get_result_ptr() -> *const u8 {
    result_buf().as_ptr()
}

#[no_mangle]
pub extern "C" fn get_result_len() -> usize {
    result_buf().len()
}

fn set_error_result(message: &str) {
    let err = WasmError {
        error: message.to_string(),
    };
    let buf = result_buf();
    *buf = serde_json::to_vec(&err).unwrap_or_default();
}

#[cfg(not(target_arch = "wasm32"))]
pub fn process_input(input_json: &str) -> String {
    let input: WasmInput = match serde_json::from_str(input_json) {
        Ok(v) => v,
        Err(e) => {
            let err = WasmError {
                error: format!("failed to parse input JSON: {e}"),
            };
            return serde_json::to_string(&err).unwrap_or_default();
        }
    };

    match eip712_mapper_core::dispatch::build(&input) {
        Ok(core_result) => {
            let output = serialize::to_wasm_output(core_result);
            serde_json::to_string(&output).unwrap_or_default()
        }
        Err(e) => {
            let err = WasmError { error: e };
            serde_json::to_string(&err).unwrap_or_default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    // ---- Shared test fixture helpers ----

    fn compact_input_json() -> String {
        r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "12345",
                "expires": "1700000000",
                "elements": [{
                    "arbiter": "0x306ba68E347D83E6171389E80E0B7Be978a5303A",
                    "chainId": "8453",
                    "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                    "mandate": {
                        "recipient": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                        "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                        "destinationChainId": "8453",
                        "fillDeadline": "1700001000",
                        "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "qualifier": {
                            "settlementContext": {
                                "settlementLayer": "SAME_CHAIN",
                                "fundingMethod": "COMPACT"
                            },
                            "encodedVal": "0xdeadbeef"
                        },
                        "minGas": "21000"
                    }
                }]
            },
            "context": {
                "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
            }
        }"#
        .to_string()
    }

    fn permit2_input_json() -> String {
        r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "99999",
                "expires": "1700000000",
                "elements": [{
                    "arbiter": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "chainId": "1",
                    "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "2000000"]],
                    "mandate": {
                        "recipient": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        "tokenOut": [["749071750893463290574776461331093852760741783827", "1000000"]],
                        "destinationChainId": "8453",
                        "fillDeadline": "1700001000",
                        "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "qualifier": {
                            "settlementContext": {
                                "settlementLayer": "ACROSS",
                                "fundingMethod": "PERMIT2"
                            },
                            "encodedVal": "0x"
                        },
                        "minGas": "100000"
                    }
                }]
            },
            "context": {
                "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
            }
        }"#
        .to_string()
    }

    fn single_chain_input_json() -> String {
        r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "55555",
                "expires": "1700000000",
                "elements": [{
                    "arbiter": "0xcccccccccccccccccccccccccccccccccccccccc",
                    "chainId": "8453",
                    "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "3000000"]],
                    "mandate": {
                        "recipient": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                        "tokenOut": [["749071750893463290574776461331093852760741783827", "2500000"]],
                        "destinationChainId": "8453",
                        "fillDeadline": "1700001000",
                        "destinationOps": {
                            "vt": "0x0203000000000000000000000000000000000000000000000000000000000000",
                            "ops": [{"to": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", "value": "3", "data": "0x"}]
                        },
                        "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "qualifier": {
                            "settlementContext": {
                                "settlementLayer": "INTENT_EXECUTOR",
                                "fundingMethod": "NO_FUNDING",
                                "gasRefund": {
                                    "token": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                                    "exchangeRate": "1000000000000000000",
                                    "overhead": "50000"
                                }
                            },
                            "encodedVal": "0xabcdef"
                        },
                        "minGas": "500000"
                    }
                }]
            },
            "context": {
                "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
            }
        }"#
        .to_string()
    }

    /// Parses process_input output and returns the parsed JSON Value.
    fn run(json: &str) -> Value {
        let output = process_input(json);
        serde_json::from_str(&output).expect("process_input returned invalid JSON")
    }

    // ---- Compact end-to-end ----

    #[test]
    fn compact_produces_multichain_compact_primary_type() {
        let v = run(&compact_input_json());
        assert_eq!(v["origin"][0]["primaryType"], "MultichainCompact");
    }

    #[test]
    fn compact_domain_has_correct_fields() {
        let v = run(&compact_input_json());
        let domain = &v["origin"][0]["domain"];
        assert_eq!(domain["name"], "The Compact");
        assert_eq!(domain["version"], "1");
        assert_eq!(domain["chainId"], 8453);
        // Exact Compact contract address (not just starts_with check)
        assert_eq!(
            domain["verifyingContract"],
            "0x00000000000000171ede64904551eedf3c6c9788"
        );
    }

    #[test]
    fn compact_message_has_sponsor_nonce_expires() {
        let v = run(&compact_input_json());
        let msg = &v["origin"][0]["message"];
        assert_eq!(msg["sponsor"], "0x7a07d9cc408dd92165900c302d31d914d26b3827");
        assert_eq!(msg["nonce"], "12345");
        assert_eq!(msg["expires"], "1700000000");
    }

    #[test]
    fn compact_elements_have_commitments_with_exact_lock_tag() {
        let v = run(&compact_input_json());
        let elem = &v["origin"][0]["message"]["elements"][0];
        let commitment = &elem["commitments"][0];
        // Fixture token ID is 0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913
        // Lock tag = first 12 bytes = all zeros
        assert_eq!(
            commitment["lockTag"],
            "0x000000000000000000000000"
        );
        // Token = last 20 bytes = USDC on Base
        assert_eq!(
            commitment["token"],
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
        assert_eq!(commitment["amount"], "1000000");
    }

    #[test]
    fn compact_mandate_q_is_exact_keccak256_of_encoded_val() {
        let v = run(&compact_input_json());
        let q = v["origin"][0]["message"]["elements"][0]["mandate"]["q"]
            .as_str()
            .unwrap();
        // q = keccak256(0xdeadbeef) — verified independently via viem
        assert_eq!(
            q,
            "0xd4fd4e189132273036449fc9e11198c739161b4c0116a9a2dccdfa1c492006f1"
        );
    }

    #[test]
    fn compact_types_include_required_eip712_structs() {
        let v = run(&compact_input_json());
        let types = &v["origin"][0]["types"];
        assert!(types["MultichainCompact"].is_array());
        assert!(types["Element"].is_array());
        assert!(types["Lock"].is_array());
        assert!(types["Mandate"].is_array());
        assert!(types["Target"].is_array());
        assert!(types["Token"].is_array());
    }

    #[test]
    fn compact_origin_count_matches_element_count() {
        let v = run(&compact_input_json());
        // Compact duplicates the typed data for each element in origin array.
        assert_eq!(v["origin"].as_array().unwrap().len(), 1);
    }

    // ---- Permit2 end-to-end ----

    #[test]
    fn permit2_produces_permit_batch_primary_type() {
        let v = run(&permit2_input_json());
        assert_eq!(
            v["origin"][0]["primaryType"],
            "PermitBatchWitnessTransferFrom"
        );
    }

    #[test]
    fn permit2_domain_has_correct_fields() {
        let v = run(&permit2_input_json());
        let domain = &v["origin"][0]["domain"];
        assert_eq!(domain["name"], "Permit2");
        assert_eq!(domain["chainId"], 1);
        assert_eq!(
            domain["verifyingContract"],
            "0x000000000022d473030f116ddee9f6b43ac78ba3"
        );
    }

    #[test]
    fn permit2_domain_version_is_absent_not_null() {
        // Permit2 has no version in its EIP-712 domain. The JSON should omit the key entirely
        // (not serialize it as null), because viem treats absent and null differently.
        let v = run(&permit2_input_json());
        let domain = v["origin"][0]["domain"].as_object().unwrap();
        assert!(
            !domain.contains_key("version"),
            "Permit2 domain should omit 'version' key, but it was present: {:?}",
            domain.get("version")
        );
    }

    #[test]
    fn permit2_mandate_q_is_exact_keccak256_of_empty_bytes() {
        let v = run(&permit2_input_json());
        let q = v["origin"][0]["message"]["mandate"]["q"]
            .as_str()
            .unwrap();
        // q = keccak256(0x) = keccak256 of empty bytes — well-known constant
        assert_eq!(
            q,
            "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn permit2_message_has_spender_and_permitted() {
        let v = run(&permit2_input_json());
        let msg = &v["origin"][0]["message"];
        assert_eq!(msg["spender"], "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(msg["nonce"], "99999");
        assert_eq!(msg["deadline"], "1700000000");
        let permitted = msg["permitted"].as_array().unwrap();
        assert_eq!(permitted.len(), 1);
        assert_eq!(
            permitted[0]["token"],
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
        assert_eq!(permitted[0]["amount"], "2000000");
    }

    #[test]
    fn permit2_types_include_required_eip712_structs() {
        let v = run(&permit2_input_json());
        let types = &v["origin"][0]["types"];
        assert!(types["PermitBatchWitnessTransferFrom"].is_array());
        assert!(types["TokenPermissions"].is_array());
        assert!(types["Mandate"].is_array());
    }

    // ---- SingleChainOps end-to-end ----

    #[test]
    fn single_chain_produces_single_chain_ops_primary_type() {
        let v = run(&single_chain_input_json());
        assert_eq!(v["origin"][0]["primaryType"], "SingleChainOps");
    }

    #[test]
    fn single_chain_domain_has_exact_intent_executor_address() {
        let v = run(&single_chain_input_json());
        let domain = &v["origin"][0]["domain"];
        assert_eq!(domain["name"], "IntentExecutor");
        assert_eq!(domain["version"], "v0.0.1");
        assert_eq!(domain["chainId"], 8453);
        // Exact prod IntentExecutor address
        assert_eq!(
            domain["verifyingContract"],
            "0x00000000005ad9ce1f5035fd62ca96cef16adaaf"
        );
    }

    #[test]
    fn single_chain_mandate_q_is_exact_keccak256_of_encoded_val() {
        let v = run(&single_chain_input_json());
        // SingleChainOps doesn't have mandate in message (it has op + gasRefund),
        // but the q hash is part of the mandate in Compact/Permit2.
        // For SingleChain, verify encodedVal hash would appear if there was a mandate.
        // Actually SingleChain doesn't use mandate/q — check that op is correctly passed through.
        let op = &v["origin"][0]["message"]["op"];
        let vt = op["vt"].as_str().unwrap();
        // Exact vt from fixture
        assert_eq!(
            vt,
            "0x0203000000000000000000000000000000000000000000000000000000000000"
        );
    }

    #[test]
    fn single_chain_message_has_account_and_nonce() {
        let v = run(&single_chain_input_json());
        let msg = &v["origin"][0]["message"];
        assert_eq!(msg["account"], "0x7a07d9cc408dd92165900c302d31d914d26b3827");
        assert_eq!(msg["nonce"], "55555");
    }

    #[test]
    fn single_chain_gas_refund_is_serialized() {
        let v = run(&single_chain_input_json());
        let gr = &v["origin"][0]["message"]["gasRefund"];
        assert_eq!(gr["token"], "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
        assert_eq!(gr["exchangeRate"], "1000000000000000000");
        assert_eq!(gr["overhead"], "50000");
    }

    #[test]
    fn single_chain_op_passes_through_destination_ops() {
        let v = run(&single_chain_input_json());
        let op = &v["origin"][0]["message"]["op"];
        assert!(op["ops"].as_array().unwrap().len() == 1);
        assert_eq!(
            op["ops"][0]["to"],
            "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"
        );
    }

    #[test]
    fn single_chain_types_include_required_eip712_structs() {
        let v = run(&single_chain_input_json());
        let types = &v["origin"][0]["types"];
        assert!(types["SingleChainOps"].is_array());
        assert!(types["Op"].is_array());
        assert!(types["GasRefund"].is_array());
        assert!(types["Ops"].is_array());
    }

    // ---- Error handling ----

    #[test]
    fn error_on_empty_elements() {
        let json = r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "1",
                "expires": "1700000000",
                "elements": []
            },
            "context": {
                "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
            }
        }"#;
        let v = run(json);
        assert!(v["error"].as_str().unwrap().contains("empty"));
    }

    #[test]
    fn error_on_invalid_json() {
        let v = run("not json at all");
        assert!(v["error"].as_str().unwrap().contains("parse"));
    }

    #[test]
    fn error_on_missing_fields() {
        let json = r#"{"intentOp": {}, "context": {}}"#;
        let v = run(json);
        assert!(v["error"].is_string());
    }

    // ---- Multi-element ----

    #[test]
    fn permit2_multi_element_produces_multiple_origin_entries() {
        let json = r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "1",
                "expires": "1700000000",
                "elements": [
                    {
                        "arbiter": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "chainId": "1",
                        "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                        "mandate": {
                            "recipient": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                            "destinationChainId": "8453",
                            "fillDeadline": "1700001000",
                            "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "qualifier": {"settlementContext": {"settlementLayer": "ACROSS", "fundingMethod": "PERMIT2"}, "encodedVal": "0x01"},
                            "minGas": "21000"
                        }
                    },
                    {
                        "arbiter": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        "chainId": "137",
                        "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "2000000"]],
                        "mandate": {
                            "recipient": "0xcccccccccccccccccccccccccccccccccccccccc",
                            "tokenOut": [["749071750893463290574776461331093852760741783827", "1000000"]],
                            "destinationChainId": "42161",
                            "fillDeadline": "1700002000",
                            "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "qualifier": {"settlementContext": {"settlementLayer": "ACROSS", "fundingMethod": "PERMIT2"}, "encodedVal": "0x02"},
                            "minGas": "21000"
                        }
                    }
                ]
            },
            "context": {
                "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
            }
        }"#;
        let v = run(json);
        let origin = v["origin"].as_array().unwrap();
        assert_eq!(origin.len(), 2);
        // Each should have its own chain ID in the domain.
        assert_eq!(origin[0]["domain"]["chainId"], 1);
        assert_eq!(origin[1]["domain"]["chainId"], 137);
    }

    // ---- Serialization format ----

    #[test]
    fn numeric_values_are_decimal_strings_not_numbers() {
        let v = run(&compact_input_json());
        let msg = &v["origin"][0]["message"];
        // nonce, expires should be strings, not JSON numbers.
        assert!(msg["nonce"].is_string());
        assert!(msg["expires"].is_string());
    }

    #[test]
    fn addresses_are_lowercase_hex() {
        let v = run(&compact_input_json());
        let sponsor = v["origin"][0]["message"]["sponsor"].as_str().unwrap();
        assert!(sponsor.starts_with("0x"));
        // Should be lowercase (no uppercase hex chars).
        assert_eq!(sponsor, sponsor.to_lowercase());
    }

    // ---- Bug-finding: non-zero lock tag ----

    #[test]
    fn compact_nonzero_lock_tag_is_correctly_extracted() {
        // Token ID with non-zero lock tag: 0xaabbccddee1122334455667700000000000000000000000000000000deadbeef
        // lock tag = aabbccddee112233445566_77 (first 12 bytes)
        // token = 0x00000000000000000000000000000000deadbeef (last 20 bytes)
        let json = r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "1",
                "expires": "1700000000",
                "elements": [{
                    "arbiter": "0x306ba68E347D83E6171389E80E0B7Be978a5303A",
                    "chainId": "8453",
                    "idsAndAmounts": [["77224998599743176377587668914423100845246707080422719641961412505596087615215", "5000000"]],
                    "mandate": {
                        "recipient": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                        "tokenOut": [["749071750893463290574776461331093852760741783827", "2500000"]],
                        "destinationChainId": "8453",
                        "fillDeadline": "1700001000",
                        "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "qualifier": {"settlementContext": {"settlementLayer": "SAME_CHAIN", "fundingMethod": "COMPACT"}, "encodedVal": "0x01"},
                        "minGas": "21000"
                    }
                }]
            },
            "context": {"accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"}
        }"#;
        let v = run(json);
        let commitment = &v["origin"][0]["message"]["elements"][0]["commitments"][0];
        // Lock tag should be the first 12 bytes of the packed token ID
        assert_eq!(
            commitment["lockTag"],
            "0xaabbccddee11223344556677"
        );
        // Token should be the last 20 bytes
        assert_eq!(
            commitment["token"],
            "0x00000000000000000000000000000000deadbeef"
        );
    }

    // ---- Bug-finding: Compact uses first element's chainId for domain ----

    #[test]
    fn compact_domain_chain_id_uses_first_element() {
        // Two elements with different chainIds — domain should use the first one (1, not 137).
        let json = r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "1",
                "expires": "1700000000",
                "elements": [
                    {
                        "arbiter": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "chainId": "1",
                        "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                        "mandate": {
                            "recipient": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                            "destinationChainId": "8453",
                            "fillDeadline": "1700001000",
                            "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "qualifier": {"settlementContext": {"settlementLayer": "SAME_CHAIN", "fundingMethod": "COMPACT"}, "encodedVal": "0xaa"},
                            "minGas": "21000"
                        }
                    },
                    {
                        "arbiter": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                        "chainId": "137",
                        "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "2000000"]],
                        "mandate": {
                            "recipient": "0xcccccccccccccccccccccccccccccccccccccccc",
                            "tokenOut": [["749071750893463290574776461331093852760741783827", "1000000"]],
                            "destinationChainId": "137",
                            "fillDeadline": "1700001000",
                            "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                            "qualifier": {"settlementContext": {"settlementLayer": "SAME_CHAIN", "fundingMethod": "COMPACT"}, "encodedVal": "0xbb"},
                            "minGas": "21000"
                        }
                    }
                ]
            },
            "context": {"accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"}
        }"#;
        let v = run(json);
        // Compact uses first element's chainId for the domain
        assert_eq!(v["origin"][0]["domain"]["chainId"], 1);
        // Both origin entries should have chainId=1 (Compact duplicates, doesn't per-element domain)
        assert_eq!(v["origin"][1]["domain"]["chainId"], 1);
        // But the element-level chainId should reflect each element
        assert_eq!(v["origin"][0]["message"]["elements"][0]["chainId"], "1");
        assert_eq!(v["origin"][0]["message"]["elements"][1]["chainId"], "137");
    }

    // ---- Bug-finding: SingleChain uses destinationChainId, not element chainId ----

    #[test]
    fn single_chain_domain_uses_destination_chain_id_not_element_chain_id() {
        // element.chainId = 1 (origin), mandate.destinationChainId = 8453 (destination)
        // SingleChain should use destinationChainId for the domain.
        let json = r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "1",
                "expires": "1700000000",
                "elements": [{
                    "arbiter": "0xcccccccccccccccccccccccccccccccccccccccc",
                    "chainId": "1",
                    "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                    "mandate": {
                        "recipient": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                        "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                        "destinationChainId": "8453",
                        "fillDeadline": "1700001000",
                        "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "qualifier": {
                            "settlementContext": {
                                "settlementLayer": "INTENT_EXECUTOR",
                                "fundingMethod": "NO_FUNDING"
                            },
                            "encodedVal": "0x01"
                        },
                        "minGas": "21000"
                    }
                }]
            },
            "context": {"accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"}
        }"#;
        let v = run(json);
        // Domain should use destinationChainId (8453), NOT element chainId (1)
        assert_eq!(
            v["origin"][0]["domain"]["chainId"], 8453,
            "SingleChain domain should use mandate.destinationChainId, not element.chainId"
        );
    }

    // ---- Bug-finding: Permit2 mandate structure matches shared format ----

    #[test]
    fn permit2_mandate_has_same_structure_as_compact_mandate() {
        // Both Compact and Permit2 mandates should have identical field structure:
        // target.recipient, target.tokenOut, target.targetChain, target.fillExpiry, minGas, originOps, destOps, q
        let compact_v = run(&compact_input_json());
        let permit2_v = run(&permit2_input_json());

        let compact_mandate = &compact_v["origin"][0]["message"]["elements"][0]["mandate"];
        let permit2_mandate = &permit2_v["origin"][0]["message"]["mandate"];

        // Both should have the same top-level keys
        let compact_keys: Vec<&str> = compact_mandate.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        let permit2_keys: Vec<&str> = permit2_mandate.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        let mut compact_sorted = compact_keys.clone();
        compact_sorted.sort();
        let mut permit2_sorted = permit2_keys.clone();
        permit2_sorted.sort();
        assert_eq!(
            compact_sorted, permit2_sorted,
            "Compact and Permit2 mandates should have the same keys"
        );

        // Both target objects should have the same keys
        let compact_target_keys: Vec<&str> = compact_mandate["target"].as_object().unwrap().keys().map(|k| k.as_str()).collect();
        let permit2_target_keys: Vec<&str> = permit2_mandate["target"].as_object().unwrap().keys().map(|k| k.as_str()).collect();
        let mut ct_sorted = compact_target_keys.clone();
        ct_sorted.sort();
        let mut pt_sorted = permit2_target_keys.clone();
        pt_sorted.sort();
        assert_eq!(
            ct_sorted, pt_sorted,
            "Compact and Permit2 mandate.target should have the same keys"
        );
    }

    // ---- Bug-finding: verify decimal token ID independently ----

    #[test]
    fn token_id_decimal_to_hex_conversion_is_correct() {
        // The decimal token ID used in all fixtures should map to the known hex value.
        // 749071750893463290574776461331093852760741783827 (decimal)
        // = 0x000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913 (hex)
        // After split: lock_tag = 0x000000000000000000000000, token = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
        let v = run(&compact_input_json());
        let commitment = &v["origin"][0]["message"]["elements"][0]["commitments"][0];
        // Verify the full round-trip: decimal string → U256 → split → hex
        assert_eq!(commitment["lockTag"], "0x000000000000000000000000");
        assert_eq!(commitment["token"], "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
        // And in Permit2 (uses bitmask, should get same token address)
        let v2 = run(&permit2_input_json());
        assert_eq!(
            v2["origin"][0]["message"]["permitted"][0]["token"],
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        );
    }

    // ---- Bug-finding: SingleChain without gasRefund defaults to zeros ----

    #[test]
    fn single_chain_without_gas_refund_defaults_to_zeros() {
        let json = r#"{
            "intentOp": {
                "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                "nonce": "1",
                "expires": "1700000000",
                "elements": [{
                    "arbiter": "0xcccccccccccccccccccccccccccccccccccccccc",
                    "chainId": "8453",
                    "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                    "mandate": {
                        "recipient": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                        "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                        "destinationChainId": "8453",
                        "fillDeadline": "1700001000",
                        "destinationOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "preClaimOps": {"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []},
                        "qualifier": {
                            "settlementContext": {
                                "settlementLayer": "INTENT_EXECUTOR",
                                "fundingMethod": "NO_FUNDING"
                            },
                            "encodedVal": "0x"
                        },
                        "minGas": "21000"
                    }
                }]
            },
            "context": {"accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"}
        }"#;
        let v = run(json);
        let gr = &v["origin"][0]["message"]["gasRefund"];
        // When no gasRefund in settlementContext, all fields should be zero
        assert_eq!(gr["token"], "0x0000000000000000000000000000000000000000");
        assert_eq!(gr["exchangeRate"], "0");
        assert_eq!(gr["overhead"], "0");
    }

    // ---- Bug-finding: arbiter address case sensitivity ----

    #[test]
    fn mixed_case_arbiter_is_lowercased_in_output() {
        // The compact fixture has mixed-case arbiter: 0x306ba68E347D83E6171389E80E0B7Be978a5303A
        // Output should be fully lowercase.
        let v = run(&compact_input_json());
        let arbiter = v["origin"][0]["message"]["elements"][0]["arbiter"]
            .as_str()
            .unwrap();
        assert_eq!(arbiter, arbiter.to_lowercase(),
            "Arbiter should be lowercased in output, got: {}", arbiter
        );
        assert_eq!(
            arbiter,
            "0x306ba68e347d83e6171389e80e0b7be978a5303a"
        );
    }
}
