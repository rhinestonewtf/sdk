# Architecture

How the SDK is layered and how a transaction flows from an app call to an
onchain result. For the published API, see the generated [SDK
Reference](https://docs.rhinestone.dev); this doc is the internal map.

## System

```mermaid
graph TD
  App[Integrator app] --> SDK[api/sdk.ts · RhinestoneSDK]
  SDK --> Account[api/account.ts · RhinestoneAccount]
  Account --> Compose[api/compose.ts · composition root]

  Compose --> Intents[transactions/intents/]
  Compose --> UserOps[transactions/user-operations/]
  Compose --> Direct[api/direct-signing.ts]

  Intents --> Signing[signing/]
  UserOps --> Signing
  Direct --> Signing

  Intents --> Accounts[accounts/<br/>Safe · Kernel · Nexus · Startale · HCA · EOA]
  Accounts --> Modules[modules/<br/>validators · Smart Sessions]
  Intents --> Orch[clients/orchestrator/]
  UserOps --> Bundler[clients/bundler/ + paymaster/]
  Compose --> Rpc[clients/rpc/]

  Orch -->|HTTP| API[(Rhinestone Orchestrator API)]
```

## Layering

The rewrite is a pure core with an imperative shell. Dependencies flow one way,
enforced by `scripts/architecture/check.ts`:

- **`api/`** — the composition root and public facade. `sdk.ts` (`RhinestoneSDK`)
  and `account.ts` (`RhinestoneAccount`) are the entry points; `compose.ts`
  wires concrete clients into the workflows; `queries/` holds the small
  portfolio and app-fee reads. Only `api/` may import concrete clients.
- **`config/`** — public config types (`config/account.ts`) and resolution
  (`resolve.ts`) from the public config into the narrow invocation context the
  internals consume. Internals never take the aggregate `RhinestoneConfig`.
- **`chains/`, `calls/`** — the universally-importable base: chain catalog,
  CAIP-2, tokens, non-EVM descriptors, and call resolution.
- **`accounts/`** — account adapters (Safe, Kernel, Nexus, Startale, HCA, EOA).
  Each maps resolved config to that account's init data, module layout, and
  signature envelope. The registry selects the adapter by kind.
- **`modules/`** — module planning and validators (ECDSA, weighted Quorum
  Signer, ENS, WebAuthn, multi-factor, K1, social recovery), including the Smart
  Sessions subsystem (`modules/validators/smart-sessions/`).
- **`signing/`** — the signing pipeline: signing plans, signer invocation,
  protocol codecs (ERC-6492/7739), and intent-plan assembly.
- **`transactions/`** — an organizational namespace, not a shared protocol. The
  `intents/` and `user-operations/` workflows keep their own request models,
  preparation, submission, and status; they share account materialization, call
  resolution, signing, chain data, and narrow client ports through the
  subsystems above.
- **`clients/`** — ports and adapters for the orchestrator, RPC, bundler, and
  paymaster. Domain and workflow code imports only the stable `port.ts`,
  `types.ts`, `errors.ts`, and `public.ts` boundaries; concrete clients are
  injected at `api/compose.ts`.
- **`hypercore/`** — the Hyperliquid half of a HyperCore transaction.
  `resolve.ts` turns the declarative `hyperCore.openPerp` / `hyperCore.closePerp`
  on a transaction into the concrete action the orchestrator quotes against;
  `orders.ts` is the pure order arithmetic it calls, and `market.ts` the reads it
  needs. Those reads are the only place the SDK talks to a service other than
  Rhinestone's own; they take an injectable `fetch` (the `hyperliquid` SDK config
  block) rather than a composed client because nothing else in the SDK depends on
  them. `index.ts` publishes only the reads, at
  `@rhinestone/sdk/hypercore`.
- **`solana/`, `evm/`** — the VM-specific published barrels. `solana/`
  re-exports the Solana helpers, cluster descriptors and `Solana*` types;
  `evm/` the EVM init-data and wallet helpers, validator addresses and `Evm*`
  account types. The root `index.ts` keeps only VM-neutral surface.
- **`actions/`, `errors/`, `smart-sessions/`, `jwt-server/`** —
  published subpath surfaces. `actions/` are standalone builders; the rest are
  compatibility barrels re-exporting owning symbols, except `jwt-server/`, a
  separate server-side bounded context with optional `jose`/`express` peers.

