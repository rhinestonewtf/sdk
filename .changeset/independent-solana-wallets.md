---
'@rhinestone/sdk': major
---

Require every managed Solana account to name its existing Swig state account explicitly; the SDK derives its wallet PDA.

Managed Solana wallets can now be used alone, with an address-only EVM receiver, or with an independently configured managed EVM account. Plain Solana operations always use the selected Swig and its private-key or passkey authority. Solana-to-EVM destination calls remain limited to explicit Swigs compatible with the managed EVM account; unrelated pairs can still make plain deliveries.
