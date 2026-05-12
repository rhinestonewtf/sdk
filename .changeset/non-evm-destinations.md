---
'@rhinestone/sdk': minor
---

Support non-EVM destination chains (Solana, Tron) in the intent flow.

- New `NonEvmChain` descriptor type and `solanaMainnet` / `tronMainnet` exports. Pass them anywhere a viem `Chain` was accepted for the destination: `targetChain: solanaMainnet`. The `DestinationChain` type alias (`Chain | NonEvmChain`) is the union form used by `Transaction.targetChain`.
- `CrossChainTransaction` is now a discriminated union — `CrossChainEvmTransaction` (EVM destinations) and `CrossChainNonEvmTransaction` (Solana / Tron). On non-EVM destinations, `recipient` accepts a `NonEvmAddress` (Solana base58 / Tron T-prefix) and `tokenRequests[].address` accepts non-EVM token strings without consumer casts.
- CAIP-2 helpers (`toCaip2`, `fromCaip2`, `isCaip2`) now dispatch on namespace and round-trip non-EVM synthetic chain ids through the orchestrator's CAIP-2 strings. The synthetic numeric id is used internally for orchestrator wire mapping but is intentionally not exposed on `NonEvmChain` — use `getChainId(chain)` for the numeric id of either chain kind.
- `IntentOpStatus.fillTransactionHash` is now `string` (`FillTransactionHash`), so Solana base58 / Tron hex fill hashes round-trip cleanly.
- Token-symbol validation and EVM-address parsing are skipped on the destination side for non-EVM chains; orchestrator-side validation handles SPL mints / Tron contracts.
- EIP-7702 authorization, smart-session target-execution signing, and the destination-side session resolution all skip non-EVM destinations — there's no validator there to verify a destination signature, and per-chain experimental sessions don't need an entry for the synthetic Solana / Tron chain id.
- `Account.accountType` and `Account.setupOps` are now optional. Non-EVM recipients emit just `{ address }`; the orchestrator schema requires these fields unset for non-EVM destinations.

No UserOp support for non-EVM destinations: the UserOp path remains EVM-only by construction.