## Cross-VM account boundary

The public account configuration is composite: EVM and Solana entries are
independent managed or address-only branches. `api/accounts.ts` validates and
shallow-freezes that outer boundary, then passes only a managed EVM branch into
the existing resolution and adapter stack. Receiver-only handles bypass account
resolution and expose only native address access. A managed Solana account
without managed EVM capabilities bypasses it too: `createSolanaAccountFacade`
returns a `SolanaStandaloneAccount`, typed with only what it supports (no
assembly, authorizations, owner signing or submission options). An address-only
EVM receiver may accompany that facade for address access and delivery defaults.

Managed Solana runs on two environment/endpoint pairs only: development with
`https://dev.v1.orchestrator.rhinestone.dev`, and production with
`https://v1.orchestrator.rhinestone.dev`. `api/accounts.ts` refuses any other
pair at creation, and the facade captures the pair and re-checks it on every
operation. Each environment derives EVM-paired Swigs under its own namespace
(`MANAGED_SWIG_NAMESPACES` in `accounts/solana/address.ts`: `dev-v1`, `prod-v1`),
a local mirror of that orchestrator's `SOLANA_SWIG_NAMESPACE` that must be kept
in step with it; the namespace is also bound into the execution metadata. The
SDK adds no per-environment refusals beyond that — whatever an environment
cannot serve yet, its orchestrator refuses. Its Swig must exist and carry the
configured owner as its authority on the target cluster before it can spend.
Every managed Solana
config names its state account explicitly with `swig: stateAddress`; adding,
removing, or replacing an EVM branch never selects another wallet. The SDK
derives the asset-holding wallet PDA from that state account. Plain transfers,
instructions, and cross-chain deliveries name `svm.swigAccount`, carry no
`account.evm`, bind sponsorship to the wallet, and persist no `accountType`.
The owner is an independent ECDSA key or passkey; either credential may also be
used by EVM, but each VM retains its own authorization protocol. A passkey is
named to the orchestrator by its SEC1-compressed P-256 key. Its assertion's
challenge and type are checked locally, but the orchestrator verifies the
signature. The SDK derives only PDA relationships offline with the small
`@noble/curves` and `@scure/base` primitives; it imports no Solana RPC or
transaction stack and does not verify the account onchain.

`deploy` names its VM first: `deploy('evm', chain, { sponsored, source })` runs
the EVM deployment — a sponsored intent deployment is source-free, and an
unsponsored one spends the same-chain `source.token` it then requires, as
intent-path `setup(chain, { source })` does — and `deploy('solana', solanaChain, { swigId })` creates the Swig
through a sponsored deployment intent (`transactions/intents/solana-deployment.ts`),
on both the standalone facade and a composite account with a managed Solana
entry. The standalone facade types `swigId` as required, because without managed
EVM the Swig is always independent. It always
sends the Solana-only shape — `svm.swigAccount` plus `initData: { authority, id }`
and no `account.evm` — with no source, a tokenless destination and
`sponsorship: { gas: true, bridgeFees: false, swapFees: false }`.
The id is computed for the Swig derived from the managed EVM account under the
environment's namespace, and otherwise must be the caller's saved id from
`createSolanaSwigId()`; an id that does not derive the configured Swig, a missing
ECDSA `publicKey`, and a changed environment or endpoint are refused before any
request. The root authority
comes only from the configured owner. The quoted `purpose: 'deployment'` route
must name exactly that Swig, wallet and authority on the requested cluster and
ask for no signatures or requirements; it is submitted with `proofs: []` and
awaited. An existing Swig (`ACCOUNT_ALREADY_DEPLOYED` naming the configured
`swig` on the requested cluster) resolves `true` without submitting; its root is not verified, since the
SDK has no Solana RPC. Execution paths refuse a
deployment route at `normalizeIntentQuote`, and public quotes stay execution-only.

