---
'@rhinestone/sdk': patch
---

Fix smart-session intents without own-account destination calls requiring a destination grant: the destination authorization reuses the origin proof again, and a single source grant also signs destination-chain payloads such as ACROSS target execution. Own-account destination calls still require the destination chain's grant.
