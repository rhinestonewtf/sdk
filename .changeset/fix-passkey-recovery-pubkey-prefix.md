---
'@rhinestone/sdk': patch
---

Fix `recoverPasskeyOwnership` deriving the wrong coordinates from an uncompressed public key. Keys in the 65-byte SEC1 form carry an `0x04` prefix, and slicing from byte 0 shifted both `pubKeyX` and `pubKeyY`, so recovery installed an unusable credential and then removed the working one. Coordinates now come from the shared WebAuthn parser.
