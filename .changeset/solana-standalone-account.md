---
'@rhinestone/sdk': minor
---

Let a development managed Solana account stand alone, with no EVM account: configure `solana: { owner, swig: { address, swigAccount } }` (`SolanaStandaloneAccountConfig`) naming an existing Swig's wallet and state account. `createAccount` returns a `SolanaStandaloneAccount`, which exposes only prepare, messages, sign, submit and wait. Account creation refuses a `swig.address` that is not the wallet of `swig.swigAccount`, `getAddress('solana')` returns the wallet, and a Solana → EVM delivery from the account must name its `recipient`. Persisted Solana execution metadata carries the wallet as `accountAddress` for such an account, and no `accountType`.
