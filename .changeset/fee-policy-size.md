---
'@rhinestone/sdk': patch
---

Shrink what `allowFees` writes when a settlement-scoped session is enabled (RHI-8045): the fee transfer and the single-token paymaster callback use UniversalActionPolicy instead of ArgPolicy, and each 5 USD fee cap stores its bound only as the cumulative limit. Enabling such a session writes 11 fewer non-zero storage slots (about 240k gas). The calls admitted and each cap's counter are unchanged.
