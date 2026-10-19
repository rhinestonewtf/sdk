---
'@rhinestone/sdk': minor
---

Allow `LZ` and `OFT` on reusable sessions with a native-fee budget. A `crossChainPermits` `from` leg takes `maxNativeFee`: the most native value, in wei of that chain's native token, that the session may send with the layer's call to pay LayerZero messaging fees, as a lifetime total. It installs a `ValueLimitPolicy` on the `LZMultiCall.execute` or `OFTAdapter.send` action, which counts each call's `msg.value`. Without `oneTimeUse`, these layers need `maxNativeFee` and are refused without it (`LAYER_REQUIRES_ONE_TIME_USE`, as before). With `oneTimeUse`, `maxNativeFee` is optional and caps that one settlement.

`maxNativeFee` counts the native each call sends, not what is spent after refunds: an overpaid send that is refunded still uses the budget, so later sends can be refused. The session key can also spend the whole budget as real LayerZero fees on sends of 1 token unit, so size it as the most you accept to lose to fees.

In a permit with several `from` tokens, `maxNativeFee` is a budget for the chain, set on at most one leg, and goes on the fee-paying layer the session keeps: LZ for its USDC or OFT for its USDT0, each kept, when `maxAmount` is set, only for the token it is set on. Under `settlementLayers: 'all'`, a permit with `maxNativeFee` where both OFT and LZ could settle, or where no fee-paying layer is kept, is refused with `MAX_NATIVE_FEE_NOT_APPLICABLE` rather than built without the layer the budget was set for. LZ's shared pull counter counts in the units of the token `maxAmount` is set on, which is the token LZ is kept for.

On a reusable session, every LZ route counts its pull on one `maxAmount` counter. An LZ permit with `maxAmount` whose `to` legs need batches of different shapes is refused (`LZ_REUSABLE_ROUTES_SPLIT`); give those legs separate sessions (a session holds one such permit), or set `oneTimeUse`. The CCTP relay-fee ceiling (at most 1 USDC) becomes a lifetime total on a reusable session, about 10 sends into Ethereum or 70 into Arbitrum; after that the fee route is refused. A session with `maxNativeFee` and without `oneTimeUse` is a lifetime budget (`lifetimeBudget: true`), so `getSessionDetails` refuses to sign its enable again while it is enabled.

`maxAmount` does not count allowances the account already holds that the session did not grant. Each layer that pulls the token counts its own pulls against `maxAmount`, so with such an allowance a permit naming several of them can move up to `maxAmount` times their number, on a reusable session over its life. The recipients stay pinned. Revoke those allowances for the token before relying on `maxAmount` as the total.

New refusal codes: `MAX_NATIVE_FEE_NOT_POSITIVE`, `MAX_NATIVE_FEE_NOT_APPLICABLE`, `MULTIPLE_MAX_NATIVE_FEES`, `LZ_REUSABLE_ROUTES_SPLIT`. Sessions that do not set `maxNativeFee` compile as before, with the same permissionIds. The `LAYER_REQUIRES_ONE_TIME_USE` message now also names `maxNativeFee`.
