# Sponsorship approval contract

An intent-scoped sponsorship grant (a JWT-mode `X-Intent-Extension` token)
commits to a digest of the **approval input**, the `SerializedIntentInput` the
SDK hands to `getIntentExtensionToken` and exposes as
`PreparedTransactionData.intentInput`. The orchestrator never receives that
input. It recomputes it from the Caucasus `POST /quotes` body it did receive,
hashes it, and compares the result with the grant's
`policy.sponsorship.intent_input.digest`. This document defines that
recomputation for API version `2026-09.caucasus`. The Blanc projection works the
same way.

The SDK implements it in `src/clients/orchestrator/sponsorship-approval.ts`
(`projectSponsorshipApproval`). Golden vectors live in
`test/vectors/sponsorship-approval/vectors.json`.

## Timing

- The grant is presented on `POST /quotes`, together with the ordinary
  `Authorization` header, and only when the quote asks for sponsorship
  (`options.sponsorship` is present). The admission and pricing decisions both
  happen at that point.
- `POST /intents` never carries it. The grant is single-use, and submission
  bills from the quoted fees.
- The SDK asks the integrator once per prepare and never retries a quote. A
  denied or failed grant, or a request the contract cannot bind, stops the
  prepare with no quote and no fallback to self-funding.

## Digest

`digest = lowercase_hex(SHA-256(RFC 8785 JCS(intentInput)))`

`intentInput` is plain JSON. Amounts are decimal strings, never numbers.
Members that are absent and members that are `undefined` are the same thing.
Object key order does not matter. Array order does.

## Projection

The projection is total over the table below and refuses everything else. An
unknown key at any level, or a value outside the listed forms, is refused. Do
not ignore it and do not default it. The SDK refuses the same shapes before it
asks the integrator for anything
(`UnsupportedSponsorshipApprovalError`, reason `unsupported`).

### Chain ids

CAIP-2 values become the SDK's numeric ids, and map keys become decimal
strings.

| CAIP-2 | Id |
| --- | --- |
| `eip155:<n>` | `<n>` |
| `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet) | `792703809` |
| `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet) | `792703810` |
| `tron:mainnet` | `728126428` |
| `stellar:pubnet` | `1500148` |
| `hypercore:mainnet` / `hypercore:spot` / `hypercore:perp` | `1337` / `1337001` / `1337002` |

Any other CAIP-2 value is refused. RHI-7588 must confirm that the Solana ids
match the orchestrator's `fromCaip2`.

### Root

The body may contain only `account`, `destination`, `source` and `options`.
The output always contains `options`, even when it is `{}`. It never contains
the Caucasus names `destination`, `source` or `sponsorship`.

### `account`

| Body | Approval input |
| --- | --- |
| `evm.type: 'erc7579'` | `account.accountType: 'ERC7579'`; `account.setupOps` = `evm.initData.setupOps`, or `[]` when absent |
| `evm.type: 'eoa'` | `account.accountType: 'EOA'`; `account.setupOps: []` (no `initData` allowed) |
| `evm.address` | `account.address` |
| `evm.delegations.default.contract` | `account.delegations: { "0": { contract } }` |
| `evm.simulation.mockSignaturesByChain` | `account.mockSignatures`, keyed by numeric id |
| `evm.signatureMode` | `options.signatureMode` |
| `svm` | `account.svm`, verbatim: `type: 'swig'`, `address`, optional `swigAccount`, `authorization` (`secp256k1` + `address`, or `secp256r1` + `publicKey`), optional `initData { authority { kind, publicKey }, id? }` |
| `svm` with no `evm` | `account.address = svm.address`, and no `accountType`, `setupOps`, `delegations` or `signatureMode` |

`account` needs at least one entry. When both are present, the EVM fields
describe the executor and `account.svm` names the paying Swig.

Refused: any other `evm.type`, `evm.delegations.chains`, delegations without a
`default`, `evm.simulation.mockSignature`, any other `svm.type`, and any other
authority kind.

### `destination`

| Body | Approval input |
| --- | --- |
| `chainId` | `destinationChainId` |
| `tokenRequests` | `tokenRequests`, verbatim (`tokenAddress`, optional `amount`) |
| no execution | `destinationExecutions: []` |

Rules for each VM:

- **`evm`**
  - A `recipient` that is a bare `{ address }` becomes
    `{ address, accountType: 'EOA', setupOps: [] }`. This is the released v2
    spelling of a payee.
  - A typed `recipient` maps the same way as `account.evm`, without
    `signatureMode`.
  - `execution.calls` becomes `destinationExecutions`.
  - `execution.gasLimit` becomes `destinationGasUnits`.
  - `execution.executionTokensReceived` is refused.
- **`svm`**
  - `recipient { address }` is copied as is.
  - `execution.instructions` becomes `destinationInstructions`.
  - `execution.addressLookupTables` becomes `addressLookupTableAddresses`.
