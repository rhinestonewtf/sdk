---
'@rhinestone/sdk': minor
---

Startale now defaults to v1.0.1, which deploys a new implementation and factory and changes the default counterfactual account address. Existing v1.0.0 accounts must opt back in with `account: { type: 'startale', version: '1.0.0' }` to keep their address — including accounts passed as address-only `initData`, whose typed-data signatures would otherwise target the v1.0.1 domain. Accounts restored from `initData` with a `factory` keep their version automatically.