A managed Solana origin accepts one same-chain SPL transfer with an explicit
recipient, one same-chain instruction execution, one Swig authority change, or
one cross-chain delivery to an EVM chain. `sponsored` is translated with the
same helper EVM uses and passed through for the orchestrator to decide on: it
serves the categories a Solana
route can bill and refuses the rest by name. A cross-chain delivery may spend
native SOL (`11111111111111111111111111111111`) exactly like an SPL mint:
pinned as the single source token and optionally capped, with the rent-exempt
reserve, the spendable amount and SOL fee collection owned by the orchestrator.
Same-chain native SOL is refused before quoting. Independent owner-signature
assembly and `signAuthorizations` are rejected in every direction; EVM calls,
and the EIP-7702 delegation they can need, only come with a delivery to an EVM
chain.
Address-only
Solana branches remain receiver-only. No transaction discovers its source: the
SDK spends exactly the `source` the caller names and never reads the chain
catalog to find one.

A Solana **destination** is delivery-only and funded from one explicit EVM
`source`. The
recipient resolves in order: an explicit `recipient`, the configured address-only
receiver, then the managed branch's explicitly supplied Swig wallet; delivery is refused
before quoting when none exists, and so are destination calls, instructions or
HyperCore actions.

A same-chain instruction execution runs caller-supplied Solana instructions out
of the account's own Swig wallet, so it is tokenless and names no recipient: the
payee is encoded inside the instructions. Instructions are accepted either wire-
shaped (base58 program and accounts, base64 data — what Jupiter
`/swap-instructions` returns) or as `@solana/web3.js` instruction objects, and
are normalized to the wire shape in `normalizeTransaction`, so a prepared
transaction stays JSON-round-trippable and its reconstruction compares the same
canonical intent input. Order, account metadata, signer flags and data bytes are
preserved verbatim. The published request limits (32 instructions, 64 accounts
each, 1232 bytes of data in total, 8 address lookup tables) are mirrored locally
so an oversized request fails before a round trip. The request carries
`destination.execution.instructions`, and `addressLookupTables` only when
non-empty. A gas-sponsored execution sends no `source`; an unsponsored one
names the token its charge is paid in (an SPL mint or native SOL) as
`source.token`. The orchestrator serves them on
its Solana same-chain route (`SAME_CHAIN`); every other route refuses them with
`UNSUPPORTED_DESTINATION_INSTRUCTIONS`, which the SDK surfaces unchanged.

A **Swig authority change** adds a passkey or secp256k1 key to the account's
Swig, or removes one, through the ordinary prepare → sign → submit → wait
lifecycle: `{ destination: { chain, authority: addPasskey(passkey, { permission }) } }`,
`addEcdsaKey(key, { permission })`, `removePasskey(passkey)` or
`removeEcdsaKey(key)` (`actions/solana.ts`). `permission` is `all`,
`allButManageAuthority` or `manageAuthority` for either kind. It has its own field rather
than riding `instructions`. The Swig authenticates the add or remove with its
own separately signed payload, and the orchestrator seals the slot, the
counter and the one-off payer, so a caller-written instruction couldn't express
it. The builders compress any P-256 encoding (`accounts/solana/passkey.ts`) or
secp256k1 encoding (`accounts/solana/keys.ts`, which also checks an uncompressed
secp256k1 key is on the curve and refuses a 20-byte address), and
`normalizeTransaction` canonicalizes a literal the same way. The persisted
transaction, the request, the intent input and the execution metadata
(`kind: 'solana-authority'`, with `action`, `keyType`, `key` and, on an add,
`permission`) name one lowercase compressed key of one kind: `passkey` maps to
`secp256r1` and `ecdsa` to `secp256k1` on the wire.

The request is Solana-only: `svm.swigAccount` with no `evm` and no `initData`,
even on a composite account, and
`destination.execution: { authority: { action, key: { kind: 'secp256r1' | 'secp256k1', publicKey }, permission? } }`.
It names no source, token or recipient, and it's always sent with
`sponsorship: { gas: true, bridgeFees: false, swapFees: false }`, spelled out
as a Swig creation spells it. There's no `sponsored` knob and fees are refused.
The acting authority is always the configured owner, ECDSA or passkey. The SDK
never picks another role, and leaves refusing self-removal or re-adding a
present key to the orchestrator. Every quoted route must be a `SAME_CHAIN`
route that moves nothing, with one `manageAuthority` signing request whose
scope and plan disclose exactly the requested change, curve included; a spend
scope on an authority quote is refused, and so is the reverse. Rebuilding from
the persisted `transaction` refuses a tampered key, key kind, permission or
action before signing and before submission.

