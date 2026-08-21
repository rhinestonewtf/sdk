---
'@rhinestone/sdk': patch
---

Sign session ERC-1271 typed data in direct (notarized) mode. Signing typed data with a session previously produced an ERC-7739 nested signature that external ERC-1271 verifiers could not resolve, so `isValidSignature` checks against those signatures failed. Session typed-data signing now emits the same direct-mode, account-bound signature that session message signing already produced, so external verifiers resolve the session validator directly. Non-session signing and the account-native ERC-7739 paths are unchanged.
