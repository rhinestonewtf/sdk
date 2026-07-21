---
'@rhinestone/sdk': patch
---

Fix intent preparation for EIP-7702 accounts. The orchestrator quote request now includes the signed `initializeAccount` setup op (built from `eip7702InitSignature`) instead of an empty/factory setup, so 7702 intents route correctly instead of failing with "no viable route". `prepareTransaction` for a 7702 account requires the init signature.
