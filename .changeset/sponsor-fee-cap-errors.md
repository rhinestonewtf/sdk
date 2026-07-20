---
'@rhinestone/sdk': minor
---

Expose typed errors for sponsored-fee failures on quotes. `SponsorLimitExceededError` (a configured per-client sponsorship cap was hit — carries `limitKey`, `capUsd`, `coverageUsd`, `sponsorAddress`) and `InsufficientSponsorBalanceError` (the sponsor's balance can't cover the enabled categories — carries `failedCategories`, `sponsorAddress`, `remainingBalanceUsd`, `totalSponsoredUsd`) now surface as distinct classes with the guards `isSponsorLimitExceeded`, `isInsufficientSponsorBalance`, and `isSponsorError`. Both extend `UnprocessableContentError` and keep `code` as `'UNPROCESSABLE_CONTENT'`, so existing handling of that error is unaffected.
