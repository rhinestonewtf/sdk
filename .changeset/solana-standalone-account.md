---
'@rhinestone/sdk': minor
---

Let a development managed Solana account stand alone, with no EVM account: configure `solana: { owner, swig: stateAddress }` (`SolanaStandaloneAccountConfig`) naming an existing Swig state account. `createAccount` derives its asset-holding wallet PDA and returns a `SolanaStandaloneAccount`, which exposes only prepare, messages, sign, submit and wait. `getAddress('solana')` returns the derived wallet, and a Solana → EVM delivery from the account must name its `recipient`. Persisted Solana execution metadata carries the wallet as `accountAddress` for such an account, and no `accountType`.
