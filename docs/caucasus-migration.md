# Migrating to `2026-09.caucasus`

The SDK now speaks orchestrator API version `2026-09.caucasus`. This is a
breaking change to the transaction input (see
[Singular source and destination](#singular-source-and-destination)), to
everything the orchestrator hands back, to how a transaction is signed, to the
sponsorship approval input, and to the obsolete `sponsored.swapValue` option.

There is no compatibility mode. A prepared or signed transaction produced by an
earlier release fails explicitly on this one rather than being reinterpreted —
reconcile any in-flight submission first, then prepare it again.

## What did not change

- The transaction options `appFees`, `protocolFees`, `settlementLayers`,
  `quoters`, `sponsored`, `signers`, `eip7702InitSignature`, and the HyperCore
  order helpers.
- `prepareTransaction` → `signTransaction` → `submitTransaction` →
  `waitForExecution`, and their `PENDING` / `COMPLETED` / `FAILED` semantics.
- `TransactionResult`, quotes, signing and status.
- Preparation is still side-effect-free: it neither spends nor deploys.

## Singular source and destination

A transaction now names one `destination` and, at most, one `source` that
funds it. The SDK spends exactly that source: it no longer discovers source
chains, picks between several, or reads the chain catalog.

```ts
await account.prepareTransaction({
  source: { chain: arbitrum, token: usdcOnArbitrum, maxAmount: 5_000_000n },
  destination: { chain: base, token: usdcOnBase, amount: 1_000_000n, calls },
  sponsored: true,
})
```

| Before | After |
| --- | --- |
| `chain` (same-chain) | `destination.chain`, with `source.chain` omitted |
| `targetChain` | `destination.chain` |
| `sourceChains: [chain]` | `source.chain`; several chains have no equivalent |
| `sourceAssets` token list or chain → tokens map | `source.token`, one token on `source.chain` |
| `sourceAssets: [{ chain, address, amount }]` | `source: { chain, token, maxAmount }` |
| `tokenRequests: [{ address, amount }]` | `destination.token` and `destination.amount`; several tokens have no equivalent |
| `recipient`, `calls`, `gasLimit` | `destination.recipient`, `destination.calls`, `destination.gasLimit` |
| `hyperCore` | `destination.hyperCore`, on a HyperCore destination only |
| `sourceCalls: { [chainId]: calls }` | `source.calls`, on the source chain only |
| `auxiliaryFunds: { [chainId]: { [token]: amount } }` | `source.auxiliaryFunds`, one amount of `source.token` |
| `instructions`, `addressLookupTables`, `authority` | `destination.instructions`, `destination.addressLookupTables`, `destination.authority` |

The old top-level fields are refused by name with what replaced each, and any
unknown key inside `source` or `destination` is refused too.

The rules:

- **Delivery.** `destination.token` with `amount` asks for exactly that
  amount; `token` alone takes the most the source yields; neither delivers
  nothing. `amount` without `token` is refused.
- **Same-chain shorthand.** Omit `source.chain` to spend on
  `destination.chain`. A cross-chain transaction names it: nothing else is
  inferred. HyperCore, Tron and Stellar cannot fund, so a transaction to them
  names an EVM `source.chain`.
- **When a source is required.** A delivery needs a `source`, even when
  sponsored, and so does any execution that is not gas-sponsored. Only a
  gas-sponsored (`sponsored: true`, or `{ gas: true, … }`) execution that
  delivers nothing, on an EVM chain or as a Solana instruction execution or
  authority change, may omit it. The orchestrator decides what it covers and
  the SDK never retries unsponsored.
- **Source calls.** `source.calls` run on the source chain before the claim.
  A call's `provides` must name `source.token`, and its amounts add to
  `source.auxiliaryFunds`. Source calls that used to be dropped silently now
  run, or are refused by the orchestrator.
- **Smart sessions.** A session that needs enabling puts its enable call first
  on the source, so a source-free transaction whose session is not yet enabled
  is refused before quoting: name a `source`, or enable the session first.
- **`customDeadline`** on a cross-chain transaction is now refused instead of
  dropped, and `hyperCore` on a destination that is not HyperCore is refused.

### Deployment and setup

`deploy('evm', chain, { sponsored })` keeps working. A sponsored intent-path
deployment spends nothing; an unsponsored one pays in a same-chain token it now
needs named: `deploy('evm', chain, { source: { token } })`. Intent-path
`setup(chain)` likewise takes `setup(chain, { source: { token } })`. Either
refuses before any request without it. Deployments and setup that run as
UserOperations are unchanged.

### Solana

| Transaction | Shape |
| --- | --- |
| Same-chain SPL transfer | `{ source: { token: mint, maxAmount? }, destination: { chain, token: mint, amount?, recipient } }` |
| Solana → EVM delivery | `{ source: { chain: cluster, token, maxAmount? }, destination: { chain, token, amount?, recipient?, calls?, gasLimit? } }` |
| Instructions | `{ destination: { chain, instructions, addressLookupTables? }, sponsored }`, or with `source: { token }` naming the fee token when unsponsored |
| Authority change | `{ destination: { chain, authority } }`, also for `getAuthorityStatus` |

`deploy('solana', …)` is unchanged. A Solana source takes no
`auxiliaryFunds` or `calls`.

### Approval input and policies

`PreparedTransactionData.intentInput`, and the argument of JWT
`getIntentExtensionToken`, is now the versioned
`sdk-3.0.0-caucasus` input: the quote body itself, with CAIP-2 chain ids and
chain-native strings ([sponsorship approval](sponsorship-approval.md)). A
sponsorship policy that reads `destinationChainId`, `destinationExecutions`,
`tokenRequests` or numeric chain ids must be reviewed. `/jwt-server`'s
`shouldSponsor` reads the new input, the interim
`sdk-caucasus-singular-2026-09-v1` input of earlier v3 snapshots, and the one
older pinned SDKs send.

Deploy the backend first: update `/jwt-server` (or your own signer) to accept
`sdk-3.0.0-caucasus` before any client sends it. Older helpers refuse an
unknown `contractVersion`, so the prepare fails.

If you adopted an earlier v3 snapshot, which sends
`sdk-caucasus-singular-2026-09-v1`, only the identifier (and so the digest)
changes. A Solana transaction prepared under the
interim identifier fails restore with `InvalidSolanaTransactionArtifactError`;
prepare it again. Persisted EVM transactions are unaffected.

### Exports

Removed: `TokenRequest`, `NonEvmTokenRequest`, `NonEvmTokenRequests` and
`AuxiliaryFunds` from `@rhinestone/sdk`, and `SolanaSourceAsset` from
`@rhinestone/sdk/solana`. Added: `TransactionSource`, `TransactionDestination`,
`EvmDeployOptions` and `EvmSetupOptions` from `@rhinestone/sdk`, and
`SolanaTransactionSource` from `@rhinestone/sdk/solana`. `IntentInput` and
`SerializedIntentInput` describe the new approval input.

## VM-specific entry points

Solana- and EVM-specific exports moved out of the package root into their own
entry points. `@rhinestone/sdk/utils` is gone, and there are no root aliases.
Errors, including the Solana errors and guards, stay in `@rhinestone/sdk/errors`.

| Before | After |
| --- | --- |
| `solanaAddress`, `createSolanaSwigId`, `solanaMainnet`, `solanaDevnet` from `@rhinestone/sdk` | `@rhinestone/sdk/solana` |
| `Solana*` types (`SolanaAddress`, `SolanaChain`, `SolanaAccountMeta`, `SolanaInstruction`, `SolanaInstructionInput`, `SolanaProgramInstruction`, `SolanaAccountConfig`, `SolanaManagedAccountConfig`, `SolanaStandaloneAccountConfig`, `SolanaReceiverAccountConfig`, `SolanaOwner`, `SolanaStandaloneAccount`, `SolanaDeployOptions`, `SameChainSolanaTransaction`, `SameChainSolanaInstructionsTransaction`, `CrossChainSolanaOriginTransaction`, `SolanaExecutionMetadata`, `SolanaInstructionsExecutionMetadata`, `SolanaCrossChainExecutionMetadata`) from `@rhinestone/sdk` | `@rhinestone/sdk/solana` |
| Anything from `@rhinestone/sdk/utils` | `@rhinestone/sdk/evm` (same names) |
| `OWNABLE_VALIDATOR_ADDRESS`, `WEBAUTHN_VALIDATOR_ADDRESS`, `MULTI_FACTOR_VALIDATOR_ADDRESS`, `MULTI_FACTOR_VALIDATOR_V2_ADDRESS`, `SMART_SESSION_EMISSARY_ADDRESS` from `@rhinestone/sdk` | `@rhinestone/sdk/evm` |
| `EvmAccountConfig`, `EvmAccountEntry`, `EvmReceiverAccountConfig`, `ManagedEvmAccount` from `@rhinestone/sdk` | `@rhinestone/sdk/evm` |

```ts
import { RhinestoneSDK } from '@rhinestone/sdk'
import { toViewOnlyAccount, type EvmAccountConfig } from '@rhinestone/sdk/evm'
import { solanaAddress, solanaDevnet } from '@rhinestone/sdk/solana'
```

Behavior and types are unchanged; only the import paths move.

## Managed Solana accounts require explicit identity

Every managed Solana branch now names the existing Swig it uses:

```ts
const solana = {
  owner: { type: 'ecdsa' as const, account: solanaSigner },
  // Existing Swig state account; the wallet PDA is derived automatically.
  swig: savedStateAddress,
}

await sdk.createAccount({ solana })
await sdk.createAccount({ solana, evm: { address: evmReceiver } })
await sdk.createAccount({ solana, evm: managedEvmConfig })
```

There is no EVM-derived fallback and account construction does not deploy or
verify the Swig. Save its state-account address during provisioning; the SDK
derives the asset-holding wallet PDA. To create a Swig through the SDK, call
`account.deploy('solana', solanaDevnet)` — see [Creating the Swig](#creating-the-swig). The Solana owner may
be an ECDSA account or WebAuthn account and may be shared with EVM, but the two
VMs authorize independently.

Plain Solana transfers, instructions, and deliveries use the standalone SVM
request even when EVM is configured. Their normalized sponsorship account is
now the Swig wallet, so review or reissue policies that granted sponsorship to
the former EVM identity. EVM-origin operations are unchanged. Solana-to-EVM
destination calls remain available only when the explicit Swig matches the
backend-compatible Swig derived from the managed EVM account; unrelated pairs
must omit calls and use plain delivery. Address-only EVM receivers provide a
default recipient but cannot execute calls.

Previously prepared paired plain-Solana artifacts do not get reinterpreted.
Reconcile any possible submission, then prepare again with the explicit Swig.

### Creating the Swig

`deploy` now names its VM first. The EVM deployment is
`account.deploy('evm', chain, { sponsored })`; `account.deploy(chain, …)` no
longer compiles.

`account.deploy('solana', solanaChain, { swigId })` creates the configured Swig
as a sponsored deployment intent, installs the configured owner as its root,
and resolves `true` once the Swig exists. Nothing is signed; the integrator's
gas sponsorship pays the rent and fees.

```ts
// An independent Swig: mint once, save `id` with `swig`.
const { id, swig } = createSolanaSwigId()
const account = await sdk.createAccount({ solana: { owner, swig } })
await account.deploy('solana', solanaDevnet, { swigId: id })

// The Swig derived from a managed EVM account needs no id.
await composite.deploy('solana', solanaDevnet)
```

`swigId` is required on an account without managed EVM, whose Swig is always
independent. It is optional on a composite account, where the SDK computes the
id of the Swig derived from the EVM account; an independent Swig there still
needs its saved id.

Creation is one-shot: a Swig created with the wrong owner permanently strands
its wallet. A wrong or missing id, an ECDSA owner without `publicKey` (such as a
JSON-RPC account), and an environment or endpoint other than the one the account
was created against are refused before any request. A Swig that already exists resolves `true` without creating anything;
its root authority is not verified, and a Swig whose root is not the configured
owner cannot be spent by it.

### Managing Solana authorities

`prepareTransaction({ destination: { chain, authority } })` adds or removes a passkey or a
secp256k1 (ECDSA) key on the account's Swig. Build the change with
`@rhinestone/sdk/solana`:

- `addPasskey` / `removePasskey` take a viem `WebAuthnAccount` or a P-256
  public key in any encoding.
- `addEcdsaKey` / `removeEcdsaKey` take a viem local account or a secp256k1
  public key: 33-byte compressed, 65-byte uncompressed or 64-byte x‖y. An
  uncompressed key must lie on secp256k1. An EVM address is never a key and is
  refused, as is a WebAuthn account or an account that exposes no `publicKey`.
  A compressed key from another curve can't be detected, so pass the public
  key of the signer you will configure.

The configured owner signs the change with one prompt. One change per
transaction. The change is always gas-sponsored, billed to the integrator's
sponsorship like `deploy('solana', …)`. The sponsor funds the rent a new role
locks, and a removal returns that rent to the wallet. No fees or tokens move.

`permission` is required on an add, with no default:

| Permission | Spend and run instructions | Add and remove non-root authorities |
| --- | --- | --- |
| `all` | yes | yes |
| `allButManageAuthority` | yes | no |
| `manageAuthority` | no | yes |

`manageAuthority` is not a limited right: it can add a key with `all`, so it is
takeover power over the wallet. Grant it only to a signer you trust with the
wallet.

The orchestrator refuses a change the Swig doesn't allow with
`SolanaAuthorityChangeRefusedError`. That covers a key already present, a
missing key, the root role, an owner whose role can't manage authorities, a key
on a role that is not a plain passkey or secp256k1 role, and a removal that
leaves no role able to manage authorities. Removing the configured owner's own
key succeeds only while another manager remains, and leaves that owner unable
to sign.

#### Enrolling a recovery key

Deploying the Swig and enrolling a recovery key are separate transactions, with
no atomicity between them. A wallet is ready only once `getAuthorityStatus`
reports the enrollment `applied`; a derived address alone is not readiness.
Resume against that status, and never redeploy or resubmit a change that
landed:

```ts
import { addEcdsaKey, solanaDevnet } from '@rhinestone/sdk/solana'

// The passkey is the Swig root.
const account = await sdk.createAccount({
  solana: { owner: { type: 'passkey', account: passkey }, swig },
})
await account.deploy('solana', solanaDevnet, { swigId })

const enroll = {
  destination: {
    chain: solanaDevnet,
    authority: addEcdsaKey(recoveryPublicKey, { permission: 'manageAuthority' }),
  },
}
let { status } = await account.getAuthorityStatus(enroll)
if (status === 'notApplied') {
  const signed = await account.signTransaction(
    await account.prepareTransaction(enroll),
  )
  await account.waitForExecution(await account.submitTransaction(signed))
  ;({ status } = await account.getAuthorityStatus(enroll))
}
if (status !== 'applied') {
  // `conflict`: the key holds another permission. Surface it; never treat it as ready.
  throw new Error(`recovery enrollment is ${status}`)
}
```

`getAuthorityStatus` quotes the change, discards the quote, and reads the
orchestrator's answer. It never signs or submits:

- `applied`: an add holds exactly the requested permission (on `roleId`), or a
  removed key is gone.
- `notApplied`: the change is still to make.
- `conflict`: an add's key sits on `roleId` with another permission, or one the
  orchestrator could not read (`permission` absent).

Any other refusal, a missing Swig and network errors are thrown. The quote needs
a configured owner able to manage authorities. Under JWT auth, it mints one
sponsorship grant that is never used. `notApplied` says nothing about an intent
still in flight. After an uncertain outcome (a failed or timed-out wait, or a
network error on submit), settle the original intent with `waitForExecution`
or `getIntentStatus` first, then check. The orchestrator also refuses a second
landing at submit.

#### Acting through the recovery key

An account configured with the manage-only key as its owner adds or removes
authorities on the same Swig. Its signer can be external, such as a KMS or an
enclave behind a viem `toAccount`, so the private key never enters the SDK:

```ts
import { toAccount } from 'viem/accounts'
import { addPasskey, solanaDevnet } from '@rhinestone/sdk/solana'

const recovery = await sdk.createAccount({
  solana: {
    owner: {
      type: 'ecdsa',
      account: toAccount({ address: recoveryAddress, signMessage, signTransaction, signTypedData }),
    },
    swig,
  },
})
const added = await recovery.prepareTransaction({
  destination: {
    chain: solanaDevnet,
    authority: addPasskey(newPasskey, { permission: 'all' }),
  },
})
await recovery.waitForExecution(
  await recovery.submitTransaction(await recovery.signTransaction(added)),
)
```

The added passkey then owns the same wallet when configured with the same
`swig`. The manage-only account's own spends and instructions are refused by
the orchestrator with a `ValidationError` (`UNSUPPORTED_ACCOUNT_TYPE`,
`role_permission`) before anything is signed.

The quote's slot window is short (about 24 seconds). A prompt answered after it
closes fails with `SolanaQuoteExpiredError`; prepare again.

This needs an orchestrator that accepts secp256k1 keys and `manageAuthority`
on caucasus, which is the development endpoint only for now. An older one
refuses them with a `ValidationError` before anything is signed.

## Swap sponsorship

The separate `sponsored.swapValue` option is removed. Use `sponsored.swaps` for
swap sponsorship:

```ts
await account.prepareTransaction({
  // ...
  sponsored: { gas: true, bridging: true, swaps: true },
})
```

For enabled integrators and eligible same-chain stablecoin pairs, the
orchestrator can also sponsor the market shortfall under `swaps`. There is no
separate client-side switch for par-swap value sponsorship.

## Startale accounts default to v1.0.1

Startale accounts deploy the v1.0.1 implementation and factory by default, so a
config that derived a v1.0.0 address now derives a different one. Typed data is
signed against the v1.0.1 EIP-712 domain.

Existing v1.0.0 accounts opt back in with
`account: { type: 'startale', version: '1.0.0' }`, which keeps their address and
signs against the v1.0.0 domain. `initData` with a `factory` keeps its version
automatically, whatever `version` says. An address-only `initData` carries no
factory, so a v1.0.0 account passed that way must set `version: '1.0.0'`;
otherwise typed-data signatures from the K1 validator fail on-chain.

## Signing: ordered requests and ordered proofs

A quote used to hand back payloads keyed by role. It now hands back an **ordered
list** of the authorizations it needs.

```ts
// Before
const { origin, destination, targetExecution } =
  account.getTransactionMessages(prepared)

// After
const requests = account.getTransactionMessages(prepared)
//    ^ SigningRequest[] — ordered
```

Each request states the account it authorizes for, the authority that must
produce the signature, the scope it permits, how long it stays valid, and the
payload:

```ts
for (const request of requests) {
  request.purpose // 'originAuthorization' | 'destinationAuthorization'
                  // | 'targetExecutionAuthorization' | 'delegationAuthorization'
  request.payload.kind // 'eip712' | 'personalSign' | 'eip7702' | 'webauthn'
}
```

An EVM request that authorizes HyperCore agent registrations discloses them as
`scope.hyperCore`, a non-empty list in registration (slot) order: one on a
per-leg request, all of them on an aggregate request. Each item names the
action, nonce, agent, and slot, which the payload carries only as CoreWriter
calldata.

`signTransaction` returns one proof per request, in the same order, and
`submitTransaction` sends exactly that:

```ts
// Before
signed.originSignatures
signed.destinationSignature
signed.targetExecutionSignature

// After
signed.proofs // SigningProof[], signed.proofs[i] answers requests[i]
```

**Position is the identity of an authorization.** Two requests can carry
byte-identical payloads and still be two distinct slots. Do not filter, sort,
deduplicate or reorder proofs, and do not infer a slot from a proof's kind.

A smart-session origin still produces **one** proof carrying both encodings of
the one message:

```ts
{ kind: 'eip712', signature: { preClaim, notarizedClaim } }
```

It is never split across two slots, and the halves are never swapped.

### Removed signing types

| Removed | Use instead |
| --- | --- |
| `SignData` | `SigningRequest[]` |
| `OriginSignData`, `Eip712OriginSignData`, `PersonalSignOriginSignData` | `SigningRequest['payload']` |
| `OriginSignature` | `SigningProof` |
| `SignedIntentData.originSignatures` / `destinationSignature` / `targetExecutionSignature` | `SignedIntentData.proofs` |

New public types: `SigningRequest`, `SigningRequestAccount`, `SigningRequestPurpose`,
`SigningAuthority`, `SigningScope`, `SigningValidity`, `SigningPayload`,
`SigningProof`, `WebAuthnAssertion`, `Caip2ChainId`, `TransactionReference`,
`IntentOperationGroup`, `IntentOperationItem`, `IntentOnchainOperation`,
`IntentExecutionOperation`, `IntentOperationAllocation`, `IntentAccountSummary`,
`IntentAccountView`, `IntentDetails`, `IntentLeg`, `IntentRequirement`,
`QuotePlan`, `PlanLeg`, `PlanExecution`.

`signIntent` keeps its name and takes the ordered requests:

```ts
// Before
await account.signIntent(signData, targetChain, signers)
// After
const { proofs } = await account.signIntent(signingRequests, targetChain, signers)
```

Independent owner signatures index the request slots they cover, so
`IndependentOwnerSignature.origin` is now `slots`. Every request the account
itself has to authorize is a slot, not just the origins: an Across-settled
route from a smart account also carries a target execution authorization, so
the owner signs it and `assembleTransaction` expects it. One signing ceremony
per distinct payload — a repeated payload is signed once and reused for the
slots that ask for the same bytes.

## EIP-7702 delegations are collected automatically

A quote asks for the delegations it needs as `delegationAuthorization` requests,
and `signTransaction` produces them as part of the proof vector. Normal
consumers no longer call anything extra:

```ts
// Before
const prepared = await account.prepareTransaction(tx)
const signed = await account.signTransaction(prepared)
const authorizations = await account.signAuthorizations(prepared)
await account.submitTransaction(signed, { authorizations })

// After
const prepared = await account.prepareTransaction(tx)
const signed = await account.signTransaction(prepared) // delegations included
await account.submitTransaction(signed)
```

`submitTransaction` no longer accepts an `authorizations` option. It acquires no
signatures and reads no mutable nonce state.

`signAuthorizations(prepared)` remains for the advanced case where a different
party signs the delegation. It now returns `IndexedProofContribution[]`, each
bound to the intent, the exact ordered request set, and the slot it answers:

```ts
const contributions = await account.signAuthorizations(prepared)
const signed = await account.assembleTransaction(prepared, ownerSignatures, {
  proofs: contributions,
})
```

Contributions may arrive in any order. A contribution from a different intent, a
re-quote, or the wrong slot is refused, as is a second contribution for a slot
already filled. An incomplete vector throws `IncompleteIntentProofsError` naming
the missing slots — a sparse vector is never returned as a signed transaction.

## Chains are CAIP-2

Quote costs, plans, requirements, signing context, bridge fills and status
evidence carry CAIP-2 strings rather than numbers:

```ts
// Before
quote.cost.input[0].chainId // 8453
// After
quote.cost.input[0].chainId // 'eip155:8453'
```

so a chain the SDK has no number for stays readable. Numeric chain ids remain
where they always were: your `Transaction` inputs, viem chain objects, the
sponsorship callback, and inside signed EIP-712 and EIP-7702 payloads.

One exception is deliberate. An intent recorded before the chain registry knew a
chain keeps a numeric `chainId` and a `vm: 'unknown'` transaction reference:

```ts
{ vm: 'unknown', chainId: 424242, id: '…' }
```

That is an honest gap in an old record, not a chain identity to invent.

`BridgeFill.destinationChainId` is CAIP-2 too, and every variant now carries
`fillStatusTimeout`. Provider-specific ids such as Eco's
`providerDestinationChainId` stay opaque metadata beside it — use those, not the
CAIP-2 id, against the provider's own status API.

## Quotes disclose the plan and its prerequisites

```ts
quote.purpose        // 'execution'
quote.plan           // { source, destination, deployments }
quote.requirements   // unresolved approvals and wraps
quote.signingRequests
```

`quote.tokenRequirements` is replaced by `quote.requirements`, a typed array:

```ts
// Before
quote.tokenRequirements?.[8453]?.[token] // { type: 'approval', amount, spender }
// After
quote.requirements // [{ kind: 'erc20Approval', chainId: 'eip155:8453', account,
                   //    tokenAddress, amount, spender }]
```

Requirements are **disclosed, never performed**. Preparing a transaction does
not approve or wrap anything on your behalf.

`TokenRequirements`, `ApprovalRequired` and `WrapRequired` are removed.

### Swig authority is optional recorded evidence

A Swig account summary always identifies its asset-holding `wallet` and
`swigAccount`, but its `authority` is absent when the historical intent record
has no authority evidence. This applies wherever summaries are disclosed,
including status accounts, full-detail deployments, quote plans, and
requirements.

Guard the field before discriminating the authority kind:

```ts
const account = status.accounts?.find(
  ({ vm, account }) => vm === 'svm' && 'swigAccount' in account,
)?.account

if (account && 'swigAccount' in account && account.authority) {
  if (account.authority.kind === 'secp256k1') {
    account.authority.address
  } else {
    account.authority.publicKey
  }
}
```

Do not infer a missing value from an EVM identity or current chain state.
Account summaries disclose recorded facts; they do not authorize signing.
`SigningRequest.authority` and caller-supplied Swig `authorization` remain
required.

## Status reports every operation

`operations` is grouped by chain, with every item inside:

`ChainOperation` is replaced by `IntentOperationGroup` and the
`IntentOperationItem` union (`IntentOnchainOperation` | `IntentExecutionOperation`).

```ts
// Before
status.operations // [{ chain: 8453, status: 'COMPLETED', txHash, timestamp }]

// After
status.operations // [{ chainId: 'eip155:8453', items: [
                  //     { type: 'CLAIM', status: 'COMPLETED', transaction, debitsAccount: true },
                  //     { type: 'FILL',  status: 'COMPLETED', transaction },
                  //   ] }]
```

A chain carrying both a claim and a fill now reports both, and the item that
debited the account is marked.

Transaction references are tagged by the VM that produced them, so interpret
them by `vm` rather than assuming an EVM hash:

```ts
{ vm: 'evm', chainId, txHash }
{ vm: 'svm', chainId, signature }   // base58, case-sensitive
{ vm: 'tvm', chainId, txId }
{ vm: 'stellar', chainId, txHash }
{ vm: 'unknown', chainId: number, id }
```

Other changes:

- `accountAddress` is gone. The fabricated zero address it used to carry when
  the record identified no account was never a fact. `status.accounts` lists the
  real per-VM, per-chain accounts and is **absent** when the record does not
  identify them.
- The top-level `hyperCore` result is gone. A HyperCore outcome is an
  `{ type: 'EXECUTION', status, result }` item inside `operations`, alongside —
  not instead of — the settlement transaction it rides with. All six outcomes
  (`pending`, `accepted`, `refused`, `error`, `unknown`, `partial`) are
  preserved, and `partial` still means "check the account before retrying".
- `refunds` entries are `{ transaction }` rather than `{ chain, txHash }`. An
  empty array means none were observed, which is still not proof none occurred.
- `purpose` is `'execution' | 'deployment'`: a Swig creation reads back as a
  `deployment`. Handle both if you switch on it exhaustively.

### Opting into full detail

```ts
const status = await sdk.getIntentStatus(intentId, { full: true })
status.details // nonce, recipient, legs, executions, deployments, economics
```

Off by default, so polling stays lean; `waitForExecution` is unchanged. Details
are what happened, not what was quoted, and a field is **absent** when the
record does not hold it — Solana-origin intents recorded before their
instructions were persisted have no source `executions`, and that absence is not
reconstructed from a fresh quote.

## Sponsorship approval is requested at quote time

In JWT mode, `getIntentExtensionToken` runs while a sponsored transaction is
prepared, before it is quoted, and never at submission. Submitting a prepared
transaction, including a restored one, never asks again. A denied or failing
callback rejects `prepareTransaction` (or `deploy('solana', …)`) with nothing
quoted and no unsponsored fallback. Calling prepare again is a new approval.

The orchestrator binds the grant by recomputing the approval input from the
quote request ([sponsorship approval](sponsorship-approval.md)).

- **The input changed.** It is the versioned
  `sdk-3.0.0-caucasus` input, the quote body itself; see
  [Approval input and policies](#approval-input-and-policies). A request
  outside its allowlist fails with `UnsupportedSponsorshipApprovalError` before
  the callback runs; use project-wide sponsorship for such a request.
- **Solana.** The input names the paying Swig as `account.svm`: its wallet,
  its authority and, for plain operations, its state account. A Swig creation
  also carries the installed root and the Swig id in `account.svm.initData`.
- **Restoring Solana artifacts.** A Solana transaction prepared by an earlier
  snapshot fails restore with `InvalidSolanaTransactionArtifactError`. Prepare
  it again.

## Persisted prepared transactions

`PreparedTransactionData` gains a `request` field carrying the versioned wire
request. Treat it as opaque and persist it with the rest of the object.

A payload prepared under an earlier wire version, by an earlier SDK
generation (including earlier `2026-09.caucasus` snapshots with the flat
transaction shape), or one missing `request`, fails with
`InvalidPreparedTransactionError` before signing or submission, and before its
transaction is read. There
is no runtime shim that converts an old artifact, and no automatic re-quote: the
migration action is to reconcile the original submission and prepare afresh,
deliberately.

## Errors

| New error | Raised when |
| --- | --- |
| `UnsupportedSigningRequestError` | the quote asks for a payload this SDK cannot produce (a WebAuthn challenge or a Solana spend on the EVM path). Raised before any account state is read. |
| `IncompleteIntentProofsError` | a proof vector is missing slots, which it names |
| `MismatchedIntentProofError` | a contribution belongs to another intent, another request set, another slot, or duplicates one already filled |
| `InvalidPreparedTransactionError` | a prepared transaction was built for an earlier wire version or SDK generation |
| `UnsupportedSponsorshipApprovalError` | intent-scoped sponsorship cannot bind the quote request exactly. Raised before `getIntentExtensionToken` runs. |
| `SolanaAuthorityChangeRefusedError` | the orchestrator refuses a Swig passkey add or remove against the Swig's current roles (`SWIG_AUTHORITY_CHANGE_REFUSED`). Carries `reason`, `swigAddress`, and `roleId`, `roleIds` or `permission` when sent. |

Existing error envelopes, codes, detail paths and trace ids are preserved,
including the specialized missing-Swig refusal — which now carries its chain as
a CAIP-2 string.

## Not in this release

- Creating the Swig inside the first spend, and automatic re-quote flows. A
  missing spending Swig still refuses with `SOLANA_ACCOUNT_NOT_CREATED`; create
  it first with `deploy('solana', solanaChain)`.
- New estimate or intent-list methods.
- WebAuthn signing requests outside a passkey-owned managed Solana origin, and
  cross-VM destination execution other than EVM `calls` after a Solana → EVM
  delivery. Both are representable on the wire but unsupported: a quote asking
  for one fails with an actionable error rather than being signed as something
  else. Existing EVM passkey validators are unaffected — they still produce
  ordinary account-encoded EIP-712 proofs.
