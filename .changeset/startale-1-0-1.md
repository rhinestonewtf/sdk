---
'@rhinestone/sdk': major
---

Startale now defaults to v1.0.1, which deploys a new implementation and factory, changes the default counterfactual account address, and signs typed data against the v1.0.1 EIP-712 domain. Existing v1.0.0 accounts opt back in with `account: { type: 'startale', version: '1.0.0' }` to keep their address and domain — including accounts passed as address-only `initData`, whose typed-data signatures would otherwise target the v1.0.1 domain. Accounts restored from `initData` with a `factory` keep their version automatically.
