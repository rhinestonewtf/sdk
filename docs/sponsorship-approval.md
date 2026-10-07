# Sponsorship approval contract

An intent-scoped sponsorship grant (a JWT-mode `X-Intent-Extension` token)
commits to a digest of the **approval input**, the `SerializedIntentInput` the
SDK hands to `getIntentExtensionToken` and exposes as
`PreparedTransactionData.intentInput`. The orchestrator never receives that
input. It recomputes it from the Caucasus `POST /quotes` body it did receive,
hashes it, and compares the result with the grant's
`policy.sponsorship.intent_input.digest`.

The current contract is **`sdk-3.0.0-caucasus`**, for the singular
`2026-09.caucasus` body this SDK sends. The SDK implements it in
`src/clients/orchestrator/sponsorship-approval.ts` (`projectSponsorshipApproval`)
and owns its golden vectors, in
`test/vectors/sponsorship-approval-caucasus/vectors.json`. The
[interim singular contract](#interim-singular-contract-frozen) and the earlier,
unversioned contract are [frozen](#legacy-contract-frozen).

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
Members that are absent and members that are `undefined` are the same thing;
`null` is not an omission and is refused. Object key order does not matter.
Array order does.

## Projection

The approval input is the validated body verbatim:

```json
{
  "contractVersion": "sdk-3.0.0-caucasus",
  "account": { … },
  "source": { … },
  "destination": { … },
  "options": { … }
}
```

- `account`, `source`, `destination` and `options` are the body's own values:
  CAIP-2 chain ids, chain-native token and account strings, decimal-string
  amounts, explicit `false`s and array order, exactly as sent.
- `source` is omitted when the body has none. `options` is `{}` when the body
  has none.
- The same-chain shorthand (a transaction that omits `source.chain`) is
  expanded before the body is built, so it approves exactly like a transaction
  that names the destination chain.

Every field is validated against the allowlist below before anything is
hashed. An unknown key at any level, or a value outside the listed forms, is
refused: a stripped extra field would let two different requests share one
grant. The SDK refuses the same shapes before it asks the integrator for
anything (`UnsupportedSponsorshipApprovalError`, reason `unsupported`, with the
offending `field`).

### Allowlist

| Path | Allowed |
| --- | --- |
| root | `account`, `source`, `destination`, `options` |
| `account` | `evm` and/or `svm`, at least one |
| `account.evm` | `type: 'eoa'` with `address`, `delegations`, `signatureMode`; or `type: 'erc7579'` with `address`, `initData.setupOps[{ to, data }]`, `delegations`, `simulation { mockSignature, mockSignaturesByChain }`, `signatureMode` |
| `…delegations` | `default { contract }` and/or `chains { <caip2>: { contract } }` |
| `account.svm` | `type: 'swig'`, `address`, `swigAccount`, `authorization` (`secp256k1` + `address`, or `secp256r1` + `publicKey`), `initData { authority { kind, publicKey }, id }` |
| `source` | `vm` (`'evm'` or `'svm'`), `chainId`, `token`, `maxAmount`, `auxiliaryFunds`, `execution { calls[{ to, value, data }] }` (EVM only) |
| `destination` | `vm`, `chainId`, `token`, `amount` (only with `token`), `recipient`, and `execution` for `evm`, `svm` and `hypercore` |
| `destination.recipient` | `evm` / `hypercore`: a bare `{ address }` or a typed account as `account.evm`, without `signatureMode`. `svm`: `{ address }`. `tvm` / `stellar`: `{ address }`, required |
| `destination.execution` | `evm`: `calls`, `gasLimit`. `svm`: `instructions[{ programId, accounts[{ pubkey, isSigner, isWritable }], data }]` and `addressLookupTables`, or `authority` alone (`add` with `key { kind, publicKey }` and `permission`, or `remove` with `key`). `hypercore`: `actions` (exactly one) and `settlement { calls, gasLimit }` |
| `options` | `appFees { feeBps }`, `protocolFees { feeBps }`, `customDeadline`, `settlementLayers` / `quoters` (`{ include }` or `{ exclude }`), `sponsorship { gas, bridgeFees, swapFees, protocolFees }` (booleans) |

The legacy body's `tokenRequests`, `source.selection`, `source.limits`,
`source.executions` and maps keyed by chain are outside the allowlist, so a
legacy-shaped body is refused.

## Solana

- A Solana-origin request names the paying Swig in `account.svm`, and names
  its state account there outside a paired Solana → EVM execution.
- Transfers and deliveries name the spent mint (or native SOL) as a
  `source { vm: 'svm', token, maxAmount? }`.
- A sponsored instruction execution, a Swig authority change and a Swig
  creation have no `source`. The last two spell out
  `sponsorship: { gas: true, bridgeFees: false, swapFees: false }`, so the body
  and the input agree. An unsponsored instruction execution names the token its
  charge is paid in as its `source`.

## Integrator policies

`/jwt-server`'s `shouldSponsor` and `SponsorshipFilter` read the same policy
values from three inputs:

- `sdk-3.0.0-caucasus`, which this SDK sends.
- `sdk-caucasus-singular-2026-09-v1`, which earlier v3 snapshots send.
- The unversioned legacy input of v2 and older pinned SDKs (no
  `contractVersion` member).

Any other `contractVersion` is refused, and so the prepare fails. Deploy
helpers (or a signer of your own) that accept `sdk-3.0.0-caucasus` on your
backend **before** your clients send it. A policy of its own that reads legacy
field names (`destinationChainId`, `destinationExecutions`, `tokenRequests`,
numeric chain ids) must be reviewed: the current input has none of them.

## Vectors

`test/vectors/sponsorship-approval-caucasus/vectors.json` has:

- `contractVersion` and the `digest` rule.
- `cases`: each entry holds the exact wire `body`, its `intentInput` and its
  `digest`.
- `refused`: each entry holds a `body` and the `field` it is refused on.
- `provenance`: how the cases are derived, and the orchestrator commit they
  were last cross-checked against, with the result.

`vectors.test.ts` projects every body, refuses every refused body, and rebuilds
each case from the SDK so the vectors cannot drift. The EVM cases are built
through `prepareTransaction` (or `deploy`), and the others through the request
builders.

To regenerate after an intended change, run
`bun run scripts/vectors/sponsorship-approval.ts`; it carries `provenance`
over. Re-run the orchestrator cross-check whenever the vectors or the
orchestrator's projection change: in an orchestrator checkout, run its
singular-vectors test (`authorizeQuoteRequest`, apiVersion `2026-09.caucasus`,
intent scope) against this file with the stable identifier, and record the
repository, ref, commit and result in `provenance.orchestratorCrossCheck`.

## Interim singular contract (frozen)

`sdk-caucasus-singular-2026-09-v1` is the same projection under a different
identifier. Earlier v3 dev snapshots send it, the orchestrator still serves it
and `/jwt-server` still accepts it. Its vectors,
`test/vectors/sponsorship-approval-singular/vectors.json`, are frozen: a hash
guard in its `vectors.test.ts` fails on any change, and every case is
re-projected by the current projector with the identifier swapped. A Solana
transaction prepared under it fails restore with
`InvalidSolanaTransactionArtifactError`; prepare it again.

## Legacy contract (frozen)

The unversioned approval input earlier SDKs send (numeric chain ids,
`tokenRequests`, `accountAccessList`, `destinationExecutions`,
`options.sponsorSettings`, …) is frozen. The orchestrator still serves it to
older pinned clients and copies
`test/vectors/sponsorship-approval/vectors.json` verbatim as its fixture, so
that file is never regenerated: a hash guard in its `vectors.test.ts` fails on
any change. `legacy-projection.ts` beside it projects and refuses the stored
bodies exactly as recorded; nothing in `src/` uses it.
