---
'@rhinestone/sdk': minor
---

Add the Rhinestone protocol fee: a caller-set fee that always accrues to Rhinestone, collected alongside `appFees` in one batched transfer, and — unlike the app fee — sponsorable.

- `transaction.protocolFees: { feeBps }` (0–10000) sets the rate; the `ProtocolFeeRate` type is exported.
- `sponsored.protocolFees` (or the `sponsored: true` shorthand) charges the integrator's sponsorship balance instead of the user, without the sponsorship surcharge.
- Quote responses surface the fee as `cost.fees.breakdown.protocol`.
