---
'@rhinestone/sdk': minor
---

Add independent multisig signing. Pass an `owner` to `signTransaction` to create a serializable owner signature, then combine owner signatures with `assembleTransaction` before submission. Supports ECDSA, passkey, and multi-factor owner sets.
