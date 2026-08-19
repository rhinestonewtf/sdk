---
'@rhinestone/sdk': patch
---

Order ENS owners, WebAuthn credential IDs, and EIP-712 type dependencies by value instead of host collation, so the same account config derives the same address and multi-passkey signatures stay valid on locales such as `da`, `nb`, and `cy`.
