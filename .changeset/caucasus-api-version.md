---
'@rhinestone/sdk': major
---

Speak orchestrator API version `2026-09.caucasus`. Accounts, recipients, sources and destinations are now expressed in their own VM's terms, a quote states the authorizations it needs as an ordered list, and status reports every operation rather than one per chain. There is no compatibility mode: a prepared or signed transaction produced by an earlier release cannot be signed or submitted by this one, and refuses explicitly rather than being reinterpreted. Reconcile any in-flight submission first, then prepare it again.

Transaction inputs are unchanged: `chain`, `sourceChains` / `targetChain`, `sourceAssets`, `calls`, `tokenRequests`, `recipient`, `sponsored` and the HyperCore helpers all keep their shape and meaning. What changed is everything the orchestrator hands back.

### Signing is an ordered list, not a set of roles

`quote.signData` is replaced by `quote.signingRequests` — an ordered array. Each entry says which account it authorizes for, which authority must produce it, what it permits, how long it stays valid, and the payload to sign. `signTransaction` returns `proofs`, one per request, in the same order; `submitTransaction` sends exactly that.

Position is the identity of an authorization. Two requests can carry byte-identical payloads and still be two slots, so proofs are never filtered, sorted, deduplicated or inferred from their kind.

- `getTransactionMessages(prepared)` now returns `SigningRequest[]` instead of `{ origin, destination?, targetExecution? }`.
- `SignedTransactionData.originSignatures` / `destinationSignature` / `targetExecutionSignature` are replaced by `proofs: SigningProof[]`.
- `signIntent(signingRequests, targetChain, signers?)` takes the ordered requests and returns `{ proofs }`.
- Independent owner signatures carry `slots` instead of `origin`.
- A smart-session origin still yields **one** proof containing both `preClaim` and `notarizedClaim`; it is never split across two slots.
- Removed: `SignData`, `OriginSignData`, `Eip712OriginSignData`, `PersonalSignOriginSignData`, `OriginSignature`. New: `SigningRequest`, `SigningProof` and the types they are built from.

### EIP-7702 delegations are signed automatically

A quote asks for the delegations it needs as `delegationAuthorization` requests, and `signTransaction` produces them as part of the proof vector. Normal consumers no longer call anything extra, and `submitTransaction` no longer accepts an `authorizations` option.

`signAuthorizations(prepared)` remains for the advanced case where a different party signs the delegation. It now returns `IndexedProofContribution[]` — each bound to the intent, the exact ordered request set, and the slot it answers — which `assembleTransaction(prepared, ownerSignatures, { proofs })` folds in. A contribution from a different quote, a re-quote, or the wrong slot is refused, and an incomplete vector throws instead of submitting.

### Chains are CAIP-2

Quote costs, plans, requirements, signing context, bridge fills and status evidence carry CAIP-2 strings (`eip155:8453`, `solana:…`, `hypercore:perp`) rather than numbers, so a chain the SDK has no number for stays readable. Numeric chain ids remain where they always were: your `Transaction` inputs, viem chain objects, the sponsorship callback, and inside signed EIP-712 and EIP-7702 payloads.

The one exception is deliberate: an intent recorded before the chain registry knew a chain keeps a numeric `chainId` and a `vm: 'unknown'` transaction reference. That is an honest gap in an old record, not a chain identity to invent.

### Status reports every operation

`operations` is now grouped by chain, with every item inside: `{ chainId, items }`. A chain carrying both a claim and a fill reports both, and the item that debited the account is marked.

- Transaction references are tagged by VM — `{ vm: 'evm', txHash }`, `{ vm: 'svm', signature }`, `{ vm: 'tvm', txId }` — instead of everything being `txHash`.
- The fabricated zero `accountAddress` is gone. `accounts` lists the real per-VM, per-chain accounts, and is absent when the record does not identify them.
- `ChainOperation` is replaced by `IntentOperationGroup` and the `IntentOperationItem` union.
- The top-level `hyperCore` result is gone. A HyperCore outcome is an `{ type: 'EXECUTION', status, result }` item inside `operations`, alongside — not instead of — the settlement transaction it rides with.
- `refunds` entries are `{ transaction }`. An empty array means none were observed, which is still not proof none occurred.
- `getIntentStatus(intentId, { full: true })` returns the recorded detail block: legs, executions, deployments and economics as they happened. Polling stays lean by default, and `waitForExecution` is unchanged.

### Quotes disclose the plan

`quote.plan` states where the route sources from, where it delivers and what it deploys. `quote.requirements` lists unresolved prerequisites — an approval or a wrap — which are disclosed and never performed on your behalf; preparing a transaction still spends and deploys nothing. `quote.tokenRequirements` is replaced by `requirements`, and `TokenRequirements`, `ApprovalRequired` and `WrapRequired` are removed.

### Sponsorship is unchanged

`PreparedTransactionData.intentInput` keeps its shape, its field names and its numeric chain ids, and a JWT `getIntentExtensionToken` callback receives exactly what it received before. Existing sponsorship policies and digests keep working. `PreparedTransactionData` gains a `request` field carrying the versioned wire request; treat it as opaque and persist it with the rest.

### Not in this release

Self-service Swig creation, deployment-only quotes and automatic re-quote flows are still unavailable; a missing spending Swig still refuses with `SOLANA_ACCOUNT_NOT_CREATED`. There are no new estimate or intent-list methods. WebAuthn signing requests and cross-VM destination execution are represented on the wire but not supported — a quote asking for one fails with an actionable error rather than being signed as something else.

See [docs/caucasus-migration.md](https://github.com/rhinestonewtf/sdk/blob/main/docs/caucasus-migration.md) for the type-by-type inventory.
