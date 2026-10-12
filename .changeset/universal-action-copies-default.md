---
'@rhinestone/sdk': minor
---

Default `policyAddresses.universalActionCopies` to the three deployed UniversalActionPolicy copies for a session with an IntentExecutor-layer `crossChainPermits` entry on a chain that has them: Ethereum, Optimism, BNB Chain, Gnosis, Unichain, Polygon, Monad, Sonic, X Layer, World Chain, HyperEVM, Soneium, Ronin, Robinhood Chain, Arc, Base, Plasma, Arbitrum, Ink, Katana and the Sepolia, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia and Plasma testnets. This changes the encoding, and so the permission id and digest, of such a session whose ArgPolicy now splits (an LZ permit, for example): it writes less storage at enable, and a session already enabled under the old encoding is a different session. Set `universalActionCopies: []` to keep the previous encoding.

- Every other session encodes as before, as do sessions on other chains or with `argPolicy` or `universalAction` overridden. A session with an IntentExecutor-layer permit and `saltMode: 'v1'` is refused, as every settlement-scoped session is.
- An explicit `universalActionCopies` is used as given.
- `sdk.createSession` checks the defaulted copies' code as it does configured ones.