The orchestrator refuses a change the Swig as read doesn't allow with
`SWIG_AUTHORITY_CHANGE_REFUSED`, typed as `SolanaAuthorityChangeRefusedError`.
Nothing retries automatically. `getAuthorityStatus` reads that refusal for the
caller: it runs the same prepare path, discards the quote, and maps
`authority_exists` with the same permission (or `authority_not_found` on a
remove) to `applied`, `authority_exists` with another or no permission to
`conflict`, and a successful quote to `notApplied`. It never signs or submits,
and rethrows every other error.

Configuring the same `swig` with an added passkey as owner derives the same
wallet, and its transfers, deliveries and instructions name that key in
`authorization`. The orchestrator selects the one role carrying it, which must
hold `All` or `AllButManageAuthority`; a manage-only owner's spends are refused
as `UNSUPPORTED_ACCOUNT_TYPE`, though it can still change authorities.
Configuration grants nothing: an owner
that is not on the Swig is refused as `UNSUPPORTED_ACCOUNT_TYPE`, and
`deploy('solana', …)` still resolves `true` on an existing Swig without
checking which role the owner holds.
The destination hosts no account runtime, so preparation runs the ordinary EVM
cross-chain path with the account hosted on `source.chain`. The
destination authorization is its own signing request; where its payload,
account and authority match an earlier slot exactly, the same bytes satisfy
both — but it stays a distinct slot with its own proof. Whether the destination wallet
and its token account exist is an operator prerequisite — the SDK does not probe
it, and a settlement layer can refuse a route that would have to create one.
Where the delivering provider names the destination chain differently from us,
that id is published on `quote.bridgeFill` as an opaque passthrough for the
provider's status API; it never enters CAIP-2 formatting or chain comparisons.

A Solana **origin** can also fund a delivery on an EVM chain. The source cluster
(`source.chain`) and the SPL mint or native SOL to spend (`source.token`) are
both named explicitly — the route spends exactly one source token, sent as
`source: { vm: 'svm', chainId, token }`.

A Solana-origin transfer — the delivery, or a same-chain SPL transfer — can cap
what the wallet debits with `source.maxAmount`, the same ceiling an EVM source
takes. It is distinct from the destination amount: with one the route is
exact-out and must fit under the cap, without one it spends up to the cap. The
cap is sent as `source.maxAmount` and bound verbatim in the approval input.
Every
quote whose `cost.input` exceeds the cap is refused at prepare and again on
reconstruction, so before signing and submission. That check trusts the quote's
accounting; the orchestrator enforces the limit authoritatively. Instruction
executions take no `source.maxAmount`: the orchestrator refuses source limits
with destination instructions. The cap is not repeated in the execution metadata;
rebuilding `request` and `intentInput` from `transaction` covers it. The delivery recipient is an explicit
EVM address or the configured managed EVM/receiver address, resolved before the
quote so the authorization binds to it; an account with no EVM entry has no
default, so its delivery without a recipient is refused before quoting, in its
type and at runtime. Authorization stays the Solana model: without
destination calls, exactly one signing request — `personalSign` for an ECDSA
owner, `webauthn` for a passkey —
disclosing the Swig wallet and state account it spends from, and the same
slot-bounded window, so a second prepared-but-unsubmitted spend invalidates the
first. The quoted cost legs stay in their own namespaces — a Solana chain and
base58 mint on the input, an `eip155:` chain and hex token on the output. The
settlement layer is whatever the orchestrator picked; the SDK only requires that
it is not same-chain.

A delivery can carry `calls` only when the configured managed EVM account and
explicit Swig match the backend's existing EVM-derived pair. The comparison is
a capability check, never wallet selection; an unrelated pair is refused before
lazy calls, setup reads, quoting, or signing and remains usable for plain
delivery. Address-only EVM receivers cannot execute calls. Compatible calls are
resolved against the managed EVM account before the quote, whose entry carries
setup ops and any EIP-7702 delegation. The request names no recipient because
the executing account receives the delivery, so an explicit `recipient` with
calls is refused.
The quote asks for the Swig spend first, then the EVM account's EIP-712
authorization of the calls on the delivery chain, then any delegation there.
Those EVM requests are signed first through the ordinary EVM signing path,
because the spend's slot window is the one that runs out, and the proofs go out
in request order. A replay rebuilds the resolved calls and account setup from
the persisted `intentInput` instead of resolving them again, and compares the
rebuilt wire request with the exact persisted request before any signature.

