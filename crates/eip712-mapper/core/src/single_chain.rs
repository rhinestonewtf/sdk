use alloy_primitives::{address, Address, U256};

use crate::input::IntentOpElement;
use crate::types::{Eip712Domain, GasRefundData, OpBatch, SingleChainTypedData};

/// IntentExecutor contract address (production deployment).
/// Matches `INTENT_EXECUTOR_ADDRESS` in `src/modules/chain-abstraction.ts`.
/// Selected at compile time — the `dev` feature flag switches to the dev deployment.
/// This means the WASM binary itself determines which IntentExecutor address to use.
/// The orchestrator serves the correct binary (prod or dev) based on the environment.
#[cfg(not(feature = "dev"))]
const INTENT_EXECUTOR_ADDRESS: Address =
    address!("00000000005aD9ce1f5035FD62CA96CEf16AdAAF");

/// IntentExecutor contract address (dev deployment).
/// Matches `INTENT_EXECUTOR_ADDRESS_DEV` in `src/modules/chain-abstraction.ts`.
#[cfg(feature = "dev")]
const INTENT_EXECUTOR_ADDRESS: Address =
    address!("bf9b5b917a83f8adac17b0752846d41d8d7b7e17");

/// Builds a `SingleChainTypedData` struct for a single intent element using same-chain settlement.
///
/// SingleChainOps is used when both the origin and destination of an intent are on the same chain.
/// Instead of cross-chain bridging, the IntentExecutor contract directly executes the operations
/// on the destination chain. The user signs a `SingleChainOps` EIP-712 message authorizing the
/// executor to perform specific actions on their behalf.
///
/// # How it works
///
/// 1. Reads the `destinationChainId` from the mandate to set the EIP-712 domain's chain ID.
///    (For single-chain intents, origin and destination are the same chain.)
///
/// 2. Extracts gas refund parameters from `settlementContext.gasRefund` if present.
///    Gas refunds compensate the solver for transaction gas costs:
///    - `token`: the ERC-20 used to pay the refund (e.g. USDC)
///    - `exchangeRate`: the token-per-gas-unit exchange rate (18-decimal fixed-point)
///    - `overhead`: additional gas units to add (covers solver overhead beyond raw execution)
///    If no gas refund is configured, all three values default to zero.
///
/// 3. Passes the destination operations through unchanged as an opaque JSON blob.
///    These are the actual on-chain calls the executor will make (e.g. swaps, transfers).
///
/// # Parameters
///
/// - `account_address`: The user's smart account address (included in the signed message)
/// - `element`: A single intent element containing the mandate and gas refund config
/// - `nonce`: The intent's nonce (prevents replay)
///
/// # Errors
///
/// Currently infallible, but returns `Result` for consistency with other builders.
pub fn build(
    account_address: &Address,
    element: &IntentOpElement,
    nonce: &U256,
) -> Result<SingleChainTypedData, String> {
    // For single-chain intents, the domain chain ID comes from the destination
    // (which is the same as the origin chain).
    let chain_id: u64 = element.mandate.destination_chain_id.to::<u64>();

    // Extract gas refund parameters. If the orchestrator didn't include a gasRefund,
    // we default to zeros — this means no gas compensation for the solver.
    let gas_refund = match &element.mandate.qualifier.settlement_context.gas_refund {
        Some(gr) => GasRefundData {
            token: gr.token,
            exchange_rate: gr.exchange_rate,
            overhead: gr.overhead,
        },
        None => GasRefundData {
            token: Address::ZERO,
            exchange_rate: U256::ZERO,
            overhead: U256::ZERO,
        },
    };

    Ok(SingleChainTypedData {
        domain: Eip712Domain {
            name: "IntentExecutor",
            version: Some("v0.0.1"),
            chain_id,
            // The IntentExecutor address is baked into the WASM binary at compile time.
            // prod vs dev is selected via the `dev` Cargo feature flag.
            verifying_contract: INTENT_EXECUTOR_ADDRESS,
        },
        account: *account_address,
        nonce: *nonce,
        // destinationOps passed through as-is — these are the on-chain calls to execute.
        op: OpBatch(element.mandate.destination_ops.clone()),
        gas_refund,
    })
}
