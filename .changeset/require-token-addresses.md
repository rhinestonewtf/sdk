---
'@rhinestone/sdk': major
---

Require token **addresses** (not symbols) for all token inputs — `tokenRequests`, `CalldataInput.to`, `ExactInputConfig`, `SimpleTokenList`, and cross-chain permit legs (`from`/`to`). Token symbols (`'USDC'`, `'WETH'`, …) are no longer accepted; pass the token's address for the target chain. This removes the SDK's per-chain symbol→address resolution — the first step of dropping the bundled `@rhinestone/shared-configs` chain data so new chains no longer require an SDK release.