## Transaction input

An intent transaction names one `destination` and at most one `source`:
`{ source?: { chain?, token, maxAmount?, auxiliaryFunds?, calls? }, destination: { chain, token?, amount?, recipient?, calls?, … } }`.
`api/transaction-input.ts` validates it before anything is resolved or quoted
and returns a frozen canonical copy, which is what `PreparedTransactionData`
persists:

- An omitted `source.chain` becomes `destination.chain`. That is the only
  inference: no chain or token is ever discovered, and a cross-chain
  transaction names its source chain.
- `destination.token` with `amount` is exact output, `token` alone is max
  output, and neither is an execution that delivers nothing. `amount` without
  `token` is refused.
- A delivery needs a `source`, and so does any execution that is not
  gas-sponsored. Only a gas-sponsored execution that delivers nothing, on a
  destination that hosts the account (an EVM chain, or a Solana instruction
  execution or authority change), may omit it; the orchestrator decides what
  it covers and nothing falls back to self-funding.
- `source.calls` run on the source chain before the claim, and any `provides`
  names `source.token`, adding to `source.auxiliaryFunds`. Enabling a smart
  session puts its pre-claim call first on the same source, so a source-free
  transaction whose session still needs enabling is refused before quoting.
- The flat fields of the earlier shape (`chain`, `targetChain`,
  `sourceChains`, `sourceAssets`, `tokenRequests`, …) are refused by name,
  with what replaced each, and so is any unknown key.

Routing is decided once from the canonical copy: an SVM `source` (or a
source-free SVM destination) runs through the managed Solana account, and
everything else through the EVM intent pipeline. The request carries the
singular Caucasus body — `source { vm, chainId, token, maxAmount?,
auxiliaryFunds?, execution? }` and `destination { vm, chainId, token?, amount?,
recipient?, execution? }` — and never the legacy `tokenRequests`, selectors or
chain-keyed maps. A prepared artifact is versioned (`caucasus-singular-1`);
every restore path checks that version before it reads the persisted
transaction, so an artifact from an earlier SDK generation fails with
`InvalidPreparedTransactionError` instead of being reinterpreted.

## Execution paths

The account exposes two ways to execute, both ending at `waitForExecution`.

### Intent path (chain-abstracted)

The default path. The orchestrator quotes, routes, and settles across chains via
the relayer market; the SDK signs and submits.

1. `prepareTransaction(tx)` — SDK requests a quote from the orchestrator and
   returns `PreparedTransactionData`.
2. `getTransactionMessages(...)` — returns the quote's **ordered** signing
   requests. Each names the account, the authority, the scope it authorizes and
   the payload to sign: EIP-712 for EVM authorizations, one `personalSign`
   message (a `webauthn` challenge for a passkey owner) with a short slot
   deadline for a managed Solana origin, an EIP-7702
   authorization tuple for a requested delegation. Position is the identity of
   an authorization — two requests can carry the same payload and still be two
   distinct slots.
3. `signTransaction(...)` — returns one proof per signing request, in that order,
   including any EIP-7702 delegation the quote asked for. EVM multisig owners
   can instead call `signTransaction(prepared, { owner })` independently and
   combine their contributions with `assembleTransaction(...)`, optionally
   folding in externally collected `proofs`; managed Solana does not support
   this path.
4. `submitTransaction(...)` — posts the intent id and the complete proof vector;
   returns a `TransactionResult` (an intent id). It acquires no signatures and
   reads no mutable nonce state.
5. `waitForExecution(result)` — polls the orchestrator until the intent reaches
   a terminal state; throws `IntentFailedError` on failure. Status groups every
   operation by the chain it ran on, so a chain carrying both a claim and a fill
   reports both. `getIntentStatus(id, { full: true })` additionally returns the
   recorded detail block; polling stays lean by default.

Weighted Quorum Signer accounts collapse multi-origin intent signing into one
chain-agnostic EIP-712 `WeightedMerkleRoot` signature. Each origin receives an
account-bound Merkle proof, so the owner quorum signs once while every chain
still receives a distinct validator envelope.

