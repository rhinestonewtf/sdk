---
'@rhinestone/sdk': major
---

Replace the flat transaction input with one `source` and one `destination`: `{ source?: { chain?, token, maxAmount?, auxiliaryFunds?, calls? }, destination: { chain, token?, amount?, recipient?, calls?, gasLimit?, … } }`. The SDK spends exactly the source you name and no longer discovers source chains or tokens.

- `chain`, `targetChain`, `sourceChains`, `sourceAssets`, `tokenRequests`, `recipient`, `calls`, `gasLimit`, `sourceCalls`, `auxiliaryFunds`, `hyperCore`, `instructions`, `addressLookupTables` and `authority` are refused by name, pointing at their replacement. Omit `source.chain` to spend on the destination chain; a cross-chain transaction names it.
- `destination.token` with `amount` is exact output, `token` alone is max output, and neither delivers nothing. A delivery needs a `source`, and so does any execution that is not gas-sponsored; only a gas-sponsored execution that delivers nothing may omit it.
- Several source chains or tokens, and several delivered tokens, have no equivalent. `source.calls` run on the source chain and a call's `provides` must name `source.token`; source calls that were silently dropped now run or are refused.
- A source-free transaction whose smart session still needs enabling is refused before quoting; name a `source`. `customDeadline` on a cross-chain transaction, and `hyperCore` on a destination that is not HyperCore, are refused instead of dropped.
- An unsponsored intent-path `deploy('evm', chain, { source: { token } })` and intent-path `setup(chain, { source: { token } })` pay in a named same-chain token and refuse without one. Sponsored deployment is unchanged.
- Solana authority changes are `{ destination: { chain, authority } }`, including for `getAuthorityStatus`. Instruction executions are source-free when sponsored and name their fee token as `source.token` otherwise.
- `PreparedTransactionData.intentInput` and the `getIntentExtensionToken` argument are the versioned `sdk-caucasus-singular-2026-09-v1` approval input: the quote request itself, with CAIP-2 chain ids. Review sponsorship policies that read the old field names. `/jwt-server`'s `shouldSponsor` reads both the new input and the one older SDKs send.
- Prepared transactions from earlier SDK generations fail with `InvalidPreparedTransactionError`; reconcile, then prepare again.
- Remove `TokenRequest`, `NonEvmTokenRequest`, `NonEvmTokenRequests`, `AuxiliaryFunds` and `SolanaSourceAsset`. Add `TransactionSource`, `TransactionDestination`, `EvmDeployOptions`, `EvmSetupOptions` and `SolanaTransactionSource`.
