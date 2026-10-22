---
'@rhinestone/sdk': minor
---

Make quote-plan and full-read executions match their `PlanExecution` type at runtime.

- Each `quote.plan` leg's `execution` now carries the `vm` and `chainId` its type always declared, copied from the leg, so `execution.vm` checks now match.
- `calls[].value`, including HyperCore `settlement.calls[].value`, is a `bigint` in quote plans and in `getIntentStatus(id, { full: true })` executions instead of a decimal string. Update code that compares it with a string.
- HyperCore `settlement` is now optional: it is absent when you send no HyperEVM calls.
- A full read's `details.executions.destination` is now `PlanExecution | null`: it is `null` when the record holds no destination execution.
