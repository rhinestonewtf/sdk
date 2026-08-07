---
'@rhinestone/sdk': patch
---

HyperCore is addressed by delivery venue.

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

Migration, if you addressed HyperCore:

- `hyperCoreMainnet` → **`hyperCoreSpot`** (the recipient's spot wallet) or **`hyperCorePerp`** (the default perp dex's margin account). Pick deliberately; `hyperCoreMainnet` defaulted to perp, so callers who assumed spot were silently credited to perp margin — which needs an EOA signature to move back out of.
- `HyperCoreCaip2ChainId` is now `'hypercore:spot' | 'hypercore:perp'`. `'hypercore:mainnet'` is not accepted as a target: it named the Core L1 without naming an account, and aliasing it to either venue would silently pick one. Upstream it remains an origin-only chain — deposits arrive from the Core L1 without naming a venue — and the orchestrator refuses it as a destination by its declared registry role.

Released as a **patch**. Only one removed symbol was ever published: `hyperCoreMainnet`. `tokenRequests[].balance` and the `HyperCoreBalance` type existed solely in a `@dev` snapshot and are absent from every released version, so nothing on npm could depend on them. HyperCore has never carried an external client's intent either, so the practical blast radius of the one real removal is nil — and a caller who does reference it gets a compile error naming its replacement, not a silent behaviour change.

Requires an orchestrator that accepts the venue ids (shared-configs ≥ 1.11.0 on the server side). That is a runtime coupling, not a dependency of this package: the SDK bundles no chain data and reads the supported-chain set from `GET /chains`, so pointing this version at an older orchestrator fails when the intent is submitted rather than at build time.
