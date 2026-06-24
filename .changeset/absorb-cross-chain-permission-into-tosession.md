---
'@rhinestone/sdk': major
---

Remove the `createCrossChainPermission()` builder. `SessionDefinition.crossChainPermits` now accepts the builder input directly, so pass the same object inline:

```ts
const session = toSession({
  chain: mainnet,
  owners: { type: 'ecdsa', accounts: [sessionKey] },
  crossChainPermits: [
    { from: { chain: mainnet, token: 'USDC' }, to: { chain: arbitrum, token: 'USDC' } },
  ],
})
```

The input type is exported as `CrossChainPermissionInput` (with `FromLeg` / `ToLeg`). `validUntil` / `validAfter` now accept a `Date` only — the `bigint` unix-seconds form is no longer supported.
