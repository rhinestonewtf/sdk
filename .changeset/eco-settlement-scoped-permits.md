---
'@rhinestone/sdk': minor
---

Add `ECO_IE` (Eco's solver network) as a settlement-scoped cross-chain permit layer (RHI-7826). `settlementLayers: ['ECO_IE']` restricts the session to `token.approve(Portal)` and `Portal.publishAndFund` (the encoded-route overload) on Eco's Portal. The Portal, provers and stablecoins per chain come from the orchestrator's `GET /chains` `settlement` block. `'ECO'` keeps its meaning (the retired Standard Eco Permit2 arbiter), so no existing permit changes:

- The route and reward are pinned to the one shape the orchestrator accepts: an ERC-20 reward and a single `transfer` delivery. Every calldata pointer, the reward's tokens pointer and every count are pinned, plus each `to` chain's Eco destination id, destination Portal, delivery token, the `transfer` selector and recipient, the reward creator (the account), the reward token, and a zero native amount on both sides. The route's internal pointers and length are fixed by Eco instead: the destination Portal re-encodes the route to check the intent hash, so a route laid out any other way can never be filled, and its reward refunds to the account after the reward deadline.
- The reward's prover must be an Eco prover deployed on both chains of the leg (as the orchestrator serves them per chain). An unlisted prover could attest a fill that never happened; one with no code on the source chain would make `refund` revert. A leg with no shared prover throws.
- The key sets the delivery against the reward, so `ECO_IE` requires `maxAmount` (hence `oneTimeUse`) and a new `maxFeeBps`: the reward is capped at `maxAmount`, and the route must deliver at least `maxAmount × (1 − maxFeeBps / 10000)`. Set `maxAmount` close to the reward you expect to pay: a smaller reward still has to clear the floor computed from `maxAmount`, so it fails closed.
- `ECO_IE` requires `validUntil`, which bounds both the route deadline and the reward deadline: an unfilled reward is refundable after its deadline, so without it a key could lock the funds indefinitely. It can still stay locked until `validUntil`.
- Both legs must be USD stablecoins the orchestrator serves for Eco on that chain, with a concrete recipient (not `'any'`). The floor treats them 1:1, so a depeg between the two sides is borne on top of `maxFeeBps`.
- Intents signed with the session are limited to the orchestrator's `ECO` layer. `maxFeeBps` on any other layer throws.
- On every settlement-scoped permit with `maxAmount`, the layer approve is capped at `maxAmount`, so no larger allowance outlives the session.
