use alloy_primitives::{address, U256};

use crate::input::IntentOpElement;
use crate::types::{
    Eip712Domain, Mandate, MandateTarget, OpBatch, Permit2TypedData, TokenAmount,
};
use crate::util::{keccak256_bytes, to_token};

/// Uniswap Permit2 contract address (canonical deployment across all EVM chains).
/// Used as the EIP-712 `verifyingContract` for Permit2-based settlements.
const PERMIT2_ADDRESS: alloy_primitives::Address =
    address!("000000000022D473030F116dDEE9F6B43aC78BA3");

/// Builds a `Permit2TypedData` struct for a single intent element using Permit2 settlement.
///
/// Permit2 is Uniswap's token approval protocol. Instead of the traditional ERC-20 `approve`,
/// the user signs an EIP-712 `PermitBatchWitnessTransferFrom` message that authorizes a specific
/// spender (the arbiter) to transfer specific tokens in specific amounts. This is safer because
/// the approval is scoped to exactly one transaction.
///
/// # How it works
///
/// 1. Extracts token addresses from `idsAndAmounts` using a 160-bit bitmask.
///    Unlike Compact (which uses the upper 12 bytes as a lock tag), Permit2 token IDs
///    store the address in the lower 160 bits. `to_token()` applies the bitmask to extract it.
///
/// 2. Extracts the `tokenOut` list the same way — these are the tokens the user expects
///    to receive on the destination chain.
///
/// 3. Hashes `qualifier.encodedVal` with keccak256 to get the qualifier hash `q`.
///
/// 4. Wraps everything in a `Permit2TypedData` struct with the Permit2 domain.
///    - `spender` is the element's `arbiter` (the contract authorized to pull tokens)
///    - `nonce` prevents replay attacks
///    - `deadline` is the intent's `expires` timestamp
///
/// # Parameters
///
/// - `element`: A single intent element containing token IDs, amounts, and the mandate
/// - `nonce`: The intent's nonce (used as the Permit2 nonce to prevent replay)
/// - `expires`: The intent's expiration timestamp (used as the Permit2 deadline)
///
/// # Errors
///
/// Currently infallible, but returns `Result` for consistency with other builders.
pub fn build(
    element: &IntentOpElement,
    nonce: &U256,
    expires: &U256,
) -> Result<Permit2TypedData, String> {
    // The chain ID for the EIP-712 domain — tells the wallet which network this permit is for.
    let chain_id: u64 = element.chain_id.to::<u64>();

    // Extract the tokens being permitted (what the user allows the spender to pull).
    // Each token ID is masked to 160 bits to get the ERC-20 contract address.
    let permitted: Vec<TokenAmount> = element
        .ids_and_amounts
        .iter()
        .map(|(id, amount)| TokenAmount {
            token: to_token(id),
            amount: *amount,
        })
        .collect();

    // Extract the tokens the user expects to receive on the destination chain.
    let token_out: Vec<TokenAmount> = element
        .mandate
        .token_out
        .iter()
        .map(|(id, amount)| TokenAmount {
            token: to_token(id),
            amount: *amount,
        })
        .collect();

    // Hash the qualifier's encoded value to produce the commitment hash `q`.
    let q = keccak256_bytes(&element.mandate.qualifier.encoded_val);

    Ok(Permit2TypedData {
        domain: Eip712Domain {
            name: "Permit2",
            // Permit2 does not use a version field in its EIP-712 domain.
            version: None,
            chain_id,
            verifying_contract: PERMIT2_ADDRESS,
        },
        permitted,
        // The arbiter is the contract that will call Permit2's `permitWitnessTransferFrom`.
        spender: element.arbiter,
        nonce: *nonce,
        deadline: *expires,
        mandate: Mandate {
            target: MandateTarget {
                recipient: element.mandate.recipient,
                token_out,
                destination_chain_id: element.mandate.destination_chain_id,
                fill_deadline: element.mandate.fill_deadline,
            },
            min_gas: element.mandate.min_gas,
            origin_ops: OpBatch(element.mandate.pre_claim_ops.clone()),
            dest_ops: OpBatch(element.mandate.destination_ops.clone()),
            q,
        },
    })
}
