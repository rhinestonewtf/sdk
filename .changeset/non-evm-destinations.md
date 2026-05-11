---
'@rhinestone/sdk': minor
---

Support non-EVM destination chains (Solana, Tron) in the intent flow.

- New `DestinationChain` type + `solanaMainnet` / `tronMainnet` exports. Pass them anywhere a viem `Chain` was accepted for the destination: `targetChain: solanaMainnet`.
- `Transaction.targetChain` widens to `Chain | DestinationChain`; only the destination side opens up — origin is always EVM.
- CAIP-2 helpers (`toCaip2`, `fromCaip2`, `isCaip2`) now dispatch on namespace and round-trip non-EVM synthetic chain ids through the orchestrator's CAIP-2 strings.
- `IntentOpStatus.fillTransactionHash` widens from `Hex` to `Hex | string` (new `FillTransactionHash` type) so Solana base58 / Tron hex fill hashes round-trip cleanly.
- Token-symbol validation and EVM-address parsing are skipped on the destination side for non-EVM chains; orchestrator-side validation handles SPL mints / Tron contracts.
- EIP-7702 authorization and smart-session target-execution signing skip non-EVM destinations — there's no validator there to verify a destination signature.
- `Account.accountType` and `Account.setupOps` are now optional. Non-EVM recipients emit just `{ address }`; the orchestrator schema requires these fields unset for non-EVM destinations.

No UserOp support for non-EVM destinations: the UserOp path remains EVM-only by construction.
