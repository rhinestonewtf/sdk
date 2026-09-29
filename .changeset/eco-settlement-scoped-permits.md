---
'@rhinestone/sdk': minor
---

Add `ECO` (Eco's solver network) as a settlement-scoped cross-chain permit layer (RHI-7826). `settlementLayers: ['ECO']` now means the live Eco Routes path and restricts the session to `token.approve(Portal)` and `Portal.publishAndFund` (the encoded-route overload) on Eco's Portal:

- The route and reward are pinned to the one shape the orchestrator accepts: an ERC-20 reward and a single `transfer` delivery. Every pointer and length word is pinned, plus each `to` chain's Eco destination id, destination Portal, delivery token, the `transfer` selector and recipient, the reward creator (the account), the reward token, and a zero native amount on both sides.
- The reward's prover must be one of Eco's verified provers (HyperProver, CCIPProver). An unlisted prover could attest a fill that never happened.
- The key sets the delivery against the reward, so ECO requires `maxAmount` (hence `oneTimeUse`) and a new `maxFeeBps`: the reward is capped at `maxAmount`, and the route must deliver at least `maxAmount × (1 − maxFeeBps / 10000)`. With `validUntil`, the reward deadline is bounded by it.
- Both legs must be USD stablecoins the SDK bundles for Eco's chains, and the recipient must be concrete (not `'any'`).
- `maxFeeBps` on any other layer throws.

**Behaviour change:** `'ECO'` no longer maps to the retired Standard Eco Permit2 arbiter. A permit that omits `settlementLayers` keeps the same arbiter allow-set (and digest) as before.
