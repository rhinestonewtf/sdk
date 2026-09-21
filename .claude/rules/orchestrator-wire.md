---
paths:
  - "src/clients/orchestrator/**"
---

# Orchestrator wire boundary

- A `Sync wire types` run that fails typecheck opens no PR. Land the `.openapi-ref` bump, the regenerated `wire.gen.ts` and
  the `mappers.ts` fix together, because a cast to a field the old pin lacks cannot compile. Find failing runs with `gh run list --workflow sync-wire-types.yaml`.
- `auxiliaryFunds` and `settlementLayers` are top-level `Transaction` fields, not under `options`. `auxiliaryFunds` is keyed
  by numeric chain id, so a CAIP-2 key from an untyped caller throws `Invalid chain id: NaN` from `mapChainRecord`.
