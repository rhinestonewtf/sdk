---
paths:
  - "src/chains/**"
---

# Chains

- A non-EVM chain is unaddressable until the SDK ships it: `parseCaip2` throws on any id missing from `NON_EVM_CHAINS`
  (`caip2.ts`), whatever the orchestrator or the chain facts serve.
- Adding one takes the table entry, a descriptor and `kind` in `non-evm.ts`, the root export in `src/index.ts` (a minor
  changeset), and a `kind`/CAIP-2 pair in `src/api/account.ts`'s descriptor check, which otherwise rejects it as mismatched.
