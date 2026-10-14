---
paths:
  - "src/clients/orchestrator/**"
---

# Orchestrator wire boundary

- The SDK speaks `2026-09.caucasus`. The document it generates from is vendored at `scripts/openapi/caucasus.json` with a
  provenance manifest beside it, because Caucasus is not in the orchestrator's published version set yet. Change the
  snapshot and the manifest hash together, or `generate:wire` refuses to run.
- A `Sync wire types` run that fails typecheck opens no PR. Land the document update, the regenerated `wire.gen.ts` and the
  `mappers.ts` fix together, because a cast to a field the old document lacks cannot compile. Find failing runs with
  `gh run list --workflow sync-wire-types.yaml`.
- `src/clients/orchestrator/normalized.ts` is deliberately NOT the wire. It is the SDK's sponsorship projection, pinned
  across API versions because integrators' JWT policies digest it. Leave its field names and numeric chain ids alone.
- Everything else chain-facing is CAIP-2. The one numeric exception is the historical read variant in status
  (`operations[].chainId` as a number, and a transaction reference tagged `vm: 'unknown'`); model it, do not "fix" it.
