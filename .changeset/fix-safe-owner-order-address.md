---
'@rhinestone/sdk': patch
---

Derive one Safe account address regardless of the order its owners were listed in. A Safe with two or more ECDSA or ENS owners used to derive a different address for every ordering, because the owner list is baked into the Safe `setup` call that determines the account address. Owners are now installed in canonical, value-based order.

A multi-owner Safe that was previously passed in a non-canonical order derives a new address; to keep the existing account, pin its `initData` instead of letting the SDK re-derive it. Single-owner, passkey and multi-factor Safe configurations, every other account type, and the legacy v0 reconstruction path keep the exact address they derive today.
