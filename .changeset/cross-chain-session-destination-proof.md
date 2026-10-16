---
'@rhinestone/sdk': patch
---

Fix cross-chain smart-session intents with own-account destination calls failing destination simulation: the destination authorization is now signed with the destination chain's session instead of reusing the source chain's envelope.
