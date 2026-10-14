---
'@rhinestone/sdk': minor
---

Add settlement-scoped Smart Sessions and validation tools.

- Support ACROSS, CCTP, OFT, ECO_IE, SAME_CHAIN_IE and LZ where enforceable, with served addresses, recipient/delivery floors and optional settlement fees. Retired ECO is refused, SAME_CHAIN_IE is exclusive and excluded from `all`, and OFT and LZ cannot be combined.
- Add `sdk.validateSession` and offline `/smart-sessions` `validateSession`, stable refusal/warning codes, access metadata and dropped-layer coverage. Offline resolution accepts caller-supplied settlement catalog and wrapped-native data without network reads.
- Add one-time-use policy/burn helpers, chain-aware policy defaults, deployed UniversalActionPolicy-copy verification on online create/validate, and coherent budget-reset checks through `SessionDetailsOptions`.
- Add opt-in `swap.stableFloor` and independent permission/permit/swap windows. Fee and floor coverage applies only to the paths each policy enforces.
