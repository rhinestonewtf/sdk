---
'@rhinestone/sdk': patch
---

Raise the `allowFees` cap on each fee call from 5 USD to 15 USD on Ethereum mainnet (chain id 1), since a session enable there needs a larger gas refund than 5 USD covers. Other chains keep 5 USD and their sessions are unchanged. An `allowFees` session on Ethereum mainnet gets a new permission id and digest, so enable it again.
