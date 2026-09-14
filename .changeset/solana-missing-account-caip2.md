---
'@rhinestone/sdk': patch
---

Recognize CAIP-2 chain ids in `SOLANA_ACCOUNT_NOT_CREATED` refusals, so `isSolanaAccountNotCreated` holds for live responses and `chainId` still resolves to the SDK's numeric id. An unusable chain id no longer degrades the error to a generic `ValidationError`.
