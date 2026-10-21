---
'@rhinestone/sdk': patch
---

Fix cross-chain smart-session intents with own-account destination calls failing destination simulation: the destination authorization is now signed with the destination chain's session instead of the source chain's. `signIntent` now also resolves sessions for the intent's origin chains, so headless cross-chain session signing works.