- **`tvm` and `stellar`**
  - `recipient { address }` is required and copied as is.
  - Any `execution` is refused.
- **`hypercore`**
  - `recipient` follows the `evm` rules.
  - `execution.actions` must hold exactly one action, which goes to
    `options.hyperCore: { action }`. Any other count is refused.
  - `execution.settlement.calls` / `.gasLimit` become `destinationExecutions` /
    `destinationGasUnits`.

On an EVM or HyperCore destination, a bare recipient and a typed `eoa`
recipient without delegations project to the same input. That matches v2, where
both were spelled that way, and both name the same delivery address.

### `source`

`source.selection` and `source.limits` become `accountAccessList`:

- **No `selection` and no `limits`.** There is no `accountAccessList`.
- **`selection` without `perChain`.**
  - `chains: { only }` becomes `chainIds`. `chains: 'all'` is omitted.
  - `tokens: { only }` becomes `tokens`. `tokens: 'all'` is omitted.
  - If both are omitted, there is no `accountAccessList`.
  - Any `limits` entry is refused, because a cap is only expressible per chain.
- **`selection` with `perChain`.**
  - `chains` must be `{ only }`, with the same set as the `perChain` keys.
  - `tokens` must be `{ only }`, with the same set as the union of the
    `perChain` lists.
  - Each `limits` entry must name a token listed for its chain, at most once.
  - A listed token with a limit goes to
    `chainTokenAmounts[id][token] = maxAmount`.
  - The other listed tokens go to `chainTokens[id]`, in list order.
  - A chain whose tokens are all capped has no `chainTokens` entry. A chain
    listed with no tokens has `chainTokens[id] = []`.
- **`except`.** Any `except` selector is refused.

The remaining `source` fields:

- `auxiliaryFunds` becomes `options.auxiliaryFunds`, keyed by numeric id.
- Each `executions[]` entry must have `vm: 'evm'`, with at most one entry per
  chain. They become `preClaimExecutions[id] = calls`.

### `options`

- `appFees`, `protocolFees`, `customDeadline`, `settlementLayers` and `quoters`
  are copied verbatim.
- `sponsorship` becomes `sponsorSettings`, verbatim. An explicit `false`
  category stays `false`.
- `selectionStrategy` and any other key are refused.

## EVM compatibility

For every EVM transaction, the approval input equals the one the released v2
SDK produces, so existing policies and digests keep working. The vectors record
the release they were calibrated against. A request whose Caucasus body cannot
say what that input says is refused rather than approximated
(`UnsupportedSponsorshipApprovalError`, reason `mismatch`). This applies only
when an intent-scoped grant would be requested. Known cases:

- `chainIds` combined with `chainTokens` or `chainTokenAmounts`
- a token that is both capped and uncapped on one chain, and duplicate tokens in
  a list
- an EOA with setup operations, or with session mock signatures
- `options.hyperCore` on a destination that is not HyperCore
- a configured recipient on a Solana, Tron or Stellar destination

API-key auth, JWT auth without `getIntentExtensionToken`, and unsponsored quotes
are never checked.

## Solana additions

These change only the unreleased Solana input:

- `account.svm` names the paying Swig wallet, the key that controls it and,
  outside a paired execution, its state account.
- A same-chain transfer pins the spent mint in `chainTokens`, or in
  `chainTokenAmounts` when it is capped.
- An SVM-only account has no `options.signatureMode`.
- A Swig creation also carries `svm.initData`, which is the installed root and
  the Swig id. Its request spells out
  `sponsorship: { gas: true, bridgeFees: false, swapFees: false }`, so the body
  and the input agree.
- A paired Solana → EVM execution spells its executor with the EVM account
  entry's projection: the `accountType` comes from `evm.type`.

## Vectors

`vectors.json` has three parts:

- `cases`: each entry holds the exact wire `body`, its `intentInput` and its
  `digest`.
- `refused`: each entry holds a `body` and the `field` it is refused on.
- `provenance`: records the release the EVM cases were calibrated against.

`vectors.test.ts` projects every body, refuses every refused body, and rebuilds
each case from the SDK so the vectors cannot drift. The EVM cases are built
through `prepareTransaction`, and the others through the request builders.

To regenerate after an intended change, run
`bun run scripts/vectors/sponsorship-approval.ts`.

To recalibrate the EVM cases:

1. Add a worktree of the release branch and run `bun install` in it.
2. Copy `test/vectors/sponsorship-approval/cases.ts` into that worktree.
3. Prepare each case there with a JWT `getIntentExtensionToken` that records its
   argument, stubbing `eth_getCode` as `derive.ts` does.
4. Compare the recorded inputs with `intentInput`. A difference is an SDK bug:
   fix the SDK, not the vector.
