use crate::compact;
use crate::input::WasmInput;
use crate::permit2;
use crate::single_chain;
use crate::types::TypedDataResult;

/// Routes an intent operation to the correct EIP-712 builder based on the settlement strategy.
///
/// The orchestrator backend decides how each intent should be settled and communicates this
/// via `settlementContext` fields inside each element's `mandate.qualifier`. This function
/// reads those fields and delegates to the appropriate builder.
///
/// # Settlement type detection (checked in order)
///
/// 1. **INTENT_EXECUTOR** — If any element has `settlementContext.settlementLayer == "INTENT_EXECUTOR"`,
///    the entire intent uses the SingleChainOps path. This is for same-chain intents that go through
///    Rhinestone's IntentExecutor contract. Each element produces its own `SingleChainTypedData`.
///
/// 2. **PERMIT2** — If any element has `settlementContext.fundingMethod == "PERMIT2"`,
///    the intent uses Uniswap's Permit2 protocol for token approvals. Each element produces
///    its own `Permit2TypedData`.
///
/// 3. **Compact** (default) — If neither condition matches, the intent uses The Compact protocol
///    for cross-chain transfers. All elements are combined into a single `CompactTypedData`.
///
/// # Errors
///
/// Returns an error if:
/// - `intentOp.elements` is empty (nothing to sign)
/// - Any individual builder fails (e.g. missing required fields)
pub fn build(input: &WasmInput) -> Result<TypedDataResult, String> {
    let intent_op = &input.intent_op;
    let context = &input.context;

    if intent_op.elements.is_empty() {
        return Err("intentOp.elements must not be empty".to_string());
    }

    // Check if any element uses the IntentExecutor settlement layer.
    // This takes priority over Permit2 — an intent can't mix settlement types.
    let has_intent_executor = intent_op.elements.iter().any(|el| {
        el.mandate.qualifier.settlement_context.settlement_layer == "INTENT_EXECUTOR"
    });

    // Check if any element uses Permit2 for token funding.
    let has_permit2 = intent_op
        .elements
        .iter()
        .any(|el| el.mandate.qualifier.settlement_context.funding_method == "PERMIT2");

    if has_intent_executor {
        // SingleChainOps: one typed data per element, each signed independently.
        // The account address comes from the WASM input context (it's the user's smart account).
        let results: Result<Vec<_>, String> = intent_op
            .elements
            .iter()
            .map(|element| {
                single_chain::build(
                    &context.account_address,
                    element,
                    &intent_op.nonce,
                )
            })
            .collect();
        Ok(TypedDataResult::SingleChain(results?))
    } else if has_permit2 {
        // Permit2: one typed data per element, using Uniswap's PermitBatchWitnessTransferFrom.
        let results: Result<Vec<_>, String> = intent_op
            .elements
            .iter()
            .map(|element| permit2::build(element, &intent_op.nonce, &intent_op.expires))
            .collect();
        Ok(TypedDataResult::Permit2(results?))
    } else {
        // Compact: all elements combined into a single MultichainCompact struct.
        let data = compact::build(intent_op)?;
        Ok(TypedDataResult::Compact(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: builds a minimal valid WasmInput JSON string with the given settlement fields.
    fn make_input_json(settlement_layer: &str, funding_method: &str) -> String {
        format!(
            r#"{{
                "intentOp": {{
                    "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                    "nonce": "1",
                    "expires": "1700000000",
                    "elements": [{{
                        "arbiter": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "chainId": "8453",
                        "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                        "mandate": {{
                            "recipient": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                            "destinationChainId": "8453",
                            "fillDeadline": "1700001000",
                            "destinationOps": {{"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []}},
                            "preClaimOps": {{"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []}},
                            "qualifier": {{
                                "settlementContext": {{
                                    "settlementLayer": "{}",
                                    "fundingMethod": "{}"
                                }},
                                "encodedVal": "0xdeadbeef"
                            }},
                            "minGas": "21000"
                        }}
                    }}]
                }},
                "context": {{
                    "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
                }}
            }}"#,
            settlement_layer, funding_method
        )
    }

    /// Helper: builds input with multiple elements (each with their own settlement fields).
    fn make_multi_element_json(elements: &[(&str, &str)]) -> String {
        let element_jsons: Vec<String> = elements
            .iter()
            .map(|(sl, fm)| {
                format!(
                    r#"{{
                        "arbiter": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "chainId": "8453",
                        "idsAndAmounts": [["749071750893463290574776461331093852760741783827", "1000000"]],
                        "mandate": {{
                            "recipient": "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                            "tokenOut": [["749071750893463290574776461331093852760741783827", "500000"]],
                            "destinationChainId": "8453",
                            "fillDeadline": "1700001000",
                            "destinationOps": {{"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []}},
                            "preClaimOps": {{"vt": "0x0000000000000000000000000000000000000000000000000000000000000000", "ops": []}},
                            "qualifier": {{
                                "settlementContext": {{
                                    "settlementLayer": "{}",
                                    "fundingMethod": "{}"
                                }},
                                "encodedVal": "0xdeadbeef"
                            }},
                            "minGas": "21000"
                        }}
                    }}"#,
                    sl, fm
                )
            })
            .collect();

        format!(
            r#"{{
                "intentOp": {{
                    "sponsor": "0x7a07d9cc408dd92165900c302d31d914d26b3827",
                    "nonce": "1",
                    "expires": "1700000000",
                    "elements": [{}]
                }},
                "context": {{
                    "accountAddress": "0x7a07d9cc408dd92165900c302d31d914d26b3827"
                }}
            }}"#,
            element_jsons.join(",")
        )
    }

    // ---- Settlement routing ----

    #[test]
    fn routes_to_compact_by_default() {
        let json = make_input_json("SAME_CHAIN", "COMPACT");
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        assert!(matches!(result, TypedDataResult::Compact(_)));
    }

    #[test]
    fn routes_to_permit2_when_funding_method_is_permit2() {
        let json = make_input_json("ACROSS", "PERMIT2");
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        assert!(matches!(result, TypedDataResult::Permit2(_)));
    }

    #[test]
    fn routes_to_single_chain_when_settlement_layer_is_intent_executor() {
        let json = make_input_json("INTENT_EXECUTOR", "NO_FUNDING");
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        assert!(matches!(result, TypedDataResult::SingleChain(_)));
    }

    #[test]
    fn intent_executor_takes_priority_over_permit2() {
        // Even if fundingMethod is PERMIT2, INTENT_EXECUTOR should win.
        let json = make_input_json("INTENT_EXECUTOR", "PERMIT2");
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        assert!(matches!(result, TypedDataResult::SingleChain(_)));
    }

    // ---- Empty elements ----

    #[test]
    fn errors_on_empty_elements() {
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
        let input: WasmInput = serde_json::from_str(json).unwrap();
        let err = build(&input).unwrap_err();
        assert!(err.contains("empty"));
    }

    // ---- Multi-element ----

    #[test]
    fn compact_returns_single_typed_data_regardless_of_element_count() {
        let json = make_multi_element_json(&[
            ("SAME_CHAIN", "COMPACT"),
            ("SAME_CHAIN", "COMPACT"),
            ("SAME_CHAIN", "COMPACT"),
        ]);
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        match result {
            TypedDataResult::Compact(data) => {
                // Compact combines all elements into one struct.
                assert_eq!(data.elements.len(), 3);
            }
            _ => panic!("expected Compact"),
        }
    }

    #[test]
    fn permit2_returns_one_typed_data_per_element() {
        let json = make_multi_element_json(&[
            ("ACROSS", "PERMIT2"),
            ("ACROSS", "PERMIT2"),
        ]);
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        match result {
            TypedDataResult::Permit2(vec) => {
                assert_eq!(vec.len(), 2);
            }
            _ => panic!("expected Permit2"),
        }
    }

    #[test]
    fn single_chain_returns_one_typed_data_per_element() {
        let json = make_multi_element_json(&[
            ("INTENT_EXECUTOR", "NO_FUNDING"),
            ("INTENT_EXECUTOR", "NO_FUNDING"),
        ]);
        let input: WasmInput = serde_json::from_str(&json).unwrap();
        let result = build(&input).unwrap();
        match result {
            TypedDataResult::SingleChain(vec) => {
                assert_eq!(vec.len(), 2);
            }
            _ => panic!("expected SingleChain"),
        }
    }
}
