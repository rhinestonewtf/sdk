---
'@rhinestone/sdk': major
---

- `PortfolioToken.chains[]` replaces `locked`/`unlocked` with a single `amount: bigint`, matching the orchestrator's blanc wire shape (`balance: { locked, unlocked }` collapsed to a flat `amount`; post-compact, locked is always `0`).
