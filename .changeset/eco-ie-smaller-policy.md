---
'@rhinestone/sdk': patch
---

Make `ECO_IE` sessions cheaper to enable (RHI-8045). The `publishAndFund` policy no longer pins the route's internal pointers and byte length: Eco's destination re-encodes the route to check the intent hash, so a route laid out any other way can never be filled and its reward refunds to the account. Pins every destination shares are stored once instead of once per destination. A one-destination `ECO_IE` session writes 24 fewer non-zero storage slots when it is enabled.
