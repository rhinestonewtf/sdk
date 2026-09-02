---
'@rhinestone/sdk': minor
---

Support Stellar as a destination chain through the new `stellarMainnet` descriptor, so `targetChain: stellarMainnet` addresses `stellar:pubnet` the way `solanaMainnet` and `tronMainnet` already do. Recipients are `G…` account strkeys and token requests take the asset's Soroban contract (`C…`), both passed through unchanged for the orchestrator to validate.
