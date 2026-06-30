---
'@rhinestone/sdk': patch
---

Allow Startale accounts adopted via `initData` to sign intents: `getEip712Domain` no longer throws for existing accounts and derives the domain from `getAddress(config)`.
