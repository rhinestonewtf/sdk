---
'@rhinestone/sdk': patch
---

Fix Smart Session settlement execution and catalog freshness.

- Enforce claims from the ERC-1271 policy list while retaining compiled claim metadata for signing; reject duplicate policy addresses that would overwrite installed guards.
- Preserve verify-execution mode for scoped, fallback and once sessions, reject origin operations for `preClaimOps: 'none'`, and insert enable/burn calls in settlement order without duplicate same-chain burns.
- Intersect session scope with the explicit source token, amount and route before quoting, preserving ordered signing requests and sponsorship binding.
- Refresh served chain data after ten minutes and retry failed fetches without evicting newer in-flight entries.
- Update fynd TychoRouter V3 calldata handling and reduce settlement policy encodings while retaining enforced constraints.
