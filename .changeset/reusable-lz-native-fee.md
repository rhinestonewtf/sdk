---
'@rhinestone/sdk': minor
---

Allow `LZ` and `OFT` on reusable sessions with a native-fee budget. A `crossChainPermits` `from` leg takes `maxNativeFee`: the most native value, in wei of that chain's native token, that the session may send with the layer's call to pay LayerZero messaging fees, as a lifetime total. It installs a `ValueLimitPolicy` on the `LZMultiCall.execute` or `OFTAdapter.send` action, which counts each call's `msg.value`. Without `oneTimeUse`, these layers need `maxNativeFee` and are refused without it (`LAYER_REQUIRES_ONE_TIME_USE`, as before). With `oneTimeUse`, `maxNativeFee` is optional and caps that one settlement.

On a reusable session, every LZ route counts its pull on one `maxAmount` counter. An LZ permit with `maxAmount` whose `to` legs need batches of different shapes is refused (`LZ_REUSABLE_ROUTES_SPLIT`); give those legs separate permits, or set `oneTimeUse`. The CCTP relay-fee ceiling becomes a lifetime total on a reusable session. A session with `maxNativeFee` and without `oneTimeUse` is a lifetime budget (`lifetimeBudget: true`), so `getSessionDetails` refuses to sign its enable again while it is enabled.

New refusal codes: `MAX_NATIVE_FEE_NOT_POSITIVE`, `MAX_NATIVE_FEE_NOT_APPLICABLE`, `MULTIPLE_MAX_NATIVE_FEES`, `LZ_REUSABLE_ROUTES_SPLIT`. Sessions that do not set `maxNativeFee` compile as before, with the same permissionIds. The `LAYER_REQUIRES_ONE_TIME_USE` message now also names `maxNativeFee`.
