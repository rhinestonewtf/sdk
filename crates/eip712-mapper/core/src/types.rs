use alloy_primitives::{Address, FixedBytes, U256};

#[derive(Debug, Clone)]
pub struct Eip712Domain {
    pub name: &'static str,
    pub version: Option<&'static str>,
    pub chain_id: u64,
    pub verifying_contract: Address,
}

#[derive(Debug, Clone)]
pub struct TokenAmount {
    pub token: Address,
    pub amount: U256,
}

/// Opaque pass-through for destinationOps / preClaimOps.
/// Core doesn't transform these — they're forwarded to the output unchanged.
#[derive(Debug, Clone)]
pub struct OpBatch(pub serde_json::Value);

#[derive(Debug, Clone)]
pub struct MandateTarget {
    pub recipient: Address,
    pub token_out: Vec<TokenAmount>,
    pub destination_chain_id: U256,
    pub fill_deadline: U256,
}

#[derive(Debug, Clone)]
pub struct Mandate {
    pub target: MandateTarget,
    pub min_gas: U256,
    pub origin_ops: OpBatch,
    pub dest_ops: OpBatch,
    pub q: FixedBytes<32>,
}

// --- Compact ---

#[derive(Debug, Clone)]
pub struct CompactTypedData {
    pub domain: Eip712Domain,
    pub sponsor: Address,
    pub nonce: U256,
    pub expires: U256,
    pub elements: Vec<CompactElement>,
}

#[derive(Debug, Clone)]
pub struct CompactElement {
    pub arbiter: Address,
    pub chain_id: U256,
    pub commitments: Vec<CompactLock>,
    pub mandate: Mandate,
}

#[derive(Debug, Clone)]
pub struct CompactLock {
    pub lock_tag: FixedBytes<12>,
    pub token: Address,
    pub amount: U256,
}

// --- Permit2 ---

#[derive(Debug, Clone)]
pub struct Permit2TypedData {
    pub domain: Eip712Domain,
    pub permitted: Vec<TokenAmount>,
    pub spender: Address,
    pub nonce: U256,
    pub deadline: U256,
    pub mandate: Mandate,
}

// --- SingleChainOps ---

#[derive(Debug, Clone)]
pub struct SingleChainTypedData {
    pub domain: Eip712Domain,
    pub account: Address,
    pub nonce: U256,
    pub op: OpBatch,
    pub gas_refund: GasRefundData,
}

#[derive(Debug, Clone)]
pub struct GasRefundData {
    pub token: Address,
    pub exchange_rate: U256,
    pub overhead: U256,
}

// --- Dispatch result ---

#[derive(Debug)]
pub enum TypedDataResult {
    Compact(CompactTypedData),
    Permit2(Vec<Permit2TypedData>),
    SingleChain(Vec<SingleChainTypedData>),
}
