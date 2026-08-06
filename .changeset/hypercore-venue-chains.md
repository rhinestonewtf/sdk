---
'@rhinestone/sdk': major
---

**Breaking:** HyperCore is addressed by delivery venue.

A HyperCore deposit credits one of two accounts that are not interchangeable — the recipient's spot wallet, or the default perp dex's margin account. The wrong one is invisible: the intent completes, the fill succeeds, and only the recipient's Core state shows where the money went.

The venue is therefore part of the destination, not a flag on a token request.

```diff
- import { hyperCoreMainnet } from '@rhinestone/sdk'
+ import { hyperCoreSpot } from '@rhinestone/sdk'

  await account.sendTransaction({
-   targetChain: hyperCoreMainnet,
-   tokenRequests: [{ address: usdc, amount, balance: 'spot' }],
+   targetChain: hyperCoreSpot,
+   tokenRequests: [{ address: usdc, amount }],
    recipient,
  })
```

Migration:

- `hyperCoreMainnet` → **`hyperCoreSpot`** (the recipient's spot wallet) or **`hyperCorePerp`** (the default perp dex's margin account). Pick deliberately; `hyperCoreMainnet` defaulted to perp, so callers who assumed spot were silently credited to perp margin — which needs an EOA signature to move back out of.
- `tokenRequests[].balance` is **removed**. Delete it; the venue you passed there is now the `targetChain`.
- The `HyperCoreBalance` type is **removed**, along with its root export.
- `HyperCoreCaip2ChainId` is now `'hypercore:spot' | 'hypercore:perp'`. `'hypercore:mainnet'` is not accepted as a target: it named the Core L1 without naming an account, and aliasing it to either venue would silently pick one. Upstream it remains an origin-only chain — deposits arrive from the Core L1 without naming a venue — and the orchestrator refuses it as a destination by its declared registry role.

Why the field was removed rather than forwarded: `balance` was optional, and optional was the defect. This SDK dropped it twice while rebuilding the intent (`adaptTransaction`, then `buildIntentRequest`), and `tsc` could not catch it because conditional spreads are exempt from excess-property checking. A `targetChain` cannot be dropped by a field-by-field rebuild — it is what a caller must supply to address anything at all — so the whole class of bug goes with the field.

Requires `@rhinestone/shared-configs` ≥ 1.11.0.
