---
'@rhinestone/sdk': minor
---

Run EVM calls after a Solana → EVM delivery: pass `calls`, and optionally `gasLimit`, on a `CrossChainSolanaOriginTransaction`, and the account's EVM account runs them on `targetChain` once the tokens land.

- The calls need the account's EVM entry and land the delivery on its EVM address, so they are refused with an explicit `recipient` and on an account with no EVM entry.
- An EVM account not yet deployed on `targetChain` is deployed before the calls run. An EIP-7702 account passes `eip7702InitSignature` from `signEip7702InitData()`, as on an EVM transaction.
- The quote asks for the Swig spend first, then the EVM account's EIP-712 authorization of the calls, then any EIP-7702 delegation. `signTransaction` signs the EVM requests before the spend, whose slot window is the short one, and returns one proof per request in that order; `submitTransaction` sends them all.
- Without `calls`, the request and the proofs are unchanged.