Headless ERC-1271 integrations can import the same primitives from
`@rhinestone/sdk/signing/quorum`: derive the account-bound digest, build a
Merkle signing tree, derive its EIP-712 root hash, pack weighted owner
signatures, and finally encode either a regular or proof-bearing validator
signature.

## Orchestrator trust boundary

The SDK structurally validates managed Solana quotes, their signing payloads,
and persisted execution metadata before signing or submission. It narrows every
signing request at the wire boundary: an authority, scope or payload kind it does
not recognise is refused rather than signed as a familiar one. That includes
the Solana scope action (`spend` or `manageAuthority`).

Transaction references are tagged with the VM that produced them, so an EVM hash,
a Solana signature and a Tron id are distinguishable rather than all being read
as `txHash`. Intents recorded before the chain registry knew a chain keep a
numeric `chainId` and a `vm: 'unknown'` reference — an honest gap, not a chain
identity to invent.

The sponsorship approval input (`PreparedTransactionData.intentInput`) is the
quote body itself under a versioned contract,
`sdk-caucasus-singular-2026-09-v1`: `clients/orchestrator/sponsorship-approval.ts`
projects it from the request the builder produced, so the two cannot drift.

A JWT intent-scoped sponsorship grant is requested when a sponsored quote is
prepared, never at submission. Before `getIntentExtensionToken` runs,
`clients/orchestrator/client.ts` validates the body it is about to send
against the contract's allowlist and checks the approval input is exactly
what `sponsorship-approval.ts` derives from it. That
derivation is the contract the orchestrator recomputes to bind the grant
([sponsorship approval](sponsorship-approval.md)). A request it cannot bind
fails with `UnsupportedSponsorshipApprovalError` before anything is asked or
quoted.

The Solana personal-sign digest is an opaque orchestrator commitment. The SDK
cannot reconstruct or independently prove the recipient or instructions hidden
behind it; its local checks establish consistency with the prepared request and
captured account metadata, not the contents of unseen instructions.

```mermaid
sequenceDiagram
  participant App
  participant Account as RhinestoneAccount
  participant Orch as Orchestrator API
  App->>Account: prepareTransaction(tx)
  opt sponsored, JWT with getIntentExtensionToken
    Account->>App: getIntentExtensionToken(intentInput)
  end
  Account->>Orch: quote (+ X-Intent-Extension)
  Orch-->>Account: PreparedTransactionData
  App->>Account: signTransaction(...)
  App->>Account: submitTransaction(...)
  Account->>Orch: submit signed intent
  Orch-->>Account: intent id
  App->>Account: waitForExecution(result)
  Account->>Orch: poll status (until terminal)
```

### User-operation path

ERC-4337 path for direct bundler execution:
`prepareUserOperation` → `signUserOperation` → `submitUserOperation`, or
`sendUserOperation` to do all three in one call. Returns a UserOp hash;
`waitForExecution` resolves the receipt.

This is also the only path that accepts `signers: { type: 'guardians' }`. The
social recovery validator reverts on ERC-1271 and never validates intents, so
`api/signer-selection.ts` rejects guardians everywhere else. Selecting it
switches the validator used to derive the UserOp nonce key, which is how the
account routes verification to the recovery module instead of the owner. It
authorizes a single `execute` per UserOperation, so the calls from
`actions/recovery` must be submitted one at a time.

## External integrations

| System                  | Purpose                                   | Interface                    |
| ----------------------- | ----------------------------------------- | ---------------------------- |
| Rhinestone Orchestrator | Intent quoting, routing, status           | HTTP (`clients/orchestrator/`) |
| Relayer market          | Cross-chain settlement (Across/Relay/Eco) | via orchestrator             |
| Bundler / paymaster / RPC | ERC-4337 preparation and submission     | `clients/bundler/`, `clients/paymaster/`, `clients/rpc/` (viem peer) |
| JWT backend             | Mints short-lived auth tokens (JWT mode)  | `jwt-server/`                |
| Hyperliquid `info`      | Perp market metadata and open positions   | HTTP (`hypercore/market.ts`) |

`prepareTransaction` is the one execution path that reaches Hyperliquid, and
only when the transaction carries a `hyperCore` option that needs resolving. It
happens before the quote because the quote's signing requests register an agent
derived from the action's bytes, so the action cannot be completed afterwards.
