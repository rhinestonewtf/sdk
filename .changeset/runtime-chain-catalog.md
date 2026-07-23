---
'@rhinestone/sdk': major
---

Read chain data at runtime from the orchestrator instead of bundling it. The SDK no longer depends on `@rhinestone/shared-configs`: the supported-chain set, per-chain tokens, and the wrapped-native token are fetched (once, lazily, and cached) from the orchestrator's `GET /chains`, and `Chain` objects come from `viem`. A new chain no longer requires an SDK release.

Breaking changes:

- **`SupportedChain` is now `number`** (open) rather than a closed union of chain ids.
- **New `account.createSession(definition)`** — resolves the chain's wrapped-native token from `/chains` and permits native-wrapping automatically. The standalone `toSession(definition, options)` is now pure: pass `options.wrappedNativeToken` to opt into the native-wrap action (otherwise it is omitted).
- **Removed the `alchemy` provider type.** Supply RPC URLs yourself via `provider: { type: 'custom', urls: { [chainId]: url } }`, or omit `provider` to use viem's default transport.
- **Removed the token-registry helpers** `getWethAddress`, `getTokenSymbol`, and `isTokenAddressSupported`. Fetch equivalent data from the orchestrator's `/chains` endpoint.

The signed Permit2 arbiter allow-set stays bundled (it must remain client-trusted), now as a small inlined constant rather than read from shared-configs.

Requires an orchestrator that returns `wrappedNativeToken` on `/chains`.
