---
'@rhinestone/sdk': patch
---

Fix multi-factor owner sets with a passkey or ENS factor, which previously failed every signature with `InvalidSignature()`. Such factors are now configured and signed in the format the sub-validator's stateless validation path requires. Their derived addresses change, and the order passkey credentials are listed in inside a factor no longer affects the address; ECDSA-only multi-factor accounts are unchanged. An already-deployed account is repaired by re-setting the offending factor with `mfa.setSubValidator`. Note that a nested ENS factor does not enforce owner expiry, because the validator's stateless path deliberately skips that check.
