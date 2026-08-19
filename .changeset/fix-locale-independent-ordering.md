---
'@rhinestone/sdk': patch
---

Order ENS owners, WebAuthn credential IDs, and recovery guardians by address value instead of host collation or checksum casing, so the same account config derives the same address on locales such as `da`, `nb`, and `no`, multi-passkey signatures stay valid, and social recovery installs no longer revert for guardian sets whose casing inverts their value order.
