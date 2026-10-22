---
'@rhinestone/sdk': patch
---

Fix smart-session intents without own-account destination calls being refused or signed with the destination grant: the destination authorization reuses the origin proof again and a single source grant also answers destination-chain payloads such as ACROSS target execution, so no destination grant is required. Own-account destination calls still require the destination chain's grant.
