---
'@rhinestone/sdk': minor
---

Ask for sponsorship on a Solana-origin transaction — the same-chain transfer, the same-chain instruction execution and the Solana → EVM delivery all take `sponsored` in the shape an EVM transaction takes it, with the same translation.

- The SDK states the intent and the orchestrator decides. A served request comes back as a quote whose fee breakdown marks the sponsored categories; one it cannot bill is refused with its named categories intact.
- Today the orchestrator serves `gas` and, where the integrator set a rate, `protocolFees` on a Solana origin. The `sponsored: true` shorthand asks for all four categories and is refused on every Solana route until the orchestrator widens what it bills — the SDK does not narrow it on your behalf.
- `sponsored.bridging` on a Solana → EVM delivery restricts the route set, so a corridor no such route serves comes back as a refusal rather than a quote.
- A JWT-authenticated integrator approves a sponsored Solana intent the same way as an EVM one: `getIntentExtensionToken` runs when the quote is requested, and the grant is charged the same way on both VMs.
- Omitting `sponsored` is unchanged: the request and the submission are byte-for-byte what they are today.
