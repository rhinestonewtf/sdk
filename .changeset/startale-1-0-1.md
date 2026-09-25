---
'@rhinestone/sdk': major
---

Support only Startale v1.0.1. Startale accounts now deploy the v1.0.1 implementation and factory, which changes their counterfactual addresses, and sign typed data against the v1.0.1 EIP-712 domain. Restoring a v1.0.0 account from `initData` with the v1.0.0 `factory` throws `AccountConfigurationNotSupportedError`; keep existing v1.0.0 accounts on `@rhinestone/sdk` v2 with `account: { type: 'startale', version: '1.0.0' }`.
