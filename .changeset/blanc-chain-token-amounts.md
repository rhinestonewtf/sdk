---
'@rhinestone/sdk': major
---

Migrate `sourceAssets: ExactInputConfig[]` to the new `chainTokenAmounts` access list shape.

Blanc removed the legacy flat-array `accountAccessList` variant
(`{ chainId, tokenAddress, amount? }[]`), so the SDK now emits
`chainTokens` for entries without an amount and `chainTokenAmounts`
(per-(chain, token) cap, decimal-string amounts) for entries with one.
The consumer-facing `ExactInputConfig.amount?: bigint` semantics are
preserved end to end.

Internally: `AccountAccessList` drops the `AccountAccessListLegacy`
variant and `MappedChainTokenAccessList` gains a `chainTokenAmounts`
field. Neither was exported on the public surface.
