use alloy_primitives::address;

use crate::input::IntentOp;
use crate::types::{
    CompactElement, CompactLock, CompactTypedData, Eip712Domain, Mandate, MandateTarget, OpBatch,
    TokenAmount,
};
use crate::util::{extract_token_address, keccak256_bytes, split_token_id};

/// The Compact protocol's on-chain contract address.
/// This is the canonical deployment used as the EIP-712 `verifyingContract`.
const COMPACT_ADDRESS: alloy_primitives::Address =
    address!("00000000000000171ede64904551eeDF3C6C9788");

/// Builds a `CompactTypedData` struct from an `IntentOp` for "The Compact" settlement type.
///
/// The Compact protocol uses a `MultichainCompact` EIP-712 struct where each element
/// represents a cross-chain transfer commitment. The user signs this struct to authorize
/// the protocol to lock tokens on the origin chain and release them on the destination chain.
///
/// # How it works
///
/// 1. Reads the `chainId` from the first element to set the EIP-712 domain
/// 2. For each element in `intentOp.elements`:
///    - Unpacks `idsAndAmounts` into lock commitments (each is a `lockTag` + `token` + `amount`).
///      The token ID is a packed 32-byte value where the first 12 bytes are a lock identifier
///      and the last 20 bytes are the token address.
///    - Unpacks `mandate.tokenOut` into the tokens the user expects to receive on the
///      destination chain. These use the same packed format but only the address matters.
///    - Hashes `qualifier.encodedVal` with keccak256 to produce the qualifier hash `q`.
///      This is a commitment to the fill conditions the solver must satisfy.
///    - Passes `preClaimOps` and `destinationOps` through unchanged as opaque JSON blobs.
///      These are on-chain calldata the protocol will execute before/after the fill.
/// 3. Wraps everything in a `CompactTypedData` with the Compact protocol's EIP-712 domain
///
/// # Errors
///
/// Returns an error if `intentOp.elements` is empty (nothing to sign).
pub fn build(intent_op: &IntentOp) -> Result<CompactTypedData, String> {
    // We need at least one element to determine the chain ID for the EIP-712 domain.
    let first_element = intent_op
        .elements
        .first()
        .ok_or("elements must not be empty")?;

    // The chain ID tells viem (and the user's wallet) which network this signature is for.
    let chain_id: u64 = first_element.chain_id.to::<u64>();

    // Build one CompactElement per intent element. Each element represents a set of token
    // locks on a specific chain, plus a mandate describing what the user expects in return.
    let elements: Vec<CompactElement> = intent_op
        .elements
        .iter()
        .map(|element| {
            // Each (id, amount) pair in idsAndAmounts represents one token lock.
            // The `id` is a packed 32-byte value: [12 bytes lockTag | 20 bytes token address].
            // `split_token_id` unpacks this into the two components.
            let commitments: Vec<CompactLock> = element
                .ids_and_amounts
                .iter()
                .map(|(id, amount)| {
                    let (lock_tag, token) = split_token_id(id);
                    CompactLock {
                        lock_tag,
                        token,
                        amount: *amount,
                    }
                })
                .collect();

            // tokenOut describes what the user expects to receive on the destination chain.
            // Same packed format as idsAndAmounts, but we only need the address (no lockTag).
            let token_out: Vec<TokenAmount> = element
                .mandate
                .token_out
                .iter()
                .map(|(id, amount)| {
                    let token = extract_token_address(id);
                    TokenAmount {
                        token,
                        amount: *amount,
                    }
                })
                .collect();

            // The qualifier hash `q` is keccak256 of the encoded qualifier value.
            // This binds the signature to specific fill conditions without revealing them
            // on-chain until the solver actually fills the intent.
            let q = keccak256_bytes(&element.mandate.qualifier.encoded_val);

            CompactElement {
                arbiter: element.arbiter,
                chain_id: element.chain_id,
                commitments,
                mandate: Mandate {
                    target: MandateTarget {
                        recipient: element.mandate.recipient,
                        token_out,
                        destination_chain_id: element.mandate.destination_chain_id,
                        fill_deadline: element.mandate.fill_deadline,
                    },
                    min_gas: element.mandate.min_gas,
                    // preClaimOps: calldata executed before the token claim (e.g. approvals)
                    origin_ops: OpBatch(element.mandate.pre_claim_ops.clone()),
                    // destinationOps: calldata executed on the destination chain after fill
                    dest_ops: OpBatch(element.mandate.destination_ops.clone()),
                    q,
                },
            }
        })
        .collect();

    // Assemble the final typed data. The sponsor is the address paying for the transfer,
    // nonce prevents replay, and expires sets when the signature becomes invalid.
    Ok(CompactTypedData {
        domain: Eip712Domain {
            name: "The Compact",
            version: Some("1"),
            chain_id,
            verifying_contract: COMPACT_ADDRESS,
        },
        sponsor: intent_op.sponsor,
        nonce: intent_op.nonce,
        expires: intent_op.expires,
        elements,
    })
}
