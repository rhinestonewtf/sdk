# @rhinestone/sdk

## 3.2.0

### Minor Changes

- 6e1079e: Make quote-plan and full-read executions match their `PlanExecution` type at runtime.

  - Each `quote.plan` leg's `execution` now carries the `vm` and `chainId` its type always declared, copied from the leg, so `execution.vm` checks now match.
  - `calls[].value`, including HyperCore `settlement.calls[].value`, is a `bigint` in quote plans and in `getIntentStatus(id, { full: true })` executions instead of a decimal string. Update code that compares it with a string.
  - HyperCore `settlement` is now optional: it is absent when you send no HyperEVM calls.
  - A full read's `details.executions.destination` is now `PlanExecution | null`: it is `null` when the record holds no destination execution.

### Patch Changes

- 5eb022e: Fix smart-session intents without own-account destination calls requiring a destination grant: the destination authorization reuses the origin proof again, and a single source grant also signs destination-chain payloads such as ACROSS target execution. Own-account destination calls still require the destination chain's grant.

## 3.1.0

### Minor Changes

- 83952db: A `crossChainPermits` entry with several `from` or `to` tokens now uses each IntentExecutor layer for the tokens it moves. `from: [USDC, WETH]` to `[USDC, WETH]` settles over ACROSS for both and over CCTP (and LZ with `oneTimeUse`) for USDC, in one session. Each layer's call stays pinned to its one token and the permit's recipients, and a token is approved only to the layers that move it. A layer is no longer refused or dropped because the permit also names a token it does not move; an explicit `settlementLayers` list still refuses a token none of its layers moves.

  Under `settlementLayers: 'all'` (the default), a permit whose layers were dropped only for such a token now keeps them, so its session's actions and `permissionId` change and an enabled session must be enabled again.

  A chain's `maxAmount` counts in the units of the token it is set on, so an IntentExecutor layer is kept only for that token: under `'all'` a layer moving another token is dropped, and an explicit list refuses it with `CAP_TOKEN_MISMATCH`. ACROSS still applies the chain's one cap to each `from` token, as before. Under `'all'`, when both OFT and LZ could settle, the session keeps neither and lists both in `settlementCoverage.dropped`; an explicit list naming both is still refused. An explicit list naming LZ now refuses a `to` leg on a chain LZ does not reach.

  A layer also takes only the `to` legs it delivers: a leg on a chain the layer does not serve, or one with a `to.minAmount`, no longer drops the layer for the legs it can settle. A floored leg must be delivered by a layer that enforces its floor (OFT, ECO_IE, LZ's Stargate send); an explicit list refuses a leg none of its layers delivers (`TOKEN_NOT_ROUTED`, or `LAYER_NOT_SERVED` when none routes to that chain).

  A `to` leg a layer cannot pin on its own (no route or shared Eco prover to its chain, a recipient the layer cannot pin, a floor it cannot express) is left to the other layers instead of dropping the layer, and ECO_IE weighs only the caps of the `from` tokens it moves. An explicit list still refuses such a leg when none of its layers pins it, with that layer's own refusal.

  Two `to` legs that reach the same destination for the same recipient (an open recipient matches any) with different `to.minAmount`s are refused with `CONFLICTING_LEG_FLOORS` for the whole permit, as every flooring layer already refused them. Legs reach the same destination when they share a chain and token, or a CCTP domain or LayerZero endpoint id that a layer pins, as a testnet shares its mainnet's CCTP domain. `maxFeeBps` still requires ECO_IE to settle every `to` leg.

  A `to.minAmount` is checked against the caps that fund it: every capped `from` leg a one-token route (OFT, LZ, or ECO_IE between two of one stablecoin) carries to it must hold it within half of to all of its cap, and at least one capped leg any route carries must. Each layer also leaves out a floored leg that the cap funding its own call cannot fund, so ECO_IE never pins a floor far under its reward. A USDC leg floored at 95 beside a USDT0 leg floored at 900 builds with USDC capped at 100 and USDT0 at 1000; a floor above its own token's cap is still refused with `MIN_AMOUNT_OUTSIDE_CAP`.

- 8a955b3: Allow `LZ` and `OFT` on reusable sessions with a native-fee budget. A `crossChainPermits` `from` leg takes `maxNativeFee`: the most native value, in wei of that chain's native token, that the session may send with the layer's call to pay LayerZero messaging fees, as a lifetime total. It installs a `ValueLimitPolicy` on the `LZMultiCall.execute` or `OFTAdapter.send` action, which counts each call's `msg.value`. Without `oneTimeUse`, these layers need both `maxNativeFee` and `maxAmount` on the chain's `from` leg and are refused without either (`LAYER_REQUIRES_ONE_TIME_USE`, as before; `'all'` drops them): the budget bounds the fees, and the cap stops the key from sending the whole balance back and forth. With `oneTimeUse`, `maxNativeFee` is optional and caps that one settlement.

  `maxNativeFee` counts the native each call sends, not what is spent after refunds: an overpaid send that is refunded still uses the budget, so later sends can be refused. The session key can also spend the whole budget as real LayerZero fees on sends of 1 token unit, so size it as the most you accept to lose to fees.

  In a permit with several `from` tokens, `maxNativeFee` is a budget for the chain, set on at most one leg, and goes on the fee-paying layer the session keeps: LZ for its USDC or OFT for its USDT0, each kept, when `maxAmount` is set, only for the token it is set on. Under `settlementLayers: 'all'`, a permit with `maxNativeFee` where both OFT and LZ could settle, or where no fee-paying layer is kept, is refused with `MAX_NATIVE_FEE_NOT_APPLICABLE` rather than built without the layer the budget was set for. LZ's shared pull counter counts in the units of the token `maxAmount` is set on, which is the token LZ is kept for.

  On a reusable session, every LZ route counts its pull on one `maxAmount` counter. An LZ permit with `maxAmount` whose `to` legs need batches of different shapes is refused (`LZ_REUSABLE_ROUTES_SPLIT`); give those legs separate sessions (a session holds one such permit), or set `oneTimeUse`. The CCTP relay-fee ceiling (at most 1 USDC) becomes a lifetime total on a reusable session, about 10 sends into Ethereum or 70 into Arbitrum; after that the fee route is refused. A session with `maxNativeFee` and without `oneTimeUse` is a lifetime budget (`lifetimeBudget: true`), so `getSessionDetails` refuses to sign its enable again while it is enabled.

  `maxAmount` does not count allowances the account already holds that the session did not grant. Each layer that pulls the token counts its own pulls against `maxAmount`, so with such an allowance a permit naming several of them can move up to `maxAmount` times their number, on a reusable session over its life. The recipients stay pinned. Revoke those allowances for the token before relying on `maxAmount` as the total.

  New refusal codes: `MAX_NATIVE_FEE_NOT_POSITIVE`, `MAX_NATIVE_FEE_NOT_APPLICABLE`, `MULTIPLE_MAX_NATIVE_FEES`, `LZ_REUSABLE_ROUTES_SPLIT`. Sessions that do not set `maxNativeFee` compile as before, with the same permissionIds. The `LAYER_REQUIRES_ONE_TIME_USE` message now names `maxNativeFee` and `maxAmount`.

### Patch Changes

- 6a134c1: Fix external-recipient routes requiring destination authorization to use the explicitly supplied destination Smart Session grant, refusing missing or incompatible grants before signing.

## 3.0.1

### Patch Changes

- b71a00e: Fix cross-chain smart-session intents with own-account destination calls failing destination simulation: the destination authorization is now signed with the destination chain's session instead of reusing the source chain's envelope.

## 3.0.0

### Major Changes

- 2166816: Speak orchestrator API version `2026-09.caucasus`. Accounts, recipients, sources and destinations are now expressed in their own VM's terms, a quote states the authorizations it needs as an ordered list, and status reports every operation rather than one per chain. There is no compatibility mode: a prepared or signed transaction produced by an earlier release cannot be signed or submitted by this one, and refuses explicitly rather than being reinterpreted. Reconcile any in-flight submission first, then prepare it again.

  Transaction inputs move to one `source` and one `destination` (see the singular source and destination entry). Everything the orchestrator hands back changed too.

  ### Signing is an ordered list, not a set of roles

  `quote.signData` is replaced by `quote.signingRequests` — an ordered array. Each entry says which account it authorizes for, which authority must produce it, what it permits, how long it stays valid, and the payload to sign. `signTransaction` returns `proofs`, one per request, in the same order; `submitTransaction` sends exactly that.

  Position is the identity of an authorization. Two requests can carry byte-identical payloads and still be two slots, so proofs are never filtered, sorted, deduplicated or inferred from their kind.

  - `getTransactionMessages(prepared)` now returns `SigningRequest[]` instead of `{ origin, destination?, targetExecution? }`.
  - `SignedTransactionData.originSignatures` / `destinationSignature` / `targetExecutionSignature` are replaced by `proofs: SigningProof[]`.
  - `signIntent(signingRequests, targetChain, signers?)` takes the ordered requests and returns `{ proofs }`.
  - Independent owner signatures (`OwnerSignature`, `OwnerSignatureData`) carry `slots` instead of `origin`.
  - A smart-session origin still yields **one** proof containing both `preClaim` and `notarizedClaim`; it is never split across two slots.
  - Removed: `SignData`, `OriginSignData`, `Eip712OriginSignData`, `PersonalSignOriginSignData`, `OriginSignature`. New: `SigningRequest`, `SigningProof` and the types they are built from.

  ### EIP-7702 delegations are signed automatically

  A quote asks for the delegations it needs as `delegationAuthorization` requests, and `signTransaction` produces them as part of the proof vector. Normal consumers no longer call anything extra, and `submitTransaction` no longer accepts an `authorizations` option.

  `signAuthorizations(prepared)` remains for the advanced case where a different party signs the delegation. It now returns `IndexedProofContribution[]` — each bound to the intent, the exact ordered request set, and the slot it answers — which `assembleTransaction(prepared, ownerSignatures, { proofs })` folds in. A contribution from a different quote, a re-quote, or the wrong slot is refused, and an incomplete vector throws instead of submitting.

  ### Chains are CAIP-2

  Quote costs, plans, requirements, signing context, bridge fills and status evidence carry CAIP-2 strings (`eip155:8453`, `solana:…`, `hypercore:perp`) rather than numbers, so a chain the SDK has no number for stays readable. Numeric chain ids remain in viem chain objects, `TransactionResult`, and inside signed EIP-712 and EIP-7702 payloads.

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

  ### Prepared transactions carry their request

  `PreparedTransactionData` gains a `request` field carrying the versioned wire request; treat it as opaque and persist it with the rest. The sponsorship approval input changed; see the singular source and destination entry.

  ### Not in this release

  Creating the Swig inside the first spend and automatic re-quote flows are still unavailable; a missing spending Swig still refuses with `SOLANA_ACCOUNT_NOT_CREATED`, so create it first with `deploy('solana', chain)`. There are no new estimate or intent-list methods. WebAuthn signing requests outside a passkey-owned Solana account, and cross-VM destination execution other than EVM calls after a Solana → EVM delivery, are represented on the wire but not supported — a quote asking for one fails with an actionable error rather than being signed as something else.

  See [docs/caucasus-migration.md](https://github.com/rhinestonewtf/sdk/blob/main/docs/caucasus-migration.md) for the type-by-type inventory.

- aeabb0d: Replace the flat EVM account API with a capability-aware cross-VM account foundation.

  - Wrap existing EVM configuration in `createAccount({ evm: config })` and select addresses with `account.getAddress('evm')`.
  - Configure address-only Solana destinations with `{ solana: { address: solanaAddress(value) } }`; use a managed Solana account for Solana-origin execution.
  - Restrict explicit delivery recipients to token delivery. Omit `destination.recipient` when destination calls should execute through the invoking managed EVM account.

- 5750254: Change `SigningScope.hyperCore` on EVM signing requests from a single HyperCore agent registration to a non-empty list of `{ action, nonce, agent, slot }` in slot order: one on a per-leg request, every registration on an aggregate request. Read `scope.hyperCore[0]` where you read `scope.hyperCore` before, or iterate the list.
- 5d71fb7: Require every managed Solana account to name its existing Swig state account explicitly; the SDK derives its wallet PDA.

  Managed Solana wallets can now be used alone, with an address-only EVM receiver, or with an independently configured managed EVM account. Plain Solana operations always use the selected Swig and its private-key or passkey authority; their sponsorship identity is the derived Swig wallet rather than an unused EVM account. Solana-to-EVM destination calls remain limited to explicit Swigs compatible with the managed EVM account; unrelated pairs can still make plain deliveries.

- 1ae3e1b: Add managed Solana accounts and same-chain SPL intent execution.

  - Pair an ECDSA-owned Solana branch with a managed EVM account to derive its Swig wallet.
  - Prepare, sign, and submit one same-chain SPL transfer on Solana mainnet or devnet with tagged `personalSign` payloads.
  - Expose Solana execution metadata, native transaction references, lifecycle errors, and the `solanaDevnet` descriptor.
  - Make destination signing data and signatures optional for routes that do not require them.

- a56e0ec: Make `IntentAccountView.authority` optional for Swig account summaries because historical intent records may not contain authority evidence. Guard `authority` before discriminating its `secp256k1` or `secp256r1` kind; signing requests and caller-supplied authorization remain required.

  Remove the obsolete `sponsored.swapValue` option. Use `sponsored.swaps` for swap sponsorship; eligible par-swap value sponsorship is now controlled by the orchestrator under that category.

- 7191872: `/jwt-server`'s `shouldSponsor` and `SponsorshipFilter` no longer accept `sdk-caucasus-singular-2026-09-v1`, the interim approval input of earlier v3 snapshots. They refuse it like any other unknown `contractVersion`, and the orchestrator no longer binds grants under it. Upgrade clients still on an earlier v3 snapshot, and update any sponsorship policy or signer that matches on `sdk-caucasus-singular-2026-09-v1` to match `sdk-3.0.0-caucasus`.
- 627e338: Remove deprecated inputs and apply stricter Smart Session defaults.

  - Replace top-level SDK `apiKey` with `auth: { mode: 'apiKey', apiKey }`. Empty or undefined removed keys also reject; nested API-key/JWT auth and service credentials remain supported.
  - Replace `SolanaPasskeyPermission` with `SolanaAuthorityPermission` from `@rhinestone/sdk/solana`.
  - Replace definition-input `claimPolicies` with standard `crossChainPermits`. Arbitrary custom-spender definitions are no longer supported. Preserve compiled `Session.claimPolicies` when restoring authorized sessions; do not rebuild persisted grants through definition resolution.
  - Omitted or empty settlement layers now select all enforceable served layers; inspect dropped coverage. Explicit lists must be fully enforceable. Open fallback is opt-in and retains its ACROSS default.
  - Permit2 permits default to scoped actions. Reusable scoped `maxAmount` is a lifetime budget on counted approval/value paths, not existing allowances or arbitrary actions. Re-enabling an already-enabled budgeted session requires `allowBudgetReset: true`.
  - Action windows and default deployed policies can change permissionId and enable digests. Persist resolved sessions; new definitions do not upgrade installed grants. Once sessions allow at most one settlement transaction per participating chain, not one operation.

- be6e9bb: Replace the flat transaction input with one `source` and one `destination`: `{ source?: { chain?, token, maxAmount?, auxiliaryFunds?, calls? }, destination: { chain, token?, amount?, recipient?, calls?, gasLimit?, … } }`. The SDK spends exactly the source you name and no longer discovers source chains or tokens.

  - `chain`, `targetChain`, `sourceChains`, `sourceAssets`, `tokenRequests`, `recipient`, `calls`, `gasLimit`, `sourceCalls`, `auxiliaryFunds`, `hyperCore`, `instructions`, `addressLookupTables` and `authority` are refused by name, pointing at their replacement. Omit `source.chain` to spend on the destination chain; a cross-chain transaction names it.
  - `destination.token` with `amount` is exact output, `token` alone is max output, and neither delivers nothing. A delivery needs a `source`, and so does any execution that is not gas-sponsored; only a gas-sponsored execution that delivers nothing may omit it.
  - Several source chains or tokens, and several delivered tokens, have no equivalent. `source.calls` run on the source chain and a call's `provides` must name `source.token`; source calls that were silently dropped now run or are refused.
  - A source-free transaction whose smart session still needs enabling is refused before quoting; name a `source`. `customDeadline` on a cross-chain transaction, and `hyperCore` on a destination that is not HyperCore, are refused instead of dropped.
  - An unsponsored intent-path `deploy('evm', chain, { source: { token } })` and intent-path `setup(chain, { source: { token } })` pay in a named same-chain token and refuse without one. Sponsored deployment is unchanged.
  - Solana authority changes are `{ destination: { chain, authority } }`, including for `getAuthorityStatus`. Instruction executions are source-free when sponsored and name their fee token as `source.token` otherwise.
  - `PreparedTransactionData.intentInput` and the `getIntentExtensionToken` argument are the versioned `sdk-3.0.0-caucasus` approval input: the quote request itself, with CAIP-2 chain ids. Review sponsorship policies that read the old field names. `/jwt-server`'s `shouldSponsor` reads both the new input and the one older SDKs send.
  - Prepared transactions from earlier SDK generations fail with `InvalidPreparedTransactionError`; reconcile, then prepare again.
  - Remove `TokenRequest`, `NonEvmTokenRequest`, `NonEvmTokenRequests`, `AuxiliaryFunds` and `SolanaSourceAsset`. Add `TransactionSource`, `TransactionDestination`, `EvmDeployOptions`, `EvmSetupOptions` and `SolanaTransactionSource`.

- bfa2ff4: Name the source of a Solana-origin transaction with `source`, as on EVM, and cap what the Swig wallet may debit. Managed Solana now also runs on production.

  - A Solana → EVM delivery takes `source: { chain, token, maxAmount? }` instead of `sourceTokens: [{ address }]`. A leftover `sourceTokens` is refused with a pointer to `source.token`.
  - `maxAmount` is a ceiling on the source debit, not the delivered amount. With a destination amount the route must fit under it; without one it spends the smaller of the balance and the ceiling. A quote whose source input exceeds it is refused before signing. Omit it for no cap.
  - A same-chain SPL transfer takes the same `source`, naming the mint it sends, with a `maxAmount` no smaller than the amount sent. Instruction executions take no `maxAmount`.
  - Managed Solana accounts are accepted on production with the default endpoint (`https://v1.orchestrator.rhinestone.dev`) as well as on development with `https://dev.v1.orchestrator.rhinestone.dev`; any other environment/endpoint pair throws `ManagedSolanaAccountNotSupportedError`. Both environments support the same operations. On production the Swig derived from a managed EVM account uses the `prod-v1` namespace, so it differs from the development Swig of the same EVM account, and execution metadata carries `namespace: 'prod-v1'`.

- 48be55a: `deploy` now names its VM first, and a managed Solana account can create its Swig with it.

  - Deploy an EVM account with `account.deploy('evm', chain, { sponsored })`. `account.deploy(chain, …)` no longer compiles.
  - Create a managed Solana account's Swig with `account.deploy('solana', solanaChain, { swigId })`: a sponsored deployment intent that installs the configured owner as the Swig's root and resolves `true` once the Swig exists, including when it already did. `swigId` is required without managed EVM; on a composite account the Swig derived from the EVM account needs none.
  - Add `createSolanaSwigId()`, which mints an independent Swig id with the Swig and wallet addresses it derives.
  - Widen `purpose` on intent statuses to `'execution' | 'deployment'`.

- 8101de5: Name the sponsorship approval input `contractVersion: 'sdk-3.0.0-caucasus'`. Earlier v3 snapshots sent `sdk-caucasus-singular-2026-09-v1`; the projection and digest rule are unchanged, so only the identifier, and therefore the digest, differs.

  - `/jwt-server`'s `shouldSponsor` and `SponsorshipFilter` accept `sdk-3.0.0-caucasus` and the legacy input of v2 clients. Any other `contractVersion` is still refused.
  - Deploy the updated helpers, or a signer that accepts `sdk-3.0.0-caucasus`, on your backend before your clients send the new identifier. Older helpers refuse it and the prepare fails.
  - `SerializedIntentInput['contractVersion']` is now `'sdk-3.0.0-caucasus'`.
  - A Solana transaction prepared under the interim identifier fails restore with `InvalidSolanaTransactionArtifactError`; prepare it again.

- 6249a56: Startale now defaults to v1.0.1, which deploys a new implementation and factory, changes the default counterfactual account address, and signs typed data against the v1.0.1 EIP-712 domain. Existing v1.0.0 accounts opt back in with `account: { type: 'startale', version: '1.0.0' }` to keep their address and domain — including accounts passed as address-only `initData`, whose typed-data signatures would otherwise target the v1.0.1 domain. Accounts restored from `initData` with a `factory` keep their version automatically.
- 8041006: Move VM-specific exports into dedicated `@rhinestone/sdk/solana` and `@rhinestone/sdk/evm` entry points. The package root keeps only VM-neutral surface, and the moved symbols have no root aliases.

  - Import `solanaAddress`, `createSolanaSwigId`, `solanaMainnet`, `solanaDevnet` and every `Solana*`-named type (for example `SolanaAddress`, `SolanaChain`, `SolanaAccountConfig`, `SolanaStandaloneAccount`, `SolanaDeployOptions`, `SameChainSolanaTransaction`, `CrossChainSolanaOriginTransaction`, `SolanaExecutionMetadata`) from `@rhinestone/sdk/solana`.
  - `@rhinestone/sdk/utils` is removed. Import its helpers (`experimental_getV0InitData`, `experimental_getRhinestoneInitData`, `experimental_getModuleSetup`, `toViewOnlyAccount`, `walletClientToAccount`, `wrapParaAccount`) from `@rhinestone/sdk/evm`.
  - Import the validator address constants (`OWNABLE_VALIDATOR_ADDRESS`, `WEBAUTHN_VALIDATOR_ADDRESS`, `MULTI_FACTOR_VALIDATOR_ADDRESS`, `MULTI_FACTOR_VALIDATOR_V2_ADDRESS`, `SMART_SESSION_EMISSARY_ADDRESS`) and the `EvmAccountConfig`, `EvmAccountEntry`, `EvmReceiverAccountConfig` and `ManagedEvmAccount` types from `@rhinestone/sdk/evm`.
  - Errors, including the Solana errors and guards, stay in `@rhinestone/sdk/errors`.

### Minor Changes

- bdc154d: Support EVM → Solana token delivery: fund an intent from managed EVM sources and deliver SPL tokens to a Solana wallet.

  - Set `destination.chain` to `solanaMainnet` or `solanaDevnet` with a base58 `destination.token`, funded from an EVM `source`; the delivery recipient is the explicit `destination.recipient`, otherwise the configured Solana receiver, otherwise the account's own Solana wallet.
  - Read the delivering provider's own destination chain id from `quote.bridgeFill` on ECO routes, the id that resolves a Solana fill against that provider's status API.

- 43df7e3: Drop the optional `express` peer dependency. `createExpressRouter` from `@rhinestone/sdk/jwt-server` now returns a plain middleware function instead of an Express router object, so the SDK no longer needs `express` installed. Mount it exactly as before — `app.use(path, express.json(), createExpressRouter(config))` — on Express 4 or 5; it now also type-checks against `@types/express`. If you added routes to the returned router, mount your own router alongside it instead.
- 7cd7e16: Fix the `OwnerSignature` and `OwnerSignatureData` declarations to describe `slots`, the ordered per-request signatures that `signTransaction(prepared, { owner })` returns and `assembleTransaction` accepts, instead of the obsolete `origin`.
- edab078: In JWT auth mode, request intent-scoped sponsorship approval when a sponsored transaction is quoted, not when it is submitted. This covers EVM transactions, Solana-origin transfers, instructions and deliveries, and `deploy('solana', …)`.

  - `getIntentExtensionToken` runs once per sponsored `prepareTransaction` (or Swig creation), before the quote. It runs even for quotes that are never submitted. `submitTransaction` never calls it, including for restored prepared transactions.
  - A denied or failing `getIntentExtensionToken` now rejects `prepareTransaction` with nothing quoted, instead of failing at submission.
  - Add `UnsupportedSponsorshipApprovalError` (exported from `@rhinestone/sdk/errors`). It is thrown before `getIntentExtensionToken` runs when the quote request falls outside the approval contract. Use project-wide sponsorship for such a request.
  - The `intentInput` a grant commits to is the versioned `sdk-3.0.0-caucasus` input (see the singular source and destination entry). A Solana input names the paying Swig as `account.svm`: its wallet, its authority and, for plain operations, its state account; a Swig creation's input also includes the installed root and the Swig id.
  - A Swig creation now requests `sponsorship: { gas: true, bridgeFees: false, swapFees: false }` so the request matches its approval input.

- 627e338: Add settlement-scoped Smart Sessions and validation tools.

  - Support ACROSS, CCTP, OFT, ECO_IE, SAME_CHAIN_IE and LZ where enforceable, with served addresses, recipient/delivery floors and optional settlement fees. Retired ECO is refused, SAME_CHAIN_IE is exclusive and excluded from `all`, and OFT and LZ cannot be combined.
  - Add `sdk.validateSession` and offline `/smart-sessions` `validateSession`, stable refusal/warning codes, access metadata and dropped-layer coverage. Offline resolution accepts caller-supplied settlement catalog and wrapped-native data without network reads.
  - Add one-time-use policy/burn helpers, chain-aware policy defaults, deployed UniversalActionPolicy-copy verification on online create/validate, and coherent budget-reset checks through `SessionDetailsOptions`.
  - Add opt-in `swap.stableFloor` and independent permission/permit/swap windows. Fee and floor coverage applies only to the paths each policy enforces.

- 5229e07: Run EVM calls after a Solana → EVM delivery: pass `destination.calls`, and optionally `destination.gasLimit`, on a `CrossChainSolanaOriginTransaction`, and the account's EVM account runs them on `destination.chain` once the tokens land.

  - The calls need the account's EVM entry and land the delivery on its EVM address, so they are refused with an explicit `destination.recipient` and on an account with no EVM entry.
  - An EVM account not yet deployed on `destination.chain` is deployed before the calls run. An EIP-7702 account passes `eip7702InitSignature` from `signEip7702InitData()`, as on an EVM transaction.
  - The quote asks for the Swig spend first, then the EVM account's EIP-712 authorization of the calls, then any EIP-7702 delegation. `signTransaction` signs the EVM requests before the spend, whose slot window is the short one, and returns one proof per request in that order; `submitTransaction` sends them all.
  - Without `calls`, the request and the proofs are unchanged.

- 9951410: Add and remove secp256k1 (ECDSA) keys on a managed Solana account's Swig, and check whether an authority change is already in place. Pass `{ destination: { chain, authority: addEcdsaKey(key, { permission }) } }` or `{ destination: { chain, authority: removeEcdsaKey(key) } }` to `prepareTransaction`, then sign, submit and wait as usual.

  - `addEcdsaKey` and `removeEcdsaKey` come from `@rhinestone/sdk/solana`. They take a viem local account or a secp256k1 public key (33-byte compressed, 65-byte uncompressed or 64-byte x‖y), and compress it. An uncompressed key must lie on secp256k1. An EVM address, a WebAuthn account, or an account without a `publicKey` is refused with `UnsupportedAccountCapabilityError`.
  - Every key kind takes every Swig permission, always explicit: `all`, `allButManageAuthority` or the new `manageAuthority`. `addPasskey` accepts `manageAuthority` too. `manageAuthority` adds and removes non-root authorities, including granting `all`, so it is takeover power; it never spends or runs instructions.
  - An account configured with a manage-only key as its `{ type: 'ecdsa', account }` owner, including an external viem `toAccount` signer, can add and remove authorities. The orchestrator refuses its spends.
  - `account.getAuthorityStatus({ destination: { chain, authority } })` returns `applied`, `notApplied` or `conflict` without signing or submitting. It quotes the change and reads the orchestrator's refusal, so it needs a configured owner able to manage authorities. Under JWT auth, it mints one sponsorship grant that is never used. Settle an in-flight intent before trusting `notApplied`. Available on standalone and composite accounts with a managed Solana entry.
  - Widened types: `SolanaAuthorityKey` is now a `passkey` | `ecdsa` union; `SolanaAuthorityPermission` replaces the removed `SolanaPasskeyPermission`; import it from `@rhinestone/sdk/solana`; `SolanaAuthorityExecutionMetadata` gains `keyType`; and `SolanaAuthorityChangeRefusedError.permission` and `SolanaAuthorityDisclosure` (`key.kind`, `permission`) cover the new key kind and permission. Exhaustive switches over them need the new cases.
  - New public types: `SolanaAuthorityPermission` and `SolanaAuthorityStatus`.
  - Needs an orchestrator that accepts secp256k1 keys and `manageAuthority` (dev today). An older orchestrator refuses them with a `ValidationError` before anything is signed.

- ea4fa75: Run Solana instructions on a same-chain intent from a managed Solana account. No orchestrator route serves them yet, so a well-formed request is refused with `UNSUPPORTED_DESTINATION_INSTRUCTIONS` until one ships; the SDK surfaces that reason unchanged.

  - Pass `{ destination: { chain, instructions, addressLookupTables? }, sponsored }`, or name the fee token as `source: { token }` when unsponsored. The instructions run out of the account's own Solana wallet, so the destination names no token and no recipient — the payee is encoded inside the instructions. Mixing them with a destination token, recipient, EVM calls or fees is rejected in the types and before the quote.
  - Instructions are accepted both as the JSON Jupiter's `/swap-instructions` returns and as `@solana/web3.js` instruction objects, and are normalized to the wire shape. No Solana runtime dependency is added. `@solana/kit` instructions are not accepted; convert them first.
  - Order, account metadata, signer flags and data bytes are preserved verbatim. The published request limits — 32 instructions, 64 accounts each, 1232 bytes of data in total, 8 address lookup tables — are checked locally, so an oversized request fails before a round trip.
  - `PreparedTransactionData.execution` gains a third arm: narrow on `kind === 'solana-instructions'`.
  - New public types: `SameChainSolanaInstructionsTransaction`, `SolanaInstruction`, `SolanaAccountMeta`, `SolanaProgramInstruction`, `SolanaInstructionInput`, `SolanaInstructionsExecutionMetadata`.

- 164b593: Support native SOL as the source asset of a Solana → EVM delivery: `source: { chain, token: '11111111111111111111111111111111', maxAmount? }`, capped or uncapped, behaves exactly as an SPL mint. The wallet's rent-exempt reserve is never spendable, so spending the whole balance or a cap takes at most the lamports above it. Same-chain transfers still refuse native SOL, now before quoting with `UnsupportedAccountCapabilityError`.
- 4c4e2d2: Add and remove passkeys on a managed Solana account's Swig. Pass `{ destination: { chain, authority: addPasskey(passkey, { permission }) } }` or `{ destination: { chain, authority: removePasskey(passkey) } }` to `prepareTransaction`, then sign, submit and wait as usual.

  - `addPasskey` and `removePasskey` come from `@rhinestone/sdk/solana`. They take a viem `WebAuthnAccount` or a P-256 public key in any encoding, and compress it. `permission` is `'all'`, `'allButManageAuthority'`, or `'manageAuthority'`; it is required on an add and rejected on a remove.
  - The configured owner, ECDSA or passkey, signs the change with one prompt. Available on standalone and composite accounts with a managed Solana entry; address-only receivers can't use it.
  - Always gas-sponsored and billed to the integrator's sponsorship, like `deploy('solana', …)`. An authority change can't take fees, tokens, a recipient or instructions.
  - The quote is checked before signing: one `manageAuthority` signing request, and a plan disclosing the same action, key, permission, role id and rent.
  - The orchestrator's refusals throw `SolanaAuthorityChangeRefusedError` from `@rhinestone/sdk/errors`, with `reason`, `swigAddress`, `roleId`, `roleIds` and `permission`. Detect it with `isSolanaAuthorityChangeRefused`. After an uncertain outcome, prepare the same change again: `authority_exists` with the same permission, or `authority_not_found` on a remove, means the change already landed.
  - New public types: `SameChainSolanaAuthorityTransaction`, `SolanaAuthorityChange`, `SolanaAuthorityKey`, `SolanaAuthorityPermission`, `SolanaAuthorityDisclosure`, `SolanaAuthorityExecutionMetadata` (execution `kind: 'solana-authority'`) and `SolanaAuthorityChangeRefusalReason`. Replace the removed `SolanaPasskeyPermission` with `SolanaAuthorityPermission` from `@rhinestone/sdk/solana`. `SigningScope` and `PlanExecution` gain the Solana authority-change variants.
  - Every other Solana transaction type now declares `authority?: never`.

- d626fc6: Let a passkey own a managed Solana account: configure `solana: { owner: { type: 'passkey', account } }` with a viem `WebAuthnAccount`, beside the existing ECDSA owner.

  - The orchestrator receives the passkey's compressed P-256 public key as the Swig authority.
  - `signTransaction` signs the quote's WebAuthn challenge with the passkey and returns a `webauthn` proof, which `submitTransaction` sends. The assertion's challenge, `webauthn.get` type and signature length are checked before it leaves the SDK; the orchestrator verifies the signature itself.
  - A Swig role in `SigningAuthority`, and the Swig account in a plan, can now name a `secp256r1` authority. For a passkey owner, `PreparedTransactionData.execution.authority` is the compressed public key.

- 509d536: Ask for sponsorship on a Solana-origin transaction — the same-chain transfer, the same-chain instruction execution and the Solana → EVM delivery all take `sponsored` in the shape an EVM transaction takes it, with the same translation.

  - The SDK states the intent and the orchestrator decides. A served request comes back as a quote whose fee breakdown marks the sponsored categories; one it cannot bill is refused with its named categories intact.
  - Today the orchestrator serves `gas` and, where the integrator set a rate, `protocolFees` on a Solana origin. The `sponsored: true` shorthand asks for all four categories and is refused on every Solana route until the orchestrator widens what it bills — the SDK does not narrow it on your behalf.
  - `sponsored.bridging` on a Solana → EVM delivery restricts the route set, so a corridor no such route serves comes back as a refusal rather than a quote.
  - A JWT-authenticated integrator approves a sponsored Solana intent the same way as an EVM one: `getIntentExtensionToken` runs when the quote is requested, and the grant is charged the same way on both VMs.
  - Omitting `sponsored` is unchanged: the request and the submission are byte-for-byte what they are today.

- c30cb1e: Let a managed Solana account stand alone, with no EVM account: configure `solana: { owner, swig: stateAddress }` (`SolanaStandaloneAccountConfig`) naming an existing Swig state account. `createAccount` derives its asset-holding wallet PDA and returns a `SolanaStandaloneAccount`, which exposes only prepare, messages, sign, submit and wait. `getAddress('solana')` returns the derived wallet, and a Solana → EVM delivery from the account must name its `destination.recipient`. Persisted Solana execution metadata carries the wallet as `accountAddress` for such an account, and no `accountType`.
- 2efb1c3: Support Solana → EVM token delivery: spend a managed Solana account's SPL balance and receive a token on an EVM chain.

  - Pass `source: { chain: solanaDevnet, token: mint }` and an EVM `destination: { chain, token, amount? }`. Omit the delivery amount to spend the whole balance of that mint, and omit `destination.recipient` to deliver to the account's own EVM address.
  - Authorization is the existing Solana model: one `personalSign` origin payload, no destination signature, and the same short validity window. Costs keep each leg in its own namespace — base58 on the Solana input, hex on the EVM output.
  - `PreparedTransactionData.execution` is now a union. Narrow on `kind` — `'solana'` for a same-chain transfer, `'solana-cross-chain'` for a delivery, which carries `destinationChain`, `destinationToken` and a hex `recipient`.
  - Unsupported shapes are refused before a quote is requested: destination instructions, HyperCore actions, more than one source or destination token, mixed-VM sources, and a non-EVM destination.

### Patch Changes

- 2fc5ece: Align internal Caucasus types with the validated contract without changing public APIs or requiring consumer migration.
- 57b779d: Fix v3 reference examples and API guidance for authentication, transaction funding, signing overloads, proof assembly, and execution results.
- 627e338: Fix Smart Session settlement execution and catalog freshness.

  - Enforce claims from the ERC-1271 policy list while retaining compiled claim metadata for signing; reject duplicate policy addresses that would overwrite installed guards.
  - Preserve verify-execution mode for scoped, fallback and once sessions, reject origin operations for `preClaimOps: 'none'`, and insert enable/burn calls in settlement order without duplicate same-chain burns.
  - Intersect session scope with the explicit source token, amount and route before quoting, preserving ordered signing requests and sponsorship binding.
  - Refresh served chain data after ten minutes and retry failed fetches without evicting newer in-flight entries.
  - Update fynd TychoRouter V3 calldata handling and reduce settlement policy encodings while retaining enforced constraints.

- 1287cc7: Recognize CAIP-2 chain ids in `SOLANA_ACCOUNT_NOT_CREATED` refusals, so `isSolanaAccountNotCreated` holds for live responses and `chainId` still resolves to the SDK's numeric id. An unusable chain id no longer degrades the error to a generic `ValidationError`.
- Keep the default `x-sdk-version` header synchronized with the package manifest in local builds, so it reports the exact installed SDK version.

## 2.17.1

### Patch Changes

- 09ce72b: Publishes the 2.17.0 changes under the `latest` tag: 2.17.0 itself was published under `dev` only. No change to the SDK's behaviour from 2.17.0.

## 2.17.0

### Minor Changes

- 83dfc34: Let a settlement-scoped permit settle through `ACROSS` beside its IntentExecutor layers, so a session without `fallback` pins its recipient on every route:

  - A permit may name `ACROSS` beside `CCTP`, `OFT`, `ECO_IE` and `LZ`. The session holds both surfaces and no wildcard: the layers' calls, and the ACROSS claim policy on the ERC-1271 list, bound by `oneTimeUse` or, for a reusable session, by Permit2SenderPolicy or `preClaimOps: 'none'`. The claim pins the recipient the layers pin, the account for a leg that names none. `approve(Permit2)` joins the layers' approve, so what the session approves stays within one `maxAmount` across every route, and `oneTimeUse` burns one id whichever route settles.
  - Such a permit refuses `to.minAmount` and `maxFeeBps`, which `ACROSS` cannot enforce, and `fillDeadline`, which the IntentExecutor layers cannot. `SAME_CHAIN_IE` still stands alone, and `fallback` still refuses an IntentExecutor layer.
  - `settlementLayers: 'all'`, and so a permit without `fallback` that names no layer, now also includes `ACROSS` where it can settle the permit. Where it cannot (a `to.minAmount`, `maxFeeBps`, a native token, or a reusable session on a chain without Permit2SenderPolicy) it is listed in `settlementCoverage.dropped` with the reason naming it would be refused for. With a `fillDeadline`, `'all'` keeps `ACROSS` alone and drops the other layers, and a `from` token no other layer serves now builds an ACROSS-only session instead of being refused.
  - Unlike the IntentExecutor layers, the ACROSS route has no per-call amount cap and no output floor. It is bounded by the session's approve cap (`maxAmount`) and by the claim's token, chain and recipient, and an allowance the account already gave Permit2 is not counted against `maxAmount`. `validateSession` warns with `UNCAPPED_ACROSS_ROUTE` when a permit naming `ACROSS` beside other layers, or `'all'` keeping it, has a `from` leg on the session's chain without its own `maxAmount`. Name the other layers to leave `ACROSS` out. A permit naming only `ACROSS` keeps its current warnings.
  - Intents signed with such a session are offered `ACROSS` beside the kept layers, and are funded only from the permit's `from` tokens within `maxAmount`.

  Migration: a session built from `'all'` or an omitted `settlementLayers` changes its actions, ERC-1271 policies, permission id and enable digest wherever `ACROSS` is now included, so it must be enabled again. A permit naming only `ACROSS`, or only IntentExecutor layers, builds the same session as before. `DroppedSettlementLayer.layer` may now be `'ACROSS'`.

- 883d5c0: Add the `validateSession` warning `ACTION_WINDOW_SHARED_PERMISSION_ID` for a window on a `permissions` function or a raw `time-frame` action in a `zeroHash`-salted session, which shares its permissionId with any other zero-salt session of the same owners, so the window may not be installed when an intent enables the session. Use `saltMode: 'strict'` (restricted sessions) or a fresh session key.
- 83699bf: Add settlement-scoped cross-chain permits, starting with CCTP (RHI-7826). A `crossChainPermits` entry with `settlementLayers: ['CCTP']` compiles to argument-pinned actions instead of a Permit2 claim policy:

  - CCTP moves only native USDC, so the `from` token and every `to` token must be USDC on its chain, or the permit throws. Each chain's USDC, CCTP domain and TokenMessengerV2 come from the orchestrator's `GET /chains` `settlement` block.
  - The session is restricted to `USDC.approve(TokenMessengerV2)` and `TokenMessengerV2.depositForBurnWithHook`, with the `from` token, each `to` chain's CCTP domain paired with its recipient, a zero `destinationCaller` and `maxAmount` (cumulative) pinned in the calldata.
  - The recipient defaults to the account, so the session definition needs `account`. Another recipient, or `'any'`, requires `allowRecipientNotAccount`.
  - It must name its `to` chains (an unpinned domain lets a burn go where the recipient cannot mint). `maxAmount` is a true total per `from` token on the session's chain: of the one settlement with `oneTimeUse`, of the session's lifetime without it. It cannot be combined with `SAME_CHAIN`, `ECO` or `ACROSS`, with another permit, with `claimPolicies`, with `fillDeadline`, or with a `signing` mode other than `disabled`.
  - Only sponsored intents without an app fee can settle through it: the paymaster and fee-carve calls are not authorised.
  - Intents signed with the session are limited to its layers (`settlementLayers: { include: ['CCTP'] }`); an explicit filter can only narrow it.

  Permits that name only Permit2 layers are not settlement-scoped (see the scoped Permit2 sessions entry for how they resolve).

  `getArbitersForSettlementLayers` now throws on a layer with no Permit2 arbiter instead of returning an empty (any-arbiter) list.

- 45fc89c: Deprecate `SessionDefinition.claimPolicies` in favour of `crossChainPermits`, which expands to the same claim policy plus a `maxAmount` spending limit (with `oneTimeUse`), takes `Date`s rather than raw deadlines, and defaults to bridge-to-self instead of leaving the recipient open. It also picks the enforcement surface per settlement layer: a Permit2 arbiter layer compiles to a claim policy, an IntentExecutor layer to argument-pinned actions, and a claim policy does not bind an IntentExecutor route. `claimPolicies` stays exported as the escape hatch for pinning `spenders` to an arbiter outside the bundled allow-set.
- 753a0e0: Accept an `ECO_IE` settlement-scoped permit without `validUntil`, and keep `ECO_IE` under `settlementLayers: 'all'` when `validUntil` is omitted. `ECO_IE` now bounds Eco's route and reward deadlines by the earlier of the permit's `validUntil` and `oneTimeUse.validUntil`. That deadline must be at least 7 days ahead, and `ECO_IE` is usable only until it minus 7 days. Only when neither is set are both Eco deadlines unpinned, so an unfilled `ECO_IE` reward has no refund deadline.

  A session whose permit `validUntil` is later than `oneTimeUse.validUntil` now pins Eco's deadlines to the earlier one, so its permission id changes and it must be enabled again; when the earlier one is under 7 days ahead, `ECO_IE` is refused, or dropped under `'all'`.

  A `settlementLayers: 'all'` session without a permit `validUntil` now includes `ECO_IE` where it can settle, so its encoding and permission id change and it must be enabled again.

- 7a23e16: Add `ECO_IE` (Eco's solver network) as a settlement-scoped cross-chain permit layer (RHI-7826). `settlementLayers: ['ECO_IE']` restricts the session to `token.approve(Portal)` and `Portal.publishAndFund` (the encoded-route overload) on Eco's Portal. The Portal, provers and stablecoins per chain come from the orchestrator's `GET /chains` `settlement` block. `'ECO'` keeps its meaning (the retired Standard Eco Permit2 arbiter), so no existing permit changes:

  - The route and reward are pinned to the one shape the orchestrator accepts: an ERC-20 reward and a single `transfer` delivery. Every calldata pointer, the reward's tokens pointer and every count are pinned, plus each `to` chain's Eco destination id, destination Portal, delivery token, the `transfer` selector and recipient, the reward creator (the account), the reward token, and a zero native amount on both sides. The route's internal pointers and length are fixed by Eco instead: the destination Portal re-encodes the route to check the intent hash, so a route laid out any other way can never be filled, and its reward refunds to the account after the reward deadline.
  - The reward's prover must be an Eco prover deployed on both chains of the leg (as the orchestrator serves them per chain). An unlisted prover could attest a fill that never happened; one with no code on the source chain would make `refund` revert. A leg with no shared prover throws.
  - Eco fills are permissionless and the filler names who claims the reward, so a session key can fill its own intent: the delivery floor is the whole price bound. `ECO_IE` requires `maxAmount`, which caps the reward, and a floor: a new `maxFeeBps` (the most of `maxAmount` the solver may keep), or a `to.minAmount` on every leg. Set `maxAmount` close to the reward you expect to pay: a smaller reward still has to clear the floor computed from `maxAmount`, so it fails closed.
  - With `maxFeeBps`, the route must deliver at least `maxAmount × (1 − maxFeeBps / 10000)`, rescaled from the `from` token's decimals to the `to` token's and rounded up. Both tokens must be USD stablecoins the orchestrator serves for Eco, with decimals it serves (6 or 18); any other token is refused.
  - With `to.minAmount` (the same field as a `SAME_CHAIN_IE` swap), the route must deliver at least that amount of the `to` token, in its smallest units (its own decimals), for any `from` and `to` token the orchestrator serves for `ECO_IE`: the owner prices the pair. Given both, the higher floor applies. On `ECO_IE`, `to.minAmount` must be positive. Where both tokens' decimals are served, a value outside half of to all of `maxAmount` is refused as a units mistake. `to.minAmount` binds every layer in the permit: a layer that cannot enforce it, such as `CCTP`, is refused, or dropped under `'all'`. Without `maxFeeBps`, every `from` leg must give the same `maxAmount` (or `'all'` drops `ECO_IE`), since each source chain's session pins the same floor against its own cap, and a `to` leg named twice must give the same `to.minAmount`.
  - A `validUntil` bounds both the route deadline and the reward deadline: an unfilled reward is refundable after its deadline, and can stay locked until `validUntil`. Only when neither the permit's `validUntil` nor `oneTimeUse.validUntil` is set is neither deadline pinned, so an unfilled reward has no refund deadline.
  - Every leg needs a concrete recipient (not `'any'`). The `maxFeeBps` floor treats both stablecoins as 1:1, so a depeg between the two sides is borne on top of `maxFeeBps`.
  - Intents signed with the session are limited to the orchestrator's `ECO` layer. `maxFeeBps` without `ECO_IE` among the layers throws.
  - On every settlement-scoped permit with `maxAmount`, the layer approve is capped at `maxAmount`, so no larger allowance outlives the session.

- 508426b: `validateSession` now reports `warnings` beside `refusals`: things `createSession` accepts but that do not hold the way the definition may read. Each warning has a stable `code` (listed in `SESSION_WARNING_CODES`, exported with the `SessionWarning` and `SessionWarningCode` types), a `message` and, when it is about one permit, its `permitIndex`. The field is present only when there is a warning, and a warning never makes `createSession` throw.

  - `FALLBACK_RECIPIENT_PIN_ACROSS_ONLY`: a session with `fallback` holds a Permit2-layer permit that pins the recipient (`allowRecipientNotAccount` left `false`, the default, or a `to` leg with a `recipient` other than `'any'`). The pin is enforced by the Permit2 claim policy, which checks `ACROSS` claims only. With `fallback`, intents may also settle through IntentExecutor layers, whose calls the wildcard admits without reading their recipient, so the pin does not hold there. To enforce a recipient on IntentExecutor layers, use a settlement-scoped permit (the recipient is pinned in the layer's calldata) without `fallback`.
  - The docs of `allowRecipientNotAccount`, `to`, `recipient`, `recipientIsAccount` and `fallback` now state this.

- 1245892: Drop the optional `express` peer dependency. `createExpressRouter` from `@rhinestone/sdk/jwt-server` now returns a plain middleware function instead of an Express router object, so the SDK no longer needs `express` installed. Mount it exactly as before — `app.use(path, express.json(), createExpressRouter(config))` — on Express 4 or 5; it now also type-checks against `@types/express`. If you added routes to the returned router, mount your own router alongside it instead.
- 753237a: Add `LZ` as a settlement-scoped cross-chain permit layer (RHI-7826): USDC through the LayerZero Value Transfer API, which the orchestrator runs as `approve(TransferDelegate)` then `LZMultiCall.execute(calls, quoteId)`. `settlementLayers: ['LZ']` restricts the session to those two calls:

  - Each chain's LZMultiCall, TransferDelegate, Stargate USDC pool and CCTP route (domain, token, fee receiver, feeless) come from the orchestrator's `GET /chains` `settlement` block. The CCTP route's TokenMessengerV2 is a constant, Circle's single mainnet address.
  - The approve may only name the chain's TransferDelegate.
  - LZMultiCall runs any call it is handed, so the batch shape is pinned: the call count and, per nested call, its element offset, target and data pointer, plus the arguments that route funds. The pull may only move the `from` token from the account to LZMultiCall, and the sweep must return the token and native value to the account. Words the contracts already enforce are left unpinned: LZMultiCall checks the pull's length, selector and `from` itself, the non-payable nested calls revert on any native value, and the CCTP burn token can only be the USDC the pinned pull and sweep move.
  - The session accepts two of the API's USDC routes. CCTP: `depositForBurn` to the leg's domain and recipient, no destination caller, with the relay fee paid to LayerZero's receiver, at most 1 USDC and `maxAmount`; to Plasma without the fee. Stargate TAXI, only where no CCTP route connects the two chains (today, to or from Soneium): pool send to the leg's eid and recipient, refund to LZMultiCall, no native drop or compose. Where both routes exist CCTP is cheaper and faster, so the orchestrator must not plan Stargate there; Stargate BUS is refused.
  - The session runs one `execute`, whatever the route, and `maxAmount` caps its pull: the one-time-use burn admits every later op in its transaction, so this keeps a stale TransferDelegate allowance from funding a second route and a second Stargate send from paying another native fee.
  - Chains follow what the orchestrator serves: a route exists where both chains carry that route's block. A `to` leg no route from the session's chain reaches is left to the other chains' sessions; one it reaches with another token throws.
  - An `LZ` permit requires `oneTimeUse`. A permit whose pins exceed the on-chain ArgPolicy's 128 rules fails to encode; name fewer `to` legs.

  The approve of every IntentExecutor-layer permit now caps the total it grants at `maxAmount`, not each call: the one-time-use burn admits every later op in its transaction, so a per-call bound let repeated approves grant the cap several times.

- 29373ed: Accept `to.minAmount` on an `LZ` settlement-scoped permit, alone or beside `ECO_IE`. On a leg LZ reaches over Stargate, the session refuses a send whose `minAmountLD` is below it, which bounds the pool fee the send can accept; without it a Stargate send accepts whatever fee the pool charges. Set it to at most ~99% of the expected send, since the LZ API quotes `minAmountLD` with about 1% slippage. The floor is refused at zero or above uint64, on a leg LZ reaches over CCTP, beside a second `to` leg on the same chain, and unless both tokens are served with equal decimals; under `'all'` each of these drops `LZ` instead of failing the permit.
- c254b59: A settlement-scoped cross-chain permit may now name several IntentExecutor layers (RHI-7826), or `settlementLayers: 'all'`:

  - `settlementLayers: ['CCTP', 'LZ']` (any of `CCTP`, `OFT`, `ECO_IE`, `LZ`) allows each layer's scoped settlement call, plus one approve of the `from` token whose spender may be any of those layers' contracts. `maxAmount` is one cumulative budget across those approves, not one per layer. Each layer's own call keeps its own `maxAmount` cap, so an allowance the account already gave one of those contracts can move more than `maxAmount` in total.
  - A named list is strict: every layer must be able to settle the permit on the session's chain (routes there, moves the `from` token, has the fields it needs), or the session is refused with that layer's reason.
  - `'all'` keeps every one of `CCTP`, `OFT`, `ECO_IE` and `LZ` that can settle the permit and drops the rest, listing each with its reason in the session's `settlementCoverage.dropped`; it is refused, with each layer's reason, when none can. It never includes `SAME_CHAIN_IE`. The session's `settlementLayers`, and so the intent's settlement-layer filter, list only the layers it kept.
  - `SAME_CHAIN_IE` still stands alone: combining it with another layer is refused. `OFT` and `LZ` cannot be combined either, since each pays a native LayerZero fee no pin bounds. `maxFeeBps` requires `ECO_IE` among the session's layers; with `'all'`, setting it asks for `ECO_IE`, so a dropped `ECO_IE` is refused with its reason.
  - Layers compile in a fixed order, so `['LZ', 'CCTP']` and `['CCTP', 'LZ']` give the same session.
  - `'all'` resolves against `GET /chains` and the clock when the session is created: store the created session and reuse it rather than rebuilding it from `'all'`.
  - With `ECO_IE` among several layers, Eco's delivery floor (`maxAmount × (1 − maxFeeBps / 10000)`) means an intent settles over Eco only when it moves close to `maxAmount`.
  - `allowFees` adds the paymaster as another branch of the same approve, with its own fee budget (5 USD, 30 USD on Ethereum mainnet).
  - A single-layer permit compiles to the same session as before.

- c008ed4: Support `to.minAmount` on an `OFT` settlement-scoped permit. It floors the `send`'s `minAmountLD`, so the session key cannot accept a smaller delivery; it must be positive and at most uint64, both tokens need equal decimals served by the orchestrator, and it also refuses any send smaller than it. The orchestrator sends at 1% slippage, so set `to.minAmount` at most 99% of the amount you expect to send. Beside `ECO_IE` both layers enforce the floor.

  `to.minAmount` binds every layer in the permit. A layer that cannot enforce it is refused when named and dropped under `'all'`: `CCTP` never can, so `['ECO_IE', 'CCTP']` with a floor throws and `'all'` drops `CCTP`; an `OFT` floor it cannot meet (not positive, above uint64, unequal or unserved decimals, two legs admitting one send with different floors) drops `OFT`. `ECO_IE` without `maxFeeBps` drops the same way when `from` legs give different `maxAmount`s. A floor needs no particular layer: the permit is refused only when no layer is left.

  Where both tokens' decimals are served, a `to.minAmount` outside half of to all of any `from` leg's `maxAmount` throws as a units mistake, whatever the layers, `'all'` included.

- 66ad136: Add `OFT` (USDT0 over LayerZero) as a settlement-scoped cross-chain permit layer (RHI-7826). A `crossChainPermits` entry with `settlementLayers: ['OFT']` restricts the session to `USDT0.approve(adapter)` and the adapter's `send`, on the chains the USDT0 mesh reaches (each chain's adapter, eid and token come from the orchestrator's `GET /chains` `settlement` block):

  - Pinned in `send`: the `to` chains' eids paired with their recipients, a non-zero `amountLD` capped by `maxAmount` (cumulative), `refundAddress` = the account, a zero LayerZero-token fee, and the canonical tuple layout with empty `extraOptions`, `composeMsg` and `oftCmd` — so no native drop or compose call can ride along.
  - `send` may carry any `msg.value`: it pays the LayerZero fee, and the pinned refund address returns any excess to the account. The session definition therefore needs `account`.
  - The `from` token and every `to` token must be USDT0 on its chain. Only `send` is authorised, so a route that needs an origin swap (or `sendMax`) cannot settle.
  - An OFT permit requires `oneTimeUse`, and its session sends at most once: every `send` costs the account a native LayerZero fee, and the one-time-use burn admits every later op in its transaction, so without the one-send pin a batch could repeat dust sends until the balance is gone.

- 78c8b8d: Default `policyAddresses.oneTimeUseId` to the deployed `OneTimeUseIdPolicy`, so a `oneTimeUse` session does not have to pass it: `0x630CEbCf54C7471154CF659088CC4197872Cf5FD` on production contracts, and `0x86F7cB4E25626d6a07cfED305c38816F30d07224` with `useDevContracts`. A session that uses the default resolves to the same session data, permission id and burn call as one that passes that address explicitly.

  Resolving a session on a chain where the policy is not deployed throws an error that names the chain, and so does preparing an intent that uses a session with a default address on such a chain. Pass `policyAddresses.oneTimeUseId` to use another deployment; an explicit address always takes precedence. Sessions without `oneTimeUse` are unchanged.

  Both addresses are exported from `@rhinestone/sdk/smart-sessions` as `ONE_TIME_USE_ID_POLICY_ADDRESS` and `ONE_TIME_USE_ID_POLICY_ADDRESS_DEV`.

- 4c2cce4: Add one-time-use session support (RHI-5798). `oneTimeUse: { id, validUntil? }` makes a session settle at most once per chain:

  - Every intent the SDK prepares for the session burns the id first on each chain it settles on (the policy refuses any settlement that does not), in verify-execution mode. The burn is the op that enables the session, so the session installs no dummy pre-claim action. Such intents must list `sourceChains` and cannot run destination calls on a chain that is also one of several sources.
  - The OneTimeUseIdPolicy guards every action and authorises only the session's own burn; with `claimPolicies` it also sits on the ERC-1271 list next to the Permit2 claim policy.
  - Its `claimPolicies` must each pin `spenders` (the Permit2 arbiter). Without `claimPolicies` the session has no signing surface, and a `signing` mode throws.
  - `validUntil` must be a future `Date`. The session is always salted as in `saltMode: 'strict'`; `saltMode: 'v1'` throws.
  - A `crossChainPermits` entry's `validUntil` / `validAfter` is a time-frame policy on the permit's actions and does not change the one-time-use deadline.
  - Exports `buildOneTimeUseBurnOp`, `oneTimeUseIdErc1271Policy`, `encodeOneTimeUseIdInitData` and the related types from `@rhinestone/sdk/smart-sessions`.

- cc3dc4b: Refuse two `claimPolicies` / `crossChainPermits` configurations that previously resolved but could not be enforced. Declaring `signing` with mode `scoped` or `disabled` alongside them throws — both rewrite the ERC-7739 content gate the claim policy is reached through, so the declared policy would never be consulted. A validity window (`{ mode: 'unrestricted', validAfter, validUntil }`) is kept instead: it lowers to a `TimeFramePolicy` that ANDs with the claim policies and leaves the gate alone. Declaring more than one Permit2 claim policy (including a `claimPolicies` entry plus a `crossChainPermits` one) also throws: they resolve to the same policy contract, and enabling stores one config per contract, so only the last would be installed while the signing path still built calldata for the rest. Split them across sessions.

  Permit2 claim policies are now enforced from the ERC-1271 policy list — the list Permit2's `isValidSignature` consults — for every session. Previously only one-time-use sessions placed them there. They replace a windowless signing policy rather than joining it, since that list is an AND and a permissive entry alongside would be dead config advertising a capability the session no longer has.

  A session carrying claim policies is now salted, so its permission id differs from a plain session for the same signer. Enabling adds to each on-chain policy list rather than replacing it, so without this the two would share a permission id and the plain session's signing policy would sit beside the claim policy.

  Sessions enabled by an earlier version keep their existing configuration and are unaffected. Because the permission id changes, picking this up means enabling the new session rather than re-enabling the old one.

- ead1d78: Let a scoped Permit2-route session be reusable and keep its pre-claim calls. A session whose Permit2-layer permit sets neither `oneTimeUse` nor `preClaimOps: 'none'`, and that sets no `fallback`, now gets Permit2SenderPolicy (`0xb590a7409de9e9f2A42B56CB62C1f7bA5ea0f959`, the same address for production and development) on its ERC-1271 list, after its claim policy and with empty init data. That policy accepts a claim signature only when Permit2 presents it, so the session's pre-claim calls (the Permit2 approve and, with `allowFees`, the fee calls) are checked as executions, which these sessions already sign for.

  - Such a definition was refused with `PERMIT2_ROUTE_NEEDS_BOUND`; it now builds on the chains the policy is deployed on. It is still refused on a chain without it, such as Avalanche or Robinhood Chain, and the refusal names that chain.
  - Sessions with `oneTimeUse`, `preClaimOps: 'none'` or `fallback` are unchanged, permissionId and enable digest included.
  - A `maxAmount` on such a permit caps its Permit2 approves over the session's lifetime, and a wrapped native `from` leg with one also gets the capped `deposit()`.

- 6736c59: Intents signed with a Permit2 cross-chain permit session no longer offer the orchestrator a Permit2 arbiter the session cannot sign:

  - A scoped Permit2 session (no `fallback`) limits intents to `settlementLayers: { include: ['ACROSS'] }`.
  - A session with `fallback` excludes only the Permit2 arbiters its permit does not name: a permit without `ACROSS` sends `settlementLayers: { exclude: ['ACROSS'] }`, so routes settled by the IntentExecutor (for example `RELAY` or `CCTP`) stay open, and same-chain intents are not affected. A permit that names no layers (`ACROSS` under `fallback`), or names `ACROSS`, leaves those intents unrestricted.
  - An intent's own `settlementLayers` can only narrow this. A filter that leaves no layer throws before the intent is quoted.
  - `Session.settlementLayers` now also lists a Permit2 permit's layers, so its type widens from the IntentExecutor layers to every cross-chain settlement layer. It is metadata only.

- d38aa28: Allow `maxAmount` on a reusable `crossChainPermits` session (one without `oneTimeUse`). There it is a lifetime total per `from` token on the session's chain: the sum of everything the session approves of that token, across every intent it signs and every route it settles through (`ACROSS`, `CCTP`, `ECO_IE`), not a per-intent cap.

  - Enabling the session again resets the budget. `account.getSessionDetails` (and `getSessionDetails` from `@rhinestone/sdk/smart-sessions`) reads the session's nonce and enabled state in one call and throws for one that is already enabled, including inside a bundle that adds another chain. It recognises such a session from its actions as well as its new `lifetimeBudget: true` field. Leave it out of the bundle, or pass `{ allowBudgetReset: true }` to sign the reset on purpose. Disabling the session and enabling it again also starts a fresh budget, by the owner's choice.
  - Build the session once and store it. A definition that uses `'all'` or names no layers resolves against `GET /chains` and the clock, so rebuilding it can give a different permissionId, and enabling that one starts a new budget beside what the old session has left.
  - The budget does not count allowances the account already holds for the token, which the session's routes can still spend: one the owner gave Permit2 or a bridge, or one another session left. Revoke them first for the cap to be the most the session can move. It does not count the `allowFees` calls either, which keep their own caps. Each approve counts in full, so approving the same spender again spends the budget again.
  - `ECO_IE`'s `maxFeeBps` floor applies to every intent, so an intent below `maxAmount × (1 − maxFeeBps / 10000)` does not settle through `ECO_IE`.
  - Intents still use the whole `maxAmount` as their source-asset cap. The chain refuses a plan that goes over what is left.
  - `OFT` and `LZ` still require `oneTimeUse`, because each send pays a native LayerZero fee that `maxAmount` does not bound. `'all'` still drops them from a reusable session.
  - On a wrapped native `from` leg, the native `deposit()` the session may make is capped at `maxAmount` over the session's lifetime too, apart from the approve budget: wrapping keeps the value in the account.
  - `maxAmount` with `fallback` still requires `oneTimeUse` (`PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE`). `preClaimOps: 'none'` with a `maxAmount` is refused with `PRE_CLAIM_OPS_NOT_APPLICABLE`, because its claims spend an allowance the cap does not count.
  - The `UNCAPPED_ACROSS_ROUTE` warning now asks only for `maxAmount`, and also fires for a permit naming only `ACROSS` that has an uncapped `from` leg beside a capped one. Its message says what bounds such a leg: nothing on that permit, and beside IntentExecutor layers only the chain's `maxAmount` read in that token's raw units.
  - Every session that could be built without this keeps its permissionId and enable digest, and `getSessionDetails` signs it exactly as before, with no extra read.

- 8cd7853: Add `SAME_CHAIN_IE` as a settlement-scoped cross-chain permit layer (RHI-7826): a smart account settling on its own chain through the IntentExecutor. `'SAME_CHAIN'` keeps its meaning (the Permit2 samechain arbiter), so no existing permit changes. `settlementLayers: ['SAME_CHAIN_IE']` restricts the session to one of two shapes, and every `to` leg must be on the session's chain:

  - **Same token in and out:** one `transfer` of the `from` token, with the recipients pinned (an OR across legs) and `maxAmount` as a cumulative cap. The recipient must be someone other than the account, so set `allowRecipientNotAccount`; an `'any'` recipient lifts the pin and then requires `maxAmount`, since it would otherwise authorise every transfer of the token.
  - **A different token:** exactly one `to` leg with a concrete recipient and a new `to.minAmount`, compiled through the existing `swap` scope's Rhinestone Swapper venue (sell token with `maxAmount` as its `maxTotal`, buy token, recipient). The Swapper's output bound (`minAmountOut`, or `amountOut` for exact-out) is pinned at `to.minAmount` or above, inside the same policy as the swap's other pins. The key still chooses the route, so the floor is a worst rate, not a price: the swap requires `maxAmount`, and the session accepts selling up to `maxAmount` for at least `to.minAmount`. `maxAmount` caps each Swapper entrypoint and the approve, so a second pull in the same transaction needs an allowance to the Swapper proxy that already existed before the session.
  - Only a swap the orchestrator wraps in the Swapper can settle (today exact-in fynd, fynd-hosted and 1inch quotes, and exact-out velora or approximated quotes); a swap routed straight to an aggregator is refused. Only sponsored intents without an app fee, and only ERC-20 `from` tokens, can settle. A mix of transfer and swap legs throws, as does `to.minAmount` on a transfer leg.
  - Intents signed with the session carry no bridge filter; its session refuses cross-chain calls on-chain.

  Session resolution now refuses an action that carries the same policy contract twice. Enabling keeps one config per policy and action, so the second entry overwrote the first on-chain instead of adding to it; such a session never enforced what it listed. This refuses, for example, two cross-chain permits in one session that both carry `maxAmount` or a validity window, and a payable permission with both `valueLimit` and `valueLimitPerUse` and no `params`; merge them into one permit or policy.

- 8780177: Scope Permit2-route sessions like settlement-scoped ones. A session whose `crossChainPermits` entry names only `ACROSS` (`settlementLayers: ['ACROSS']`) no longer gets the wildcard fallback action, and `access.kind` is `'scoped'`. Sessions built with an earlier version change permissionId and enable digest, so they must be enabled again.

  - A scoped session needs a bound on what its claim may carry: `oneTimeUse`, or the permit's new `preClaimOps: 'none'`, under which the claim may not carry pre-claim calls. Without either (or `fallback`) it is refused with `PERMIT2_ROUTE_NEEDS_BOUND`.
  - A `preClaimOps: 'none'` session settles only intents that need no pre-claim call: the account already holds the Permit2 allowance, no fee is taken from the `from` token, and nothing is wrapped. An intent that needs one is refused before signing. Intents must list their `sourceChains`. It cannot be combined with `oneTimeUse` or `allowFees`, and must be enabled before its first intent: sign `account.getSessionDetails([session])` with `account.signEnableSession`, then send `enableSession` from `@rhinestone/sdk/actions/smart-sessions` as an owner-signed transaction.
  - The session may call `approve(Permit2, amount)` on each `from` token on its chain, capped at the largest `maxAmount` of that token's legs (uncapped if any leg sets none). The cap bounds what the session approves, not an allowance the account already holds. A declared approve on that token is refused with `PERMIT2_APPROVE_CONFLICT`. A session with `fallback` gets no approve action on its `from` tokens: an exact approve action would take precedence over the wildcard and refuse every other spender, so its approves (Permit2, another layer's spender, the paymaster) go through the wildcard. A declared approve on a `from` token is refused there too.
  - A wrapped native `from` leg with a `maxAmount` adds the wrapped native `deposit()`, its value capped at that amount (the address comes from `GET /chains`); a `maxAmount` of 0 there is refused with `WRAPPED_NATIVE_ZERO_CAP`. A native `from` token is refused with `NATIVE_SOURCE_UNSUPPORTED`, and a native `to` token on a scoped permit with `NATIVE_DESTINATION_UNSUPPORTED`; name the wrapped native token.
  - `allowFees` now applies to these permits too, adding the fee-collector transfer and paymaster calls. With `fallback: 'intentExecution'`, it adds only the capped fee-collector transfer and the capped paymaster `callbackAllowMaxAmount`, which that wildcard does not admit; the paymaster approve goes through the wildcard. With `fallback: 'sudo'`, it adds nothing, since the wildcard admits every fee call. It needs the fee addresses `sdk.createSession` reads from `GET /chains` and a `from` token the orchestrator serves as a USD stablecoin. Without it, an intent that carries an app fee or a protocol fee taken from the `from` token does not settle.
  - A permit needs a `from` token on the session's chain (`PERMIT2_ROUTE_NEEDS_FROM`) unless the session sets `fallback`, and even then when it sets `allowFees` with `fallback: 'intentExecution'`.
  - A scoped permit settles through `ACROSS` only (`PERMIT2_ROUTE_ACROSS_ONLY`): naming `SAME_CHAIN` needs `fallback`. On a session with `fallback`, omitting `settlementLayers` admits only the `ACROSS` arbiters; without `fallback`, name `['ACROSS']`. A permit naming the retired Permit2 `ECO` arbiter is refused with `RETIRED_PERMIT2_LAYER`, with or without `fallback`; use `ECO_IE`.
  - Intents signed with a scoped session are pinned to `settlementLayers: { include: ['ACROSS'] }` and to the permit's `from` tokens as source assets, each capped at its `maxAmount`, so the orchestrator never plans a spend above it. An explicit `settlementLayers` or `sourceAssets` can only narrow them. A same-chain intent signed with such a session is refused unless the session has a `swap` scope.
  - A destination call or leftover sweep on the destination chain needs the destination session to declare those actions or set `fallback`.
  - `restrictToActions` or `swap` can now be combined with such a permit when it is bounded.
  - Add `fallback: 'intentExecution'` to keep the previous wildcard action (the calls Rhinestone's intent-execution policy admits, with the permit's spending limit), or `fallback: 'sudo'` for a wildcard that may call any contract, any function, with any arguments and native value. Either one reports `access.kind: 'open'` and keeps the previous intent filter and source assets. `fallback` on a session without a Permit2-layer permit, or with `restrictToActions` or `swap`, is refused with `FALLBACK_NOT_APPLICABLE`.
  - `ALLOW_FEES_ONLY_INTENT_EXECUTOR` is no longer raised. Sessions holding raw `claimPolicies` are unchanged.

- 1cb3f23: Add `access` to every created `Session`, and export its `SessionAccess` type. `access.kind` is `'scoped'` when the session key is held to the session's own actions, and `'open'` when the session keeps a wildcard fallback action. That fallback carries Rhinestone's intent-execution policy, or the sudo policy for a session with no actions, permissions or permits, or with `fallback: 'sudo'`. `access.reason` says what decided it (`restrictToActions`, a `swap` scope, a settlement-scoped or Permit2-route permit and its layers, `fallback`, `claimPolicies`, or no restriction) for people to read; its wording is not a stable contract, so branch on `kind`. The field is metadata only: it does not change the session's encoding, and stored sessions without it still work.
- 3b942b9: Session time windows use the TimeFramePolicy at `0xEAAb79CA50a37514E3Bd2538Aa80ee8cB0eCe9d3`, which holds a window on actions and ERC-1271 checks, and no longer need `oneTimeUse`. A window is `validAfter <= t < validUntil` in whole seconds, with `validAfter` rounded up.

  - `validUntil` / `validAfter` on a `permissions` function and a raw `time-frame` action policy compile to a time-frame policy on that action. While any action has one, an ERC-1271 signing surface outside claim policies (the default unrestricted one, or a `signing` mode) is bounded by the time the windows allow together, narrowed by a `signing` window.
  - A `crossChainPermits` entry's `validUntil` / `validAfter` puts a time-frame policy on every action the permit adds: on a Permit2 layer its approve, wrapped-native `deposit()`, fee calls and pre-claim action (with `fallback`, also the wildcard); on an IntentExecutor layer each layer's calls and, without `oneTimeUse`, the pre-claim action. On a Permit2 layer the claim accepts a Permit2 deadline from `validAfter` to 1 second before `validUntil`, and a `validAfter` also joins the ERC-1271 policies, narrowed with any `signing` window into one entry.
  - The policy is listed per chain as it is deployed. On a chain without it, an action window is refused with `TIME_FRAME_POLICY_UNAVAILABLE` unless `policyAddresses.timeFrame` is set, and a `signing` window keeps the previous deployment `0x0000000000D30f611fA3bf652ac6879428586930`, as before.
  - A window that leaves no whole second is refused with `VALID_AFTER_EXCEEDS_VALID_UNTIL`, a `validAfter` that is not a valid `Date` with `VALID_AFTER_INVALID` (`signing` throws for both).
  - `oneTimeUse.validUntil` is the one-time-use deadline on its own; other windows no longer shorten it. The `Session.claimPolicies` kept for signing carry the same Permit2 deadline bound as the installed claim policy. `ECO_IE` pins Eco's deadlines under the earlier of the permit's `validUntil` and `oneTimeUse.validUntil`.

  Sessions without a window keep their permissionId and enable digest, except a Permit2-layer `crossChainPermits` entry without `maxAmount`, whose permissionId moves: re-enable it, or keep the stored `Session`. A session with an action window gets a new enable digest, and a new permissionId when it is salted (`oneTimeUse`, claim policies, a settlement-scoped permit, a windowed `swap` scope, or `saltMode` `'strict'` or `'v1'` on a restricted session); under the default `zeroHash` salt its permissionId does not change. A session enabled earlier with a window keeps the policy it was enabled with: to rebuild it, for example to disable it, pass the `Session` stored at enable, or set `policyAddresses.timeFrame` to the previous deployment.

- 6aac23b: IntentExecutor-layer permits (`CCTP`, `OFT`, `ECO_IE`, `LZ`) read the addresses they pin from the orchestrator's `GET /chains` `settlement` block, so create such sessions with `sdk.createSession`; resolving one without those addresses throws. `SAME_CHAIN_IE` is unaffected.

  - The orchestrator is trusted for these addresses: the pins bound a hostile session key, not a compromised orchestrator.
  - `ECO_IE` provers and stablecoins follow the orchestrator's registry.

- 65e748c: Add `settlementCoverage` to a `Session` created with a settlement-scoped cross-chain permit, and export its `SettlementCoverage` and `DroppedSettlementLayer` types. With `settlementLayers: 'all'`, `settlementCoverage.dropped` lists each layer left out with the reason it cannot settle the permit on the session's chain; the kept layers stay in `settlementLayers`. A `to.minAmount` a layer cannot enforce is one such reason: it drops `CCTP`, and `LZ` for a leg it reaches over CCTP. The field is metadata only: the session's encoding and permission id are unchanged, and stored sessions without it still work.
- 496da1c: A `crossChainPermits` entry that omits `settlementLayers` (or passes `[]`) now means `settlementLayers: 'all'` instead of `ACROSS`.

  - It resolves against the orchestrator's `GET /chains` and the clock at creation, as `'all'` does, so build such sessions with `sdk.createSession` and store the result.
  - Offline `toSession`: pass `options.settlement` (the catalog from `GET /chains`; `toSession` now also accepts `wrappedNativeToken`, as `validateSession` does) or name the layers. Without either it throws `SETTLEMENT_CATALOG_MISSING`, for omitted layers and explicit `'all'` alike.
  - It is refused wherever `'all'` is refused (for example `NO_LAYER_CAN_SETTLE`), never settled through `ACROSS` instead, and reports dropped layers in `settlementCoverage.dropped`.
  - To keep the previous behaviour, pass `settlementLayers: ['ACROSS']`. A reusable session with `preClaimOps: 'none'` needs it, since `'all'` refuses that option with `PRE_CLAIM_OPS_NOT_APPLICABLE`. Otherwise the session's actions, permissionId and enable digest change.
  - A session with `fallback` keeps `ACROSS` for an omitted or empty list, since `'all'` cannot be combined with `fallback`.

- 2e7c74b: Settlement-scoped permits (`CCTP`, `OFT`, `ECO_IE`, `SAME_CHAIN_IE`, `LZ`) can opt into paying an intent's app fee and unsponsored gas with `allowFees: true` ([RHI-7884](https://linear.app/rhinestone/issue/RHI-7884)).

  - The session may then transfer the `from` token to the orchestrator's fee collector, approve the paymaster, and call the paymaster's `callbackAllowMaxAmount` for that token. Each of these calls has its own cumulative cap of 5 USD (30 USD on Ethereum mainnet), not one per session: the transfer and the approve one per `from` token, the callback one shared across tokens. So one token can pay up to about twice the cap (app fee plus gas), and N tokens up to N times the cap of app fee.
  - A fee call the layer does not already make gets its own action (UniversalActionPolicy, or ArgPolicy for a callback over several tokens); one the layer makes joins that action's ArgPolicy as an OR.
  - Every `from` token on the session's chain must be one the orchestrator serves for these layers (USD stablecoins today) and lists in `settlement.usdStablecoins` with 6 or 18 decimals (the cap is scaled to them, and all `from` tokens on the chain must share them), and the chain's `GET /chains` `settlement.fees` block must be present, so create the session with `sdk.createSession`.
  - The orchestrator sizes the paymaster approve and callback at the refund ceiling (about 1.8x the gas estimate) and the fee transfer at the full fee, so an intent whose ceiling or fee exceeds the remaining cap (e.g. Ethereum mainnet gas at high prices, an app fee over the cap, or a reusable session that has used its budget) is refused: it fails closed.
  - Off by default: sessions without `allowFees` are unchanged. Permit2-layer permits take `allowFees` too (see the scoped Permit2 sessions entry).

- 3ec69a4: Add an opt-in `stableFloor` to the `swap` session scope (RHI-7883). With it on, every Rhinestone Swapper call must deliver at least `ceil(maxTotal × (1 − slippage))` of the buy token on an exact-in swap, and `ceil(maxTotal ÷ (1 + slippage))` on an exact-out one (where the tolerance bounds the input) (default 100 bps, or `{ maxSlippageBps }`) while selling at most `maxTotal`, so no call executes below floor/cap. A session key can no longer zero the Swapper's output bound and route the input away — closing RHI-7870 for sessions that opt in. Total sell is bounded by the approve's cumulative spending limit (`maxTotal`) plus any allowance to the Swapper proxy that existed before the session.

  It requires one sell token, `sell.maxTotal`, both tokens among the USD stablecoins (6 or 18 decimals) the orchestrator serves for the chain (`/chains` `settlement.usdStablecoins`), and the Swapper as the only venue, so create the session with `sdk.createSession`. It refuses `signing`, `crossChainPermits`, `claimPolicies` and any other action on the sell token, Permit2 or the Swapper (an action on another contract that already holds an allowance on the sell token is not checked), and uses the strict salt so the session never shares a permissionId with an unfloored one. The floor is absolute, so a swap much smaller than `maxTotal` cannot meet it; in practice the session is single-use. Scopes without `stableFloor` are unchanged, down to the session digest.

- 667340d: Startale now defaults to v1.0.1, which deploys a new implementation and factory and changes the default counterfactual account address. Existing v1.0.0 accounts must opt back in with `account: { type: 'startale', version: '1.0.0' }` to keep their address — including accounts passed as address-only `initData`, whose typed-data signatures would otherwise target the v1.0.1 domain. Accounts restored from `initData` with a `factory` keep their version automatically.
- 571c883: Add `validUntil` / `validAfter` to a session's `swap` scope, so the session swaps only inside that window: `validAfter <= t < validUntil` in whole seconds, with `validAfter` rounded up, as for a `crossChainPermits` window. The window covers each sell token's `approve` and each venue's swap call, and nothing else in the session; a permit window on the same session stays on the permit's actions.

  A windowed swap scope is salted as with `saltMode: 'strict'` (unless `saltMode` is `'v1'`), so it gets its own permissionId and is never folded into another enabled session. It is refused like a permit window: `VALID_UNTIL_NOT_IN_FUTURE`, `VALID_AFTER_INVALID`, `VALID_AFTER_EXCEEDS_VALID_UNTIL`, and `TIME_FRAME_POLICY_UNAVAILABLE` on a chain without the TimeFramePolicy unless `policyAddresses.timeFrame` is set. A swap scope without a window builds the same session as before.

- 5549e23: Default `policyAddresses.universalActionCopies` to the three deployed UniversalActionPolicy copies for a session with an IntentExecutor-layer `crossChainPermits` entry on a chain that has them: Ethereum, Optimism, BNB Chain, Gnosis, Unichain, Polygon, Monad, Sonic, X Layer, World Chain, HyperEVM, Soneium, Ronin, Robinhood Chain, Arc, Base, Plasma, Arbitrum, Ink, Katana and the Sepolia, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia and Plasma testnets. This changes the encoding, and so the permission id and digest, of such a session whose ArgPolicy now splits (an LZ permit, for example): it writes less storage at enable, and a session already enabled under the old encoding is a different session. Set `universalActionCopies: []` to keep the previous encoding.

  - Every other session encodes as before, as do sessions on other chains or with `argPolicy` or `universalAction` overridden. A session with an IntentExecutor-layer permit and `saltMode: 'v1'` is refused, as every settlement-scoped session is.
  - An explicit `universalActionCopies` is used as given.
  - `sdk.createSession` checks the defaulted copies' code as it does configured ones.

- 1eb5027: Add `SessionDefinition.policyAddresses.universalActionCopies`: optional extra UniversalActionPolicy deployments let an all-AND ArgPolicy split across them (RHI-8045). When it is set, an action's ArgPolicy whose expression only ANDs rules is installed as UniversalActionPolicy configs of up to 16 rules each, in evaluation order, one per deployment, with the same `valueLimitPerUse` on each. This can lower the storage written at enable. An action keeps its ArgPolicy if its expression has an `or` or a `not`, or if there are fewer free deployments than configs. Off until configured: with no copies, sessions encode as before.

  - Each copy must be a deployment of the canonical UniversalActionPolicy bytecode on the session's chain. A copy that repeats `universalAction`, another copy, or any other policy address the SDK uses throws.
  - `sdk.createSession` reads the code at `universalAction` and at each copy on the session's chain, and throws unless they match.
  - `saltMode: 'v1'` with copies throws: a 1.x session has no split policies to reproduce.

- 6be46b6: Add `sdk.validateSession(definition)`, a dry run of `createSession`. It returns every refusal `createSession` would throw for a session definition, not only the first, and returns `{ refusals, access?, settlementCoverage? }` (typed `SessionValidation`) instead of throwing a refusal.

  - It makes the same reads as `createSession` (the UniversalActionPolicy copies' code, then `GET /chains`) and runs the same resolution. The first refusal is the error `createSession` throws, with the same message, and `refusals` is empty only when `createSession` succeeds. A failed read throws, as it does in `createSession`.
  - Each refusal is `{ code, message, permitIndex?, layer?, chainId?, leg? }`. Problems that do not depend on each other are all reported. Within one settlement layer, only the first problem is reported.
  - When nothing is refused, `access` and `settlementCoverage` are what the created session carries: whether it keeps the wildcard fallback, and which layers `settlementLayers: 'all'` dropped and why.
  - Each refusal's `code` is stable. The codes are listed, with what each means, in `SESSION_REFUSAL_CODES`, exported from `@rhinestone/sdk/smart-sessions`. A refusal without a code of its own has `SESSION_REFUSED`.
  - `@rhinestone/sdk/smart-sessions` also exports a standalone `validateSession(definition, { settlement, wrappedNativeToken, useDevContracts })`, which runs the same resolution without network calls, and the `SettlementCatalog`, `SettlementAddresses` and `SessionValidationOptions` types. It does not read the copies' code or check `/chains` for a wrapped-native token.
  - The `SessionValidation`, `SessionRefusal` and `SessionRefusalCode` types are exported from the package root and from `@rhinestone/sdk/smart-sessions`.

### Patch Changes

- 604fa81: Refuse a session that would carry the same ERC-1271 policy contract twice. The list is an address set and each config is keyed per `(policy, configId)`, so a repeated address stores once and keeps only the last config — the session would enforce one of the declared restrictions while reporting success for all of them. This replaces the count-based check on Permit2 claim policies, which was only incidentally correct: several declared permits collide because they share a policy contract, not because there is more than one of them. A future claim policy at a different address is unaffected.
- 29dc8c6: Harden settlement-scoped permits (RHI-7826):

  - Read `settlement.usdStablecoins` from the orchestrator's `GET /chains`, kept only when every entry is well-formed.
  - `ECO_IE` prices the delivery against the reward 1:1, rescaled between the two tokens' served decimals, so its `maxFeeBps` floor now refuses a `from` or `to` token the orchestrator does not serve as a USD stablecoin with known decimals, and refuses when `usdStablecoins` is absent.
  - `ECO_IE` refuses a `validUntil` less than 7 days ahead: the session pins Eco's reward deadline under it, and Eco quotes that deadline about 7 days out, so a shorter session could never settle.
  - An intent whose explicit `settlementLayers` filter removes every layer the session permits now throws instead of sending `{ include: [] }`.
  - `SAME_CHAIN` and `ECO` are documented as deprecated in favor of `SAME_CHAIN_IE` and `ECO_IE`.

- b2d26de: Point `PERMIT2_CLAIM_POLICY_ADDRESS` at the Permit2 claim policy's multi-chain deployment, `0x4F9FAbC867E196Ebb27E7D7FaeD8AF41B2021B0e`. The previous address existed on Base, Arbitrum and Optimism only, so a session declaring `claimPolicies` on any other chain referenced a contract with no code. The new address is deployed through yeet and is identical on every supported chain.

  Sessions already enabled against the old address keep working — the permission id does not depend on the policy address, and the old contract is still deployed on those three chains. Only newly enabled sessions use the new one.

- affb7ab: A Permit2-route permit on a session with `fallback` that sets `maxAmount` on a `from` leg now requires `oneTimeUse` (`PERMIT2_MAX_AMOUNT_REQUIRES_ONE_TIME_USE`). Set `oneTimeUse`, drop `maxAmount`, or drop `fallback`. Sessions without `maxAmount`, with `oneTimeUse`, or without `fallback` are unchanged.
- 798e3a5: A Permit2-route permit (`settlementLayers: ['ACROSS']`, or any permit on a session with `fallback`) with a recipient other than the account now needs `allowRecipientNotAccount`, as IntentExecutor layers already did. Before, it resolved into a session that could not settle. It is refused with `RECIPIENT_NOT_ACCOUNT`, or `RECIPIENT_ANY_NOT_ALLOWED` for `'any'`, by `validateSession` and `createSession`. A recipient equal to the account, in any casing, still needs no opt-out.
- 83eaab3: Settlement-scoped sessions (a `crossChainPermits` entry naming an IntentExecutor layer: `CCTP`, `OFT`, `ECO_IE`, `LZ` or `SAME_CHAIN_IE`) now always get the strict salt, as `oneTimeUse` and `stableFloor` sessions already do. Without `oneTimeUse` or `saltMode: 'strict'`, such a session was salted with `zeroHash`, so it shared a permissionId with the signer's plain session and `enable` merged the two, leaving the plain session's actions authorised beside the scoped ones.

  - A settlement-scoped session built without `oneTimeUse` or `saltMode` (or with `saltMode: 'none'`) moves its permissionId and digest, and must be enabled again.
  - One that already had `oneTimeUse` or `saltMode: 'strict'` is unchanged.
  - `saltMode: 'v1'` on a settlement-scoped session now throws.
  - Sessions without a settlement scope are unchanged.

- b8c4cee: Same-chain intents on a session with a `crossChainPermits` entry and a `swap` scope are now signed against the swap scope instead of being refused: they are funded only from the swap's sell tokens on the session's chain, each capped at `sell.maxTotal` (with several sell tokens the on-chain cap is shared, so a plan spending more than it across them reverts), and an explicit `sourceAssets` can only narrow that. A session without a `swap` scope still refuses them.

## 2.16.4

### Patch Changes

- 82f3786: Scope `fynd()` swap sessions to fynd's TychoRouter V3 deployment and its `singleSwap` calldata, in both the direct router call and the Swapper-wrapped one. The router they previously named is paused and fynd no longer fills through it.

  A session built with `fynd()` on an earlier version authorises only that router and its old argument layout, so it cannot execute fynd swaps. Re-create it with this version and enable it again.

## 2.16.3

### Patch Changes

- e74dab1: Restore production SDK reference updates as an independent post-publication workflow.

## 2.16.2

### Patch Changes

- d0184b3: In JWT auth mode, send the intent extension token with the quote instead of the submission, so a sponsored quote is admitted and priced under the integrator's sponsorship grant.

  - `getIntentExtensionToken` now runs on every sponsored `prepareTransaction`, including quotes that are never submitted, adding one round trip to your backend before each sponsored quote.
  - A sponsorship denial (`SponsorshipDeniedError`) or a failing `getIntentExtensionToken` now surfaces from `prepareTransaction` rather than `submitTransaction`.
  - A sponsored mainnet quote is now checked against the project's sponsor record, caps and balance, which quotes previously skipped.

## 2.16.1

### Patch Changes

- f21abe2: Stop sending the placeholder `x-api-key: jwt` header alongside the bearer credential in `experimental_jwt` auth mode. Requests now present only the access token, which every Rhinestone orchestrator environment accepts.

## 2.16.0

### Minor Changes

- 2c1fd06: Expose the HyperCore trade outcome as `hyperCore` (the new `IntentHyperCoreResult` type) on intent status and on a failed intent's `IntentFailedError` context, so integrators can tell a refused trade from a partial one, whose placed orders a retry would send twice.

## 2.15.1

### Patch Changes

- 78562bb: `saltMode: 'v1'` now reproduces a 1.x digest in two cases it missed.

  With a spend cap: the cap adds a second policy to the approve action, and it
  was emitted ahead of the params policy rather than after it as 1.x does.

  On dev: 1.x salts a swap-scoped session over its production venues whatever
  environment it was built for, so the permissionId does not move between them.
  The salt now does the same; the session keeps its dev venues.

  Uncapped production scopes were already correct and are unchanged, as is any
  session that does not set `saltMode`.

## 2.15.0

### Minor Changes

- fbca7e9: Add `saltMode` to opt a restricted session's permissionId into a salt.

  Additive and off by default: without it the salt stays `zeroHash`, so every existing session's digest, permissionId and stored signature are unchanged.

  A session's permissionId is `keccak(sessionValidator, sessionValidatorInitData, salt)` — the actions are not in it. On-chain, `enable` ADDS to the policy list rather than replacing it (`ConfigLibV2.enable`), so two restricted sessions for one signer that share a permissionId union: the earlier session's actions stay authorised and the later restriction buys nothing, with no error. A caller can believe a key is limited to one swap venue while a previously enabled wildcard action is still live.

  - `'none'` (default) — `zeroHash`, today's behaviour.
  - `'v1'` — hashes the actions in build order, matching the 1.x derivation, so a session built on 1.x can be rebuilt here.
  - `'strict'` — hashes every field enabled under the permissionId (actions, ERC-1271 policies, ERC-7739 content, claim policies), actions in canonical order.

  Unrestricted sessions stay on `zeroHash` in every mode: there is only one shape of them, so two for the same signer are the same session and sharing a permissionId is correct.

## 2.14.0

### Minor Changes

- 23ab2f9: Allow an optional `maxSpend` alongside a pinned 0x Settler, and export `ZEROX_CHAIN_IDS` from `@rhinestone/sdk/smart-sessions`.

  `ZeroExPinnedOptions.maxSpend` was typed `never`, so pinning the Settler and setting a spend ceiling were mutually exclusive. The pin is what bounds a compromised session key — a cap is mandatory only on the `anySettler` variant, where it is the sole bound — but a caller can still want a ceiling on its own terms, and `scopeZeroEx` already applied `ctx.cap` on both paths.

  `ZEROX_CHAIN_IDS` joins `FYND_CHAIN_IDS`: resolving a Settler means knowing which chains 0x serves first, and the alternative is duplicating the list downstream where it drifts.

## 2.13.0

### Minor Changes

- 188d525: Export `FYND_CHAIN_IDS` and its `FyndChainId` type from `@rhinestone/sdk/smart-sessions`.

  A caller composing venues has to know which chains fynd can serve — `scopeFynd` throws on the rest, and `fynd()` takes no chain, so the set could not be tested for. The only recourse was to copy the list, which then drifts as fynd gains chains.

## 2.12.0

### Minor Changes

- c140380: `swap.sell` accepts `tokens` as well as `token`, so one session can authorise spending any of several tokens — for an account that may receive whichever the sender chooses. Each token gets its own approve permission, and the swap actions accept any of them.

  Passing a single `token` is unchanged: same permissions, same actions, same session digest, so sessions already signed against it keep working. An empty `tokens` list, a repeated token, or a sell token that is also the buy token are rejected.

## 2.11.0

### Minor Changes

- 68f7df4: Surface the bridge refund on an intent's status, so a failed cross-chain intent can say where the funds went back to.

  The orchestrator reports `refunds: [{ chain, txHash }]` when a settlement layer returns the funds to the account instead of delivering them, but the SDK dropped it: `mapIntentStatusFromWire` builds an explicit object and the field was not among its keys. It now reaches `IntentStatus`, `TransactionStatus` and the value `waitForExecution` resolves to, with the new `IntentRefund` type exported.

  It also rides `IntentFailedError.context`, which is the only path it has for the case it exists to answer: a refunded intent is still `FAILED`, so `waitForExecution` throws rather than returning a status, and a caller on that path would otherwise never see the refund.

  `FailureReason` also gains the three values the orchestrator has always been able to serialise but the published union omitted — `BRIDGE_REFUNDED`, `BRIDGE_TIMEOUT` and `DISPATCH_FAILED`. `BRIDGE_REFUNDED` is the per-operation half of `refunds`, so without it a consumer could not branch on the very thing this release surfaces without a cast.

  The key stays **absent** when the orchestrator knows of no refund, rather than defaulting to `[]`. A refund is recorded only where a layer evidences it with a transaction, so presence is a fact and absence is not a claim — defaulting would report that funds were kept on an intent we simply have no refund for yet.

## 2.10.0

### Minor Changes

- 4e2591d: Support HyperCore trading from an intent. A transaction to `hyperCorePerp` or `hyperCoreSpot` now takes a `hyperCore.action`, and a new `@rhinestone/sdk/hypercore` subpath builds it.

  - `hyperCore: { openPerp: { asset, direction, notionalUsd } }` opens a perpetual position. `prepareTransaction` resolves it against Hyperliquid — the asset index, the mark, and the price and size grids — and builds a marketable IOC.
  - `hyperCore: { closePerp: { asset } }` closes one, reduce-only and sized from the account's open position, which it reads for you.
  - `hyperCore: { action }` passes a Hyperliquid L1 action through verbatim. `HyperCoreAction` types all seven — `order`, `cancel`, `cancelByCloid`, `modify`, `batchModify`, `updateLeverage`, `updateIsolatedMargin`.
  - `getPerpMarket`, `getPerpMarkets`, `getPerpPosition`, and `getPerpPositions` on `@rhinestone/sdk/hypercore` read Hyperliquid's public info endpoint, for the questions asked before sending a transaction: which markets exist, what leverage one allows, whether there is a position to close.
  - `hyperliquid: { apiUrl, fetch }` on the SDK config points every one of those reads somewhere else.
  - `HyperCoreError`, `UnknownPerpAssetError`, `PerpOrderTooSmallError`, `NoOpenPerpPositionError`, and `HyperCoreInfoRequestError` are exported from `/errors` with an `isHyperCoreError` guard.

  An action that needs collateral pairs with `tokenRequests` that deliver it; a close, cancel, or leverage change rides a transaction that requests no tokens.

### Patch Changes

- 9ea61e3: Accept a chain-agnostic origin payload, so an intent whose legs are covered by one signature can be signed.

  The orchestrator can serve a multi-leg IntentExecutor bundle as a single `MultiChainOps` payload: the contract verifies it with `_hashTypedDataSansChainId`, so the EIP-712 domain deliberately carries no `chainId` and each leg's chain lives in its own `ChainOps` leaf. Reading the chain off the domain therefore produced `Invalid chain id: NaN` and failed the intent — on this path, after the user had already approved it. The chain now falls back to the leaves, and a payload naming no chain at all throws with the payload's type instead of coercing to `NaN`.

## 2.9.0

### Minor Changes

- 4d62a02: Map the `LZ` bridge fill the orchestrator now returns for the LayerZero Value Transfer settlement layer, exposing `quoteId`, `dstChainKey` and `routeTypes` on `Quote.bridgeFill`, and accept `'LZ'` in the `settlementLayers` include/exclude filter.

  A bridge fill whose type this SDK version predates no longer throws. It is a delivery-tracking handle rather than part of the signed intent, so an unrecognised one now leaves the route untracked — the same shape as a settlement layer that publishes no handle at all — instead of failing the whole quote.

## 2.8.0

### Minor Changes

- 5d83aaa: Support Stellar as a destination chain through the new `stellarMainnet` descriptor, so `targetChain: stellarMainnet` addresses `stellar:pubnet` the way `solanaMainnet` and `tronMainnet` already do. Recipients are `G…` account strkeys and token requests take the asset's Soroban contract (`C…`), both passed through unchanged for the orchestrator to validate.

## 2.7.0

### Minor Changes

- 1519ab5: Support weighted Quorum Signer validators through `owners: { type: 'quorum', module, thresholdWeight, owners }`, including installation data, raw digest signing, packed weighted signatures, cross-chain Merkle-root signing for multi-origin intents, UserOperation stub signatures, and public headless ERC-1271 helpers under `@rhinestone/sdk/signing/quorum`.

## 2.6.0

### Minor Changes

- d43c118: Add `quoters` to `Transaction`, restricting which swap venues may serve an intent's swaps, along with the public `SwapQuoter` and `SwapQuoterFilter` types. A session scoped to specific venues via `swap.via` now derives the matching pin automatically, so the venue is stated once; across a per-chain session set the pin is the intersection of every session's venues.
- f8bdb99: Restrict a smart session to swapping one token for another through named venues. `SessionDefinition` gains `swap`, which compiles to a scoped approve plus one scoped action per venue and drops the wildcard intent-execution fallback, so the session key can only run those calls.

  - Name venues, not addresses: `swap: { sell, buy, to, via: [zeroEx({ settler })] }`. Router addresses, selectors and calldata offsets stay inside the SDK. `via` is narrowed by the session's chain, so naming a venue that isn't deployed there is a compile error.
  - Naming a venue authorises every call shape it can arrive in — for `zeroEx()` that is the direct `AllowanceHolder.exec` call and the Rhinestone-Swapper-wrapped one, and for `fynd()` the Tycho router call and its wrapped form. Which one the orchestrator emits depends on the swap's direction and the winning quoter, decided after the session is signed, so there is no option to narrow it. `rhinestoneSwap()` is the default and leaves the aggregator unpinned.
  - `resolveZeroExSettler(client)` reads 0x's current Settler from its on-chain registry. 0x redeploys the Settler regularly, so there is no bundled default; resolve once and pin at session-enable time.
  - `SessionDefinition` also gains `restrictToActions` (the general-purpose primitive `swap` is built on) and `actions` (raw scoped actions for calls the ABI-name `permissions` sugar can't address). A restricted session defaults its ERC-1271 signing surface to disabled, so a session key limited to swap/approve cannot sign approvals off-chain.

  Fixes three defects in the ABI-driven `permissions` sugar, each of which produced silently-wrong on-chain policies rather than errors:

  - Calldata offsets assumed every parameter occupies one head word, so any parameter following a static tuple or fixed-size array was scoped against unrelated bytes. Offsets are now the sum of ABI head sizes.
  - Array parameters (`uint256[]`, `bytes4[]`) typed as constrainable, compiled, then failed at runtime. They are now rejected at the type level.
  - `inRange` was offered but could not express two bounds. Replaced with `{ min, max }`, which compiles to `AND(>=, <=)`.

## 2.5.0

### Minor Changes

- b0bd0d7: Expose Eco solver-network delivery metadata through the public `BridgeFill` type. Built-in Smart Session settlement-layer permissions remain limited to legacy Standard ECO until route-aware solver-network authorization is available.

### Patch Changes

- 17423a8: Fix multi-factor owner sets with a passkey or ENS factor, which previously failed every signature with `InvalidSignature()`. Such factors are now configured and signed in the format the sub-validator's stateless validation path requires. Their derived addresses change, and the order passkey credentials are listed in inside a factor no longer affects the address; ECDSA-only multi-factor accounts are unchanged. An already-deployed account is repaired by re-setting the offending factor with `mfa.setSubValidator`. Note that a nested ENS factor does not enforce owner expiry, because the validator's stateless path deliberately skips that check.

## 2.4.0

### Minor Changes

- d01c7ad: Add an opt-in registry-free multi-factor validator address and allow MFA account actions to target a selected multi-factor module. Existing MFA configurations and actions continue to use the legacy module by default.

## 2.3.0

### Minor Changes

- b530612: Add disabled, unrestricted, and EIP-712 domain-and-schema-scoped Smart Session signing capabilities, with optional session-wide validity windows. Existing sessions remain unrestricted when signing configuration is omitted; scoped direct signing is rejected until safe ERC-7739 emission is available.

## 2.2.5

### Patch Changes

- 42e17a5: Order ENS owners, WebAuthn credential IDs, and EIP-712 type dependencies by value instead of host collation, so the same account config derives the same address and multi-passkey signatures stay valid on locales such as `da`, `nb`, and `cy`.
- ffeba51: Derive multi-passkey account addresses that can actually be deployed. Credentials are now installed in a canonical, order-independent order, and the account salt is deterministically searched (starting from the salt you passed) until the derived address satisfies the WebAuthn validator's ascending credential ID rule. Passkey sets that cannot be installed — duplicates, or more than six passkeys at deployment — throw `PasskeyConfigurationNotInstallableError` instead of returning an unusable address; add the remaining passkeys after deployment with `passkeys.addOwner`.

  Single-passkey, ECDSA, ENS, multi-factor and every non-passkey configuration keep the exact address they derive today. A multi-passkey configuration that is deployable today but was passed in a non-canonical order derives a new address; to keep the existing account, pin its `initData` instead of letting the SDK re-derive it.

- e969a72: Derive one Safe account address regardless of the order its owners were listed in. A Safe with two or more ECDSA or ENS owners used to derive a different address for every ordering, because the owner list is baked into the Safe `setup` call that determines the account address. Owners are now installed in canonical, value-based order.

  A multi-owner Safe that was previously passed in a non-canonical order derives a new address; to keep the existing account, pin its `initData` instead of letting the SDK re-derive it. Single-owner, passkey and multi-factor Safe configurations, every other account type, and the legacy v0 reconstruction path keep the exact address they derive today.

- 105f058: Sign session ERC-1271 typed data in direct (notarized) mode. Signing typed data with a session previously produced an ERC-7739 nested signature that external ERC-1271 verifiers could not resolve, so `isValidSignature` checks against those signatures failed. Session typed-data signing now emits the same direct-mode, account-bound signature that session message signing already produced, so external verifiers resolve the session validator directly. Non-session signing and the account-native ERC-7739 paths are unchanged.

## 2.2.4

### Patch Changes

- 76e6e86: Submit EIP-7702 any-chain authorizations with the numeric zero sentinel while encoding concrete chain IDs as eip155 identifiers.

## 2.2.3

### Patch Changes

- 2a25392: Type orchestrator quote and split request adapters against generated wire contracts.

## 2.2.2

### Patch Changes

- 8b4d488: HyperCore is addressed by delivery venue.

  A HyperCore deposit credits one of two accounts that are not interchangeable — the recipient's spot wallet, or the default perp dex's margin account. The wrong one is invisible: the intent completes, the fill succeeds, and only the recipient's Core state shows where the money went.

  The venue is therefore part of the destination, not a flag on a token request.

  ```diff
  - import { hyperCoreMainnet } from '@rhinestone/sdk'
  + import { hyperCoreSpot } from '@rhinestone/sdk'

    await account.sendTransaction({
  -   targetChain: hyperCoreMainnet,
  -   tokenRequests: [{ address: usdc, amount, balance: 'spot' }],
  +   targetChain: hyperCoreSpot,
  +   tokenRequests: [{ address: usdc, amount }],
      recipient,
    })
  ```

  Migration, if you addressed HyperCore:

  - `hyperCoreMainnet` → **`hyperCoreSpot`** (the recipient's spot wallet) or **`hyperCorePerp`** (the default perp dex's margin account). Pick deliberately; `hyperCoreMainnet` defaulted to perp, so callers who assumed spot were silently credited to perp margin — which needs an EOA signature to move back out of.
  - `HyperCoreCaip2ChainId` is now `'hypercore:spot' | 'hypercore:perp'`. `'hypercore:mainnet'` is not accepted as a target: it named the Core L1 without naming an account, and aliasing it to either venue would silently pick one. Upstream it remains an origin-only chain — deposits arrive from the Core L1 without naming a venue — and the orchestrator refuses it as a destination by its declared registry role.

  Released as a **patch**. Only one removed symbol was ever published: `hyperCoreMainnet`. `tokenRequests[].balance` and the `HyperCoreBalance` type existed solely in a `@dev` snapshot and are absent from every released version, so nothing on npm could depend on them. HyperCore has never carried an external client's intent either, so the practical blast radius of the one real removal is nil — and a caller who does reference it gets a compile error naming its replacement, not a silent behaviour change.

  Requires an orchestrator that accepts the venue ids (shared-configs ≥ 1.11.0 on the server side). That is a runtime coupling, not a dependency of this package: the SDK bundles no chain data and reads the supported-chain set from `GET /chains`, so pointing this version at an older orchestrator fails when the intent is submitted rather than at build time.

## 2.2.1

### Patch Changes

- 1016fb8: Exclude non-EIP-155 catalog chains from portfolio requests so EVM balance reads continue to work when the runtime catalog includes other namespaces.
- 4044d73: Remove the Solady runtime dependency while preserving byte-compatible FastLZ encoding for Smart Sessions enable signatures.
- 66648f9: Prevent unusable WebAuthn signatures by deriving client-data offsets and normalizing P-256 signatures to low-s before packing. Supplied `challengeIndex` and `typeIndex` values remain accepted for compatibility but no longer override the values derived from `clientDataJSON`.

## 2.2.0

### Minor Changes

- 7a9ca68: Expose `SerializedIntentInput`, the wire form of `IntentInput` with `bigint` fields as decimal strings. Sponsorship servers can type their request body with it instead of re-deriving the mapping, and it now types `PreparedTransactionData.intentInput` and the JWT auth `getIntentExtensionToken` callback in place of `unknown`.

## 2.1.0

### Minor Changes

- ea3a4a2: Expose each quote fee category's `sponsored` flag and the `sponsorSurcharge` category.
- df9efbf: Bring back social recovery. Add `recovery` to the account config, a `guardians` signer set for UserOperations, and the `@rhinestone/sdk/actions/recovery` subpath with `enable`, `recoverEcdsaOwnership`, and `recoverPasskeyOwnership`.

  Recovery calls are ordered additions, then threshold, then removals. The previous implementation emitted the threshold change first and removed passkey credentials before adding them, which reverted with `InvalidThreshold` when raising the threshold and `CannotRemoveCredential` when rotating a 1-of-1 passkey account.

  Guardians only sign UserOperations — the validator rejects ERC-1271 signatures and intents — and each returned call must be sent as its own UserOperation.

  `recoverPasskeyOwnership` takes `currentCredentials`, the account's complete current credential set. Passing only the credentials being replaced makes it re-add an installed credential, which reverts with `CredentialAlreadyExists`.

  `recovery` is also honored when an account config is used as an intent recipient, so recipient deployment installs the validator and derives the matching address.

### Patch Changes

- b0d694f: Make ECDSA recovery and owner reads use the configured Ownable validator instead of always targeting the canonical deployment.
- e8a492c: Make passkey recovery read and update the account's configured WebAuthn validator.
- 11ce775: Fix `recoverPasskeyOwnership` deriving the wrong coordinates from an uncompressed public key. Keys in the 65-byte SEC1 form carry an `0x04` prefix, and slicing from byte 0 shifted both `pubKeyX` and `pubKeyY`, so recovery installed an unusable credential and then removed the working one. Coordinates now come from the shared WebAuthn parser.

## 2.0.0

### Major Changes

- f3f4fb2: SDK now targets the orchestrator's `2026-04.blanc` API version. The schema and behavior changes that come with it are detailed in the other entries in this release.
- 766128e: Drop the public `signPermit2Batch` and `signPermit2Sequential` helpers, along with the `MultiChainPermit2Config`, `MultiChainPermit2Result`, and `BatchPermit2Result` types.
- 4391772: `PortfolioToken` drops the top-level `decimals` field and the `balances` aggregate. `decimals` now lives on each `chains[]` entry.
- edd83bf: `RhinestoneSDK.getIntentStatus(intentId)` now takes a `string` (was `bigint`).
- 839f2a6: Drop the `lockFunds` transaction option and the `emissaryConfig` field on the orchestrator `Account` type. Both referenced the compact-bound flow that no longer applies.
- 972f72a: Drop the `session` param from `account.deploy(chain, params)`. It was a no-op — sessions cannot be enabled at deployment time. Enable a session after deployment with `experimental_signEnableSession` and the smart-sessions actions.
- 0521724: Drop the `experimental_` prefix from the smart-session API now that it's stable. Rename across your integration:

  - Config: `experimental_sessions` → `sessions`
  - Signer set: `type: 'experimental_session'` → `type: 'session'`
  - Account methods: `experimental_getSessionDetails` → `getSessionDetails`, `experimental_isSessionEnabled` → `isSessionEnabled`, `experimental_signEnableSession` → `signEnableSession`
  - `@rhinestone/sdk/actions/smart-sessions` actions: `experimental_enable` → `enable`, `experimental_disable` → `disable`, `experimental_enableSession` → `enableSession`, `experimental_disableSession` → `disableSession`

- 522d3df: Remove `passport` account support. `account.type: 'passport'` is no longer accepted, and the `PassportAccount` type and the `passport` member of `AccountType` / `AccountProviderConfig` are removed.
- 522d3df: Drop the `acceptsPreconfirmations` parameter from `account.waitForExecution`. The method no longer treats `PRECONFIRMED` as terminal.
- 522d3df: Drop the `account.sendTransaction(transaction)` shortcut. Use the `prepareTransaction` → `signTransaction` → `submitTransaction` flow instead.
- b778335: Nexus now defaults to v1.2.1. This changes the default counterfactual account address; opt back into the previous implementation with `account: { type: 'nexus', version: '1.2.0' }`.
- 0149a68: Normalize public datetime inputs to accept `Date`.

  - `PermissionFunctionConfig.validUntil` / `validAfter` now accept `Date` only (dropped the raw millisecond-epoch `number`).
  - `CrossChainPermissionInput.fillDeadline` bounds (`min` / `max`) now accept `Date` (dropped the unix-seconds `bigint`).
  - Reshape `ENSValidatorConfig`: replace the parallel `accounts` + `ownerExpirations` arrays with a single `owners: { account: Account; expiration?: Date }[]`. Omit `expiration` for an owner that never expires (previously the `maxUint48` sentinel).
  - `CrossChainPermit` is no longer marked `@internal` — the resolved permit shape (unix-seconds `bigint`) is now a documented low-level escape hatch.

- 26ef7ce: Align SDK with the orchestrator's new operation model (blanc API version).

  - `IntentStatus` reduced to 3 states: `PENDING`, `COMPLETED`, `FAILED`. Removed: `PRECONFIRMED`, `CLAIMED`, `FILLED`, `EXPIRED`.
  - `IntentOpStatus` response shape replaced with flat per-chain `operations[]`. Removed: `claims`, `fillTransactionHash`, `fillTimestamp`, `destinationChainId`.
  - `TransactionStatus` (returned by `waitForExecution`) now contains `status`, `accountAddress`, and `operations[]` instead of `fill` / `claims`.
  - `waitForExecution` no longer accepts the `acceptsPreconfirmations` parameter.
  - Removed types: `Claim`, `ClaimStatus`.
  - Removed status constants: `INTENT_STATUS_EXPIRED`, `INTENT_STATUS_FILLED`, `INTENT_STATUS_PRECONFIRMED`, `INTENT_STATUS_CLAIMED`.

- edeae4c: `PortfolioToken.chains[]` replaces the `{ locked, unlocked }` balance pair with a single `amount: bigint`.
- fa7492d: Clean up the `./errors` surface.

  - Remove `ExistingEip7702AccountsNotSupportedError`, `SmartSessionsNotEnabledError`, and `SessionChainRequiredError`. None were ever thrown; the "session needs a chain" rule the latter described is enforced at the type level (`chain` is required on `SessionDefinition` and `Session`).
  - Export `DefaultValidatorAlreadyInitializedError`, `ModuleInstallationNotSupportedError`, `EoaSigningNotSupportedError`, `EoaSigningMethodNotConfiguredError`, `OwnersFieldRequiredError`, and `Eip7702InitSignatureRequiredError`, which are thrown by the SDK but were previously not catchable by type.

- 6398613: `RhinestoneAccount.getTransactionMessages` now surfaces the optional `targetExecution` typed data alongside the existing `intent` and `compact` messages.
- f7c2de0: - `prepareTransaction` returns `quotes: { best, all }` instead of `quote`.
  - `signTransaction(prepared, { intentId })` lets callers sign a non-default quote from `prepared.quotes.all`.
  - `getTransactionMessages(prepared, { intentId })` accepts the same selection so external signers see the route `signTransaction` will sign.
  - `SignedTransactionData.quote` is the selected quote.
  - `intentId` is required on the options argument; pass an id from `prepared.quotes.all` or omit options entirely to sign the recommended quote.
- 8e02b11: Remove the top-level `createRhinestoneAccount` export. Construct accounts through `new RhinestoneSDK(config).createAccount(...)` instead.
- c87e09e: Remove the `feeAsset` transaction option. The orchestrator never honored it — the corresponding `feeToken` field was reserved with no effect — so choosing an ERC-20 fee asset was a no-op. Drop `feeAsset` from your `prepareTransaction` calls; it has no replacement until the feature actually ships.
- a5bded7: Drop the unused `feeToken` field from the `Cost` response and remove the public `FeeToken` type. The orchestrator never populated this field.
- fa7d3a5: Remove the legacy social-recovery surface:

  - Remove the `@rhinestone/sdk/actions/recovery` subpackage (`enable`, `recoverEcdsaOwnership`, `recoverPasskeyOwnership`).
  - Remove the `recovery` field from `RhinestoneAccountConfig` and the `Recovery` type.
  - Remove the `guardians` signer (`GuardiansSignerSet`) from `SignerSet`.
  - Remove `SignerNotSupportedError` — it only guarded the guardian path.

- 487b93e: Remove `verifyExecutions` from the public session signer API. It's now derived automatically per chain.
- df690eb: Require token **addresses** (not symbols) for all token inputs — `tokenRequests`, `CalldataInput.to`, `ExactInputConfig`, `SimpleTokenList`, and cross-chain permit legs (`from`/`to`). Token symbols (`'USDC'`, `'WETH'`, …) are no longer accepted; pass the token's address for the target chain. This removes the SDK's per-chain symbol→address resolution — the first step of dropping the bundled `@rhinestone/shared-configs` chain data so new chains no longer require an SDK release.
- 420cb4b: Read chain data at runtime from the orchestrator instead of bundling it. The SDK no longer depends on `@rhinestone/shared-configs`: the supported-chain set, per-chain tokens, and the wrapped-native token are fetched (once, lazily, and cached) from the orchestrator's `GET /chains`, and `Chain` objects come from `viem`. A new chain no longer requires an SDK release.

  Breaking changes:

  - **`SupportedChain` is now `number`** (open) rather than a closed union of chain ids.
  - **New `RhinestoneSDK.createSession(definition)`** (`sdk.createSession(...)`) — resolves the chain's wrapped-native token from `/chains` and permits native-wrapping automatically. It is project-scoped (needs the API key, not an account). The standalone `toSession(definition, options)` is now pure: pass `options.wrappedNativeToken` to opt into the native-wrap action (otherwise it is omitted).
  - **Removed the `alchemy` provider type.** Supply RPC URLs yourself via `provider: { type: 'custom', urls: { [chainId]: url } }`, or omit `provider` to use viem's default transport.
  - **Removed the token-registry helpers** `getWethAddress`, `getTokenSymbol`, and `isTokenAddressSupported`. Fetch equivalent data from the orchestrator's `/chains` endpoint.

  The signed Permit2 arbiter allow-set stays bundled (it must remain client-trusted), now as a small inlined constant rather than read from shared-configs.

  Requires an orchestrator that returns `wrappedNativeToken` on `/chains`.

- 3f6adba: Replace `Session.actions` with `toSession({ permissions, claimPolicies })`, an ABI-driven session definition shape (`{ abi, address, functions }`) that resolves to a low-level `Session`. Function selectors and calldata offsets are derived from the ABI, parameter value types are checked against ABI input types, and Permit2 claim policies use chain-aware fields that resolve to the internal onchain schema.
- 46a197a: `Transaction.settlementLayers` is now `{ include: SettlementLayer[] } | { exclude: SettlementLayer[] }` — you can blacklist specific layers without enumerating every other one.
- 767c425: Remove the top-level `appFee` leg from quote routes. The orchestrator now charges the whole-intent app fee in a single token, so the concrete leg lives in signed metadata rather than on the route response. `Quote.appFee` and the `AppFee` type are removed; the app fee is available as `quote.cost.fees.breakdown.app.usd`. Requesting an app fee via `options.appFees` (type `AppFeeRate`) is unchanged.
- 8cec964: Update SmartSession action policy singleton addresses to the new canonical V2 deployments (`SudoPolicy`, `UniversalActionPolicy`, `UsageLimitPolicy`, `ValueLimitPolicy`, `TimeFramePolicy`, `ERC20SpendingLimitPolicy`) and add `ArgPolicy` support for expression-tree rules. Sessions enabled against the previous policy contracts are not compatible with newly encoded session data and need re-enabling, or per-session opt-in to the old addresses via `SessionDefinition.policyAddresses`.

  - Add the `arg-policy` policy variant (`ArgPolicyExpression` AST with `rule` / `not` / `and` / `or` nodes) for action rules that need disjunction or negation. `universal-action` stays available for plain AND-of-rules.
  - Extend the `permissions` builder used by `toSession`: `params` constraints accept `{ anyOf: [v1, v2, ...] }` to allowlist values (compiles to `arg-policy`); per-function sugar fields `maxUses`, `validUntil`, `validAfter`, `valueLimit`, and `spendingLimit` map 1:1 to their policy types, with `valueLimit` type-gated to `payable` functions and `spendingLimit` type-gated to ERC-20 transfer-shaped ABIs.
  - Remove the `permissions.functions.*.policies` escape hatch. Use the typed permission fields instead; stale runtime callers that still provide `policies` now throw instead of silently dropping guards.
  - Add `SessionDefinition.policyAddresses` — a partial override map (`sudo`, `universalAction`, `argPolicy`, `spendingLimits`, `timeFrame`, `usageLimit`, `valueLimit`) for accounts already enabled against the previous deployments. Defaults to the new V2 addresses.
  - Fix `bytesN` (N<32) reference values in `permissions`: pre-pad right so the encoded `bytes32` matches Solidity calldata alignment instead of being read at the wrong end of the word.

- 522d3df: Reshape `account.submitTransaction` to take an options bag: `submitTransaction(signed, { authorizations?, internal_dryRun? })` instead of positional `submitTransaction(signed, authorizations?, dryRun?)`.
- 97c6672: Trim the selectable account `version` values to the supported set. Nexus keeps `1.2.0` and `1.2.1` (default `1.2.1`); Kernel keeps `3.3`. Removed Nexus `1.0.2`, `rhinestone-1.0.0-beta`, and `rhinestone-1.0.0`, and Kernel `3.1` and `3.2`. If you pinned a removed version, omit `version` to use the default or pin a supported one.
- bec6a8a: Drop `protocol` and `settlement` from `FeeBreakdown`. The orchestrator only returns `gas`, `bridge`, and `swap`.
- 9bebb79: - Remove the `@rhinestone/sdk/actions/compact` subpackage entry and its helpers.
  - Remove the public `deployAccountsForOwners` helper.
  - Remove the public `checkERC20AllowanceDirect` helper.
  - Remove the public `getPermit2Address` helper.
  - Remove the `account.checkERC20Allowance` method.
  - Move `walletClientToAccount` from the package root to `@rhinestone/sdk/utils`.
  - Move `wrapParaAccount` from the package root to `@rhinestone/sdk/utils`.
  - Move `toSession` from the package root to `@rhinestone/sdk/smart-sessions`.
  - Remove the public `getSupportedTokens` helper.
  - Remove the public `getTokenAddress` helper.
  - Remove the public `getTokenDecimals` helper.
  - Remove the public `getAllSupportedChainsAndTokens` helper.
- 50c5822: Trim the `@rhinestone/sdk/smart-sessions` subpath to a curated public surface. It now exports `toSession`, the emissary addresses (`SMART_SESSION_EMISSARY_ADDRESS`, `SMART_SESSION_EMISSARY_ADDRESS_DEV`), the policy address constants (`SPENDING_LIMITS_POLICY_ADDRESS`, `TIME_FRAME_POLICY_ADDRESS`, `SUDO_POLICY_ADDRESS`, `UNIVERSAL_ACTION_POLICY_ADDRESS`, `ARG_POLICY_ADDRESS`, `USAGE_LIMIT_POLICY_ADDRESS`, `VALUE_LIMIT_POLICY_ADDRESS`, `INTENT_EXECUTION_POLICY_ADDRESS`), the fallback-target constants (`SMART_SESSIONS_FALLBACK_TARGET_FLAG`, `SMART_SESSIONS_FALLBACK_TARGET_SELECTOR_FLAG`), the low-level session helpers (`getPermissionId`, `getSessionData`, `getSessionDetails`, `isSessionEnabled`) for integrators that hand-build emissary `setConfig`/`removeConfig` calls, and the `SessionDetails` and `ChainDigest` types. Other helpers, constants, and types the subpath previously re-exported are now internal. For standard enable/disable flows, prefer the account's `experimental_*` methods and the `@rhinestone/sdk/actions/smart-sessions` actions.
- 81f4567: - ESM-only build; CJS `require('@rhinestone/sdk')` is no longer supported.
  - Internal subpath exports are dropped — use the curated entry points (`./actions/*`, `./errors`, `./utils`, `./smart-sessions`, `./jwt-server`, etc.).
- 971a298: Support custom module address overrides for the passkey and multi-factor validators via `owners.module`. Removed the inert `module` override from the ENS validator, whose address is fixed by the HCA account implementation.
- b5c30f1: - `account.waitForExecution` now polls until the intent reaches a terminal state (`COMPLETED` or `FAILED`), with no SDK-side deadline (previously capped at 3.5 minutes). The orchestrator handles expiry internally and surfaces it as `FAILED`.
  - Removed the `IntentStatusTimeoutError` class — expiry now surfaces as `IntentFailedError` (inspect `operations[].failureReason` for the cause).
  - Removed the `expiresAt` field from `TransactionResult`.
  - Narrowed `SettlementLayerFilter` to `CrossChainSettlementLayer[]` (`ACROSS | ECO | RELAY | OFT | NEAR | RHINO | CCTP`) — `SAME_CHAIN` and `INTENT_EXECUTOR` are picked by the orchestrator and were never accepted in the filter at runtime.

### Minor Changes

- e1d7c9f: Add `getAppFeeBalances` to `RhinestoneSDK`. Returns the integrator's accrued app-fee balance as USD totals (`withdrawableUsd`, `pendingUsd`), read from `GET /app-fees/balances`. The balance is project-scoped (keyed to the API key), not tied to any account. Fees are valued in USD at the moment they are collected, so the balance is unaffected by later price movements of the collected tokens.
- a415156: Add `experimental_disableSession` to the smart-sessions actions. Removes a single enabled session from an account via the emissary's `removeConfig`. The account executes the call itself, so the user authorizes it by signing the outer transaction — no separate session-digest signature is needed. Takes the resolved session and an `expires` deadline (`Date`).
- 3ae5d61: Add ENS-HCA (Hierarchical Contract Account) support
- 34d15ff: Add the Rhinestone protocol fee: a caller-set fee that always accrues to Rhinestone, collected alongside `appFees` in one batched transfer, and — unlike the app fee — sponsorable.

  - `transaction.protocolFees: { feeBps }` (0–10000) sets the rate; the `ProtocolFeeRate` type is exported.
  - `sponsored.protocolFees` (or the `sponsored: true` shorthand) charges the integrator's sponsorship balance instead of the user, without the sponsorship surcharge.
  - Quote responses surface the fee as `cost.fees.breakdown.protocol`.

- d696a3c: Export `toCrossChainPermissionInput` from `@rhinestone/sdk/smart-sessions`, which converts a resolved `CrossChainPermit` (unix-seconds deadlines, `recipientIsAccount`) back into the `CrossChainPermissionInput` shape accepted by `SessionDefinition.crossChainPermits` (`Date` deadlines, `allowRecipientNotAccount`). Useful when a permit was persisted in resolved form and has to be re-supplied as session input.
- 9731767: Make `expires` optional in `experimental_disableSession`. Omitting it disables the session with no expiry (`maxUint256` sentinel), matching the enable paths, instead of forcing callers to invent a far-future `Date`.
- a77d0f2: Expose `signIntent` on the account to sign orchestrator-prepared intents in headless flows, and export the `SignedIntentData` type.
- bfc46e0: Support a custom HCA factory via `account.factory`, which defines the deploy address and, through its implementation, the account's default validator.
- b9e37ce: Use `hypercore:mainnet` as the canonical CAIP-2 id for the HyperCore destination instead of `eip155:1337` (RHI-4560). `eip155:1337` was semantically wrong — 1337 is the Hardhat/Ganache local chain id — and the orchestrator now emits `hypercore:mainnet`.

  - `hyperCoreMainnet.caip2` is `'hypercore:mainnet'`. `fromCaip2` still accepts legacy `eip155:1337` for back-compat.
  - HyperCore stays EVM-addressed: it's a `virtual` (`vmType: 'evm'`) entry, so `isNonEvmChainId(1337) === false` and its EVM token/recipient handling is unchanged.

- 663fea9: Add HyperCore as a destination chain. `hyperCoreMainnet` (Hyperliquid's virtual trading L1, chain id 1337, settling on HyperEVM 999) can now be passed as `targetChain`, exactly like `solanaMainnet` / `tronMainnet`. HyperCore deposits are solver-mediated — the orchestrator builds the core-deposit executions and the user signs no destination session — so they prepare and sign without a destination-side smart session. Previously, expressing a HyperCore destination as a viem chain with id 1337 threw `UnsupportedChainError` at signing because 1337 is not a registered EVM chain.
- 81c5236: Add independent multisig signing. Pass an `owner` to `signTransaction` to create a serializable owner signature, then combine owner signatures with `assembleTransaction` before submission. Supports ECDSA, passkey, and multi-factor owner sets.
- 641dec4: Surface orchestrator `KEY_SCOPE_DENIED` responses as a typed `KeyScopeDeniedError` (subclass of `ForbiddenError`), carrying the failed `scope`, the `required` level, and the key's `actual` level. Integrators can distinguish "scoped out" from "invalid key" without losing the structured payload.
- 7940667: Support non-EVM destination chains (Solana, Tron) in the intent flow.

  - New `NonEvmChain` descriptor type and `solanaMainnet` / `tronMainnet` exports. Pass them anywhere a viem `Chain` was accepted for the destination: `targetChain: solanaMainnet`. `DestinationChain` (`Chain | NonEvmChain`) is the union form used by `Transaction.targetChain`.
  - `CrossChainTransaction` is now a discriminated union — `CrossChainEvmTransaction` (EVM destinations) and `CrossChainNonEvmTransaction` (Solana / Tron). On non-EVM destinations, `recipient` accepts a `NonEvmAddress` (Solana base58 / Tron T-prefix) and `tokenRequests[].address` accepts non-EVM token strings.
  - CAIP-2 helpers (`toCaip2`, `fromCaip2`, `isCaip2`) now dispatch on namespace and round-trip non-EVM chain ids through the orchestrator's CAIP-2 strings. Use `getChainId(chain)` for the numeric id of either chain kind.
  - `IntentOpStatus.fillTransactionHash` is now `string` (`FillTransactionHash`), so Solana base58 / Tron hex fill hashes round-trip cleanly.
  - Token-symbol validation and EVM-address parsing are skipped on the destination side for non-EVM chains; orchestrator-side validation handles SPL mints / Tron contracts.
  - EIP-7702 authorization, smart-session target-execution signing, and destination-side session resolution all skip non-EVM destinations.
  - `Account.accountType` and `Account.setupOps` are now optional. Non-EVM recipients emit just `{ address }`.

  The UserOp path remains EVM-only.

- 555d60e: Preserve unprocessable-content response details on `UnprocessableContentError` so callers can inspect structured orchestrator validation and planning context.
- cc406d9: Add `SessionDefinition.crossChainPermits` (`CrossChainPermissionInput`) to authorise session keys to move funds across chains via Permit2 arbiter settlement. Pick settlement layers (`SAME_CHAIN` / `ECO` / `ACROSS`, or all by default); bridge-to-self is enforced unless `allowRecipientNotAccount` is set.
- 55762ad: Surface orchestrator `SIMULATION_FAILED` responses as a typed `SimulationFailedError`, preserving classification fields such as `category`, `errorSelector`, `errorName`, `errorArgs`, `retryable`, `retryHint`, `simulations`, and `nonce` so callers can re-prepare stale submissions when instructed.
- 089d85b: Expose typed errors for sponsored-fee failures on quotes. `SponsorLimitExceededError` (a configured per-client sponsorship cap was hit — carries `limitKey`, `capUsd`, `coverageUsd`, `sponsorAddress`) and `InsufficientSponsorBalanceError` (the sponsor's balance can't cover the enabled categories — carries `failedCategories`, `sponsorAddress`, `remainingBalanceUsd`, `totalSponsoredUsd`) now surface as distinct classes with the guards `isSponsorLimitExceeded`, `isInsufficientSponsorBalance`, and `isSponsorError`. Both extend `UnprocessableContentError` and keep `code` as `'UNPROCESSABLE_CONTENT'`, so existing handling of that error is unaffected.
- d12bad7: Add `customDeadline` transaction option to override the on-chain fill deadline. Accepts an absolute unix timestamp (seconds) and is honored only on the same-chain (tokenless) route — ignored elsewhere. Bounds (`now + 120s` .. `now + 86400s`) are enforced by the orchestrator. When honored, the quoted `expiresAt` and the bundle claim/nonce expiry track this value automatically.
- fff29d2: Expose orchestrator `traceId` values on successful quote, split, submit, and intent-status responses.
- c5e2777: Add app-fee quote support by threading `appFees` through transaction preparation and exposing app-fee quote details in orchestrator responses.

### Patch Changes

- db826fe: Normalize `BridgeFill.destinationChainId` to a numeric chain ID. The orchestrator returns CAIP-2 strings; the SDK now decodes them to numbers for consistency with the rest of the API.
- c778494: Fix internal collision between the dummy preclaim-op action target and the smart-session fallback-target marker.
- ab18401: Fix `enable` (ECDSA) on Nexus accounts. The OwnableValidator is the Nexus default validator and cannot be added via `installModule` (`DefaultValidatorAlreadyInstalled`); on passkey-bootstrapped accounts it is also never initialized, so `addOwner` reverts with `NotInitialized`. `enable` now initializes the default validator directly via `onInstall`, and throws a clear error (instead of an opaque simulation revert) when ECDSA is already enabled.
- 9f018c8: Re-export `OriginSignature` from the package root and `@rhinestone/sdk/orchestrator`, so consumers iterating intent signature arrays don't need to inline the union locally.
- 4411a46: Re-export `Quote` from the package root, so consumers don't need to derive it from `PreparedQuotes['best']`.
- 13e87ce: Fix intent preparation for EIP-7702 accounts. The orchestrator quote request now includes the signed `initializeAccount` setup op (built from `eip7702InitSignature`) instead of an empty/factory setup, so 7702 intents route correctly instead of failing with "no viable route". `prepareTransaction` for a 7702 account requires the init signature.
- 8598c5a: Fix `experimental_enableSession` dropping `permissions` on scoped sessions, which caused the emissary to reject the enable. The function now accepts a resolved `Session` (was `SessionInput`).
- 02e5003: Fix the `time-frame` session policy encoding to match the deployed `TimeFramePolicy` contract. Sessions installed with a `time-frame` policy through the SDK now correctly enforce `validUntil` / `validAfter`.
- 87ba706: Fix `uninstallModule` reverting on Nexus, Safe7579, and Startale accounts. This unblocks every module disable action on those accounts — `ecdsa.disable`, `passkeys.disable`, `mfa.disable`, `experimental_disable` (smart sessions), and the generic `uninstallModule(module)` — all of which were silently broken on Nexus before. Kernel and EOA paths are unaffected.
- e223a77: Expose `BridgeFill` on quote responses — a per-intent tracking handle (request id, deposit address, commitment id) for third-party bridge layers (`OFT`, `RELAY`, `NEAR`, `RHINO`, `CCTP`).
- 99f5161: Send HyperCore recipients as EOA-typed orchestrator accounts. HyperCore recipients are EVM EOAs, but `getRecipient` emitted them as a bare `{ address }` (the Solana/Tron shape, with no `accountType`). The orchestrator's HyperCore planning gate strictly requires `accountType === 'EOA'`, so deposits were rejected at `/quotes` with "HyperCore destinations require an EOA recipient". HyperCore now takes the EVM passthrough (`accountType: 'EOA'`) while remaining solver-mediated for signing.
- 2a6f56b: Fix claim-only sessions failing on first use. The session is now installed via the emissary on the first intent; subsequent intents on the same session use the cached state.
- d464a1b: Use per-chain mock signature shapes during quote simulation. Steady-state ERC-1271 bundles no longer pay the validation gas of an `ENABLE`-mode session enable, giving more accurate gas estimates.
- 56ca282: Preserve decimal-string numeric fields in public prepared and signed intent data while retaining bigint normalization internally for signing.
- 15029de: Re-export the low-level smart-session helpers
- 0ffab75: Reject duplicate session permissions for the same function on the same contract at session build time. Previously they were silently accepted and collided on-chain, so only the last entry's policies took effect and calls permitted by earlier entries failed at execution.
- a1f8b8f: Restore release-compatible EIP-7702 adoption, validator signing, Smart Session chain routing, and UserOperation behavior. Custom bundlers and paymasters again use their generic RPC and ERC-7677 flows.
- 5f7f20e: Respect `Retry-After` headers when polling intent status after rate limits.
- e81f02e: Retry transient transport errors (socket closed, connection reset, DNS/TLS failures) while polling intent status in `waitForExecution`, instead of treating them as terminal. These bubble up untyped from `fetch` and were previously surfaced as bridge failures despite the intent still settling.
- d44f9ea: Improve JSDoc across the public API (account methods, `RhinestoneSDK`, actions, and utils) for richer in-editor docs and to power the generated SDK reference.
- fba610c: Resolve the `settlementLayers` `{ exclude }` filter on the orchestrator instead of in the SDK, so excluding specific layers automatically accounts for new settlement layers as they are added.
- 8746989: Set the intent's declared `signatureMode` to match the bytes the SDK actually signs. EOAs, non-session smart accounts, and claim-only sessions now declare `ERC1271`; sessions with `verifyExecutions=true` declare `EMISSARY_EXECUTION_ERC1271`. Avoids a wasted on-chain validator call per bundle.
- 20bb8e3: Add USDT support on Soneium.
- 1cd3687: Allow Startale accounts adopted via `initData` to sign intents: `getEip712Domain` no longer throws for existing accounts and derives the domain from `getAddress(config)`.
- 694ba08: Fix `setup()` reverting on Startale K1 accounts: skip the built-in K1 default validator so only genuinely missing modules (e.g. the intent executor) are installed.
- 97981bf: Add `USDG` to the fee-token wire typings, matching the published orchestrator OpenAPI spec.
- eadcf9a: Use `tron:mainnet` as Tron's canonical CAIP-2 (was `tron:0x2b6653dc`). Updates the hardcoded `tronMainnet` destination descriptor so `toCaip2(728126428)` and `fromCaip2('tron:mainnet')` resolve. Hard cutover: `tron:0x2b6653dc` no longer resolves.

## 2.0.0-beta.47

### Major Changes

- 0521724: Drop the `experimental_` prefix from the smart-session API now that it's stable. Rename across your integration:

  - Config: `experimental_sessions` → `sessions`
  - Signer set: `type: 'experimental_session'` → `type: 'session'`
  - Account methods: `experimental_getSessionDetails` → `getSessionDetails`, `experimental_isSessionEnabled` → `isSessionEnabled`, `experimental_signEnableSession` → `signEnableSession`
  - `@rhinestone/sdk/actions/smart-sessions` actions: `experimental_enable` → `enable`, `experimental_disable` → `disable`, `experimental_enableSession` → `enableSession`, `experimental_disableSession` → `disableSession`

- 97c6672: Trim the selectable account `version` values to the supported set. Nexus keeps `1.2.0` and `1.2.1` (default `1.2.1`); Kernel keeps `3.3`. Removed Nexus `1.0.2`, `rhinestone-1.0.0-beta`, and `rhinestone-1.0.0`, and Kernel `3.1` and `3.2`. If you pinned a removed version, omit `version` to use the default or pin a supported one.

## 2.0.0-beta.46

### Minor Changes

- 34d15ff: Add the Rhinestone protocol fee: a caller-set fee that always accrues to Rhinestone, collected alongside `appFees` in one batched transfer, and — unlike the app fee — sponsorable.

  - `transaction.protocolFees: { feeBps }` (0–10000) sets the rate; the `ProtocolFeeRate` type is exported.
  - `sponsored.protocolFees` (or the `sponsored: true` shorthand) charges the integrator's sponsorship balance instead of the user, without the sponsorship surcharge.
  - Quote responses surface the fee as `cost.fees.breakdown.protocol`.

## 2.0.0-beta.45

### Patch Changes

- 13e87ce: Fix intent preparation for EIP-7702 accounts. The orchestrator quote request now includes the signed `initializeAccount` setup op (built from `eip7702InitSignature`) instead of an empty/factory setup, so 7702 intents route correctly instead of failing with "no viable route". `prepareTransaction` for a 7702 account requires the init signature.
- 56ca282: Preserve decimal-string numeric fields in public prepared and signed intent data while retaining bigint normalization internally for signing.
- a1f8b8f: Restore release-compatible EIP-7702 adoption, validator signing, Smart Session chain routing, and UserOperation behavior. Custom bundlers and paymasters again use their generic RPC and ERC-7677 flows.

## 2.0.0-beta.44

### Major Changes

- b778335: Nexus now defaults to v1.2.1. This changes the default counterfactual account address; opt back into the previous implementation with `account: { type: 'nexus', version: '1.2.0' }`.
- df690eb: Require token **addresses** (not symbols) for all token inputs — `tokenRequests`, `CalldataInput.to`, `ExactInputConfig`, `SimpleTokenList`, and cross-chain permit legs (`from`/`to`). Token symbols (`'USDC'`, `'WETH'`, …) are no longer accepted; pass the token's address for the target chain. This removes the SDK's per-chain symbol→address resolution — the first step of dropping the bundled `@rhinestone/shared-configs` chain data so new chains no longer require an SDK release.
- 420cb4b: Read chain data at runtime from the orchestrator instead of bundling it. The SDK no longer depends on `@rhinestone/shared-configs`: the supported-chain set, per-chain tokens, and the wrapped-native token are fetched (once, lazily, and cached) from the orchestrator's `GET /chains`, and `Chain` objects come from `viem`. A new chain no longer requires an SDK release.

  Breaking changes:

  - **`SupportedChain` is now `number`** (open) rather than a closed union of chain ids.
  - **New `RhinestoneSDK.createSession(definition)`** (`sdk.createSession(...)`) — resolves the chain's wrapped-native token from `/chains` and permits native-wrapping automatically. It is project-scoped (needs the API key, not an account). The standalone `toSession(definition, options)` is now pure: pass `options.wrappedNativeToken` to opt into the native-wrap action (otherwise it is omitted).
  - **Removed the `alchemy` provider type.** Supply RPC URLs yourself via `provider: { type: 'custom', urls: { [chainId]: url } }`, or omit `provider` to use viem's default transport.
  - **Removed the token-registry helpers** `getWethAddress`, `getTokenSymbol`, and `isTokenAddressSupported`. Fetch equivalent data from the orchestrator's `/chains` endpoint.

  The signed Permit2 arbiter allow-set stays bundled (it must remain client-trusted), now as a small inlined constant rather than read from shared-configs.

  Requires an orchestrator that returns `wrappedNativeToken` on `/chains`.

## 2.0.0-beta.43

### Patch Changes

- 0bbf56d: Bump @rhinestone/shared-configs to 1.7.15 to add Avalanche C-Chain (43114) support.

## 2.0.0-beta.42

### Minor Changes

- 089d85b: Expose typed errors for sponsored-fee failures on quotes. `SponsorLimitExceededError` (a configured per-client sponsorship cap was hit — carries `limitKey`, `capUsd`, `coverageUsd`, `sponsorAddress`) and `InsufficientSponsorBalanceError` (the sponsor's balance can't cover the enabled categories — carries `failedCategories`, `sponsorAddress`, `remainingBalanceUsd`, `totalSponsoredUsd`) now surface as distinct classes with the guards `isSponsorLimitExceeded`, `isInsufficientSponsorBalance`, and `isSponsorError`. Both extend `UnprocessableContentError` and keep `code` as `'UNPROCESSABLE_CONTENT'`, so existing handling of that error is unaffected.
- d12bad7: Add `customDeadline` transaction option to override the on-chain fill deadline. Accepts an absolute unix timestamp (seconds) and is honored only on the same-chain (tokenless) route — ignored elsewhere. Bounds (`now + 120s` .. `now + 86400s`) are enforced by the orchestrator. When honored, the quoted `expiresAt` and the bundle claim/nonce expiry track this value automatically.

## 2.0.0-beta.41

### Minor Changes

- 81c5236: Add independent multisig signing. Pass an `owner` to `signTransaction` to create a serializable owner signature, then combine owner signatures with `assembleTransaction` before submission. Supports ECDSA, passkey, and multi-factor owner sets.

## 2.0.0-beta.40

### Patch Changes

- 0ffab75: Reject duplicate session permissions for the same function on the same contract at session build time. Previously they were silently accepted and collided on-chain, so only the last entry's policies took effect and calls permitted by earlier entries failed at execution.
- 97981bf: Accept `USDG` as a token symbol in `accountAccessList` and fee-token wire typings, matching the published orchestrator OpenAPI spec.

## 2.0.0-beta.39

### Patch Changes

- ca73c9d: Bump @rhinestone/shared-configs to 1.7.8 to add Robinhood Chain (4663). Raise the
  `viem` peer floor to ^2.55.0 — shared-configs 1.7.8's generated networks import
  `robinhood` from `viem/chains`, which was added in viem 2.55.0; on older viem the
  package crashes at module load.

## 2.0.0-beta.38

### Minor Changes

- e1d7c9f: Add `getAppFeeBalances` to `RhinestoneSDK`. Returns the integrator's accrued app-fee balance as USD totals (`withdrawableUsd`, `pendingUsd`), read from `GET /app-fees/balances`. The balance is project-scoped (keyed to the API key), not tied to any account. Fees are valued in USD at the moment they are collected, so the balance is unaffected by later price movements of the collected tokens.

## 2.0.0-beta.37

### Major Changes

- 767c425: Remove the top-level `appFee` leg from quote routes. The orchestrator now charges the whole-intent app fee in a single token, so the concrete leg lives in signed metadata rather than on the route response. `Quote.appFee` and the `AppFee` type are removed; the app fee is available as `quote.cost.fees.breakdown.app.usd`. Requesting an app fee via `options.appFees` (type `AppFeeRate`) is unchanged.

## 2.0.0-beta.36

### Major Changes

- c87e09e: Remove the `feeAsset` transaction option. The orchestrator never honored it — the corresponding `feeToken` field was reserved with no effect — so choosing an ERC-20 fee asset was a no-op. Drop `feeAsset` from your `prepareTransaction` calls; it has no replacement until the feature actually ships.

## 2.0.0-beta.35

### Major Changes

- 971a298: Support custom module address overrides for the passkey and multi-factor validators via `owners.module`. Removed the inert `module` override from the ENS validator, whose address is fixed by the HCA account implementation.

### Minor Changes

- bfc46e0: Support a custom HCA factory via `account.factory`, which defines the deploy address and, through its implementation, the account's default validator.

### Patch Changes

- 1cd3687: Allow Startale accounts adopted via `initData` to sign intents: `getEip712Domain` no longer throws for existing accounts and derives the domain from `getAddress(config)`.
- 694ba08: Fix `setup()` reverting on Startale K1 accounts: skip the built-in K1 default validator so only genuinely missing modules (e.g. the intent executor) are installed.

## 2.0.0-beta.34

### Minor Changes

- b9e37ce: Use `hypercore:mainnet` as the canonical CAIP-2 id for the HyperCore destination instead of `eip155:1337` (RHI-4560), and source the CAIP-2 ↔ chain-id mapping from `@rhinestone/shared-configs`.

  The orchestrator (shared-configs ≥ 1.6.14) now emits `hypercore:mainnet` for HyperCore — `eip155:1337` was semantically wrong (1337 is the Hardhat/Ganache local chain id). Changes:

  - `hyperCoreMainnet.caip2` is `'hypercore:mainnet'`.
  - `caip2.ts` now delegates `toCaip2` / `fromCaip2` / `isNonEvmChainId` to the shared-configs registry instead of maintaining its own hardcoded namespace tables. This removes the SDK↔orchestrator drift risk (both now read the same source) and means new chains are a shared-configs registry entry, not a hand-maintained table in each repo. `fromCaip2` still accepts legacy `eip155:1337` for back-compat.

  HyperCore stays EVM-addressed: it's a `virtual` (`vmType: 'evm'`) registry entry, so `isNonEvmChainId(1337) === false` and its EVM token/recipient handling is unchanged. Bumps `@rhinestone/shared-configs` to 1.6.15.

### Patch Changes

- eadcf9a: Use `tron:mainnet` as Tron's canonical CAIP-2 (was `tron:0x2b6653dc`).

  Updates the hardcoded `tronMainnet` destination descriptor and bumps `@rhinestone/shared-configs` to `^1.7.0`, so `toCaip2(728126428)` / `fromCaip2('tron:mainnet')` resolve via the registry. Hard cutover: `tron:0x2b6653dc` no longer resolves. Requires shared-configs ≥ 1.7.0.

## 2.0.0-beta.33

### Minor Changes

- 555d60e: Preserve unprocessable-content response details on `UnprocessableContentError` so callers can inspect structured orchestrator validation and planning context.

## 2.0.0-beta.32

### Minor Changes

- d696a3c: Export `toCrossChainPermissionInput` from `@rhinestone/sdk/smart-sessions`, which converts a resolved `CrossChainPermit` (unix-seconds deadlines, `recipientIsAccount`) back into the `CrossChainPermissionInput` shape accepted by `SessionDefinition.crossChainPermits` (`Date` deadlines, `allowRecipientNotAccount`). Useful when a permit was persisted in resolved form and has to be re-supplied as session input.

## 2.0.0-beta.31

### Patch Changes

- 15029de: Re-export the low-level smart-session helpers

## 2.0.0-beta.30

### Major Changes

- 972f72a: Drop the `session` param from `account.deploy(chain, params)`. It was a no-op — sessions cannot be enabled at deployment time. Enable a session after deployment with `experimental_signEnableSession` and the smart-sessions actions.
- 0149a68: Normalize public datetime inputs to accept `Date`.

  - `PermissionFunctionConfig.validUntil` / `validAfter` now accept `Date` only (dropped the raw millisecond-epoch `number`).
  - `CrossChainPermissionInput.fillDeadline` bounds (`min` / `max`) now accept `Date` (dropped the unix-seconds `bigint`).
  - Reshape `ENSValidatorConfig`: replace the parallel `accounts` + `ownerExpirations` arrays with a single `owners: { account: Account; expiration?: Date }[]`. Omit `expiration` for an owner that never expires (previously the `maxUint48` sentinel).
  - `CrossChainPermit` is no longer marked `@internal` — the resolved permit shape (unix-seconds `bigint`) is now a documented low-level escape hatch.

- fa7492d: Clean up the `./errors` surface.

  - Remove `ExistingEip7702AccountsNotSupportedError`, `SmartSessionsNotEnabledError`, and `SessionChainRequiredError`. None were ever thrown; the "session needs a chain" rule the latter described is enforced at the type level (`chain` is required on `SessionDefinition` and `Session`).
  - Export `DefaultValidatorAlreadyInitializedError`, `ModuleInstallationNotSupportedError`, `EoaSigningNotSupportedError`, `EoaSigningMethodNotConfiguredError`, `OwnersFieldRequiredError`, and `Eip7702InitSignatureRequiredError`, which are thrown by the SDK but were previously not catchable by type.

- 8e02b11: Remove the top-level `createRhinestoneAccount` export. Construct accounts through `new RhinestoneSDK(config).createAccount(...)` instead.
- fa7d3a5: Remove the legacy social-recovery surface:

  - Remove the `@rhinestone/sdk/actions/recovery` subpackage (`enable`, `recoverEcdsaOwnership`, `recoverPasskeyOwnership`).
  - Remove the `recovery` field from `RhinestoneAccountConfig` and the `Recovery` type.
  - Remove the `guardians` signer (`GuardiansSignerSet`) from `SignerSet`.
  - Remove `SignerNotSupportedError` — it only guarded the guardian path.

- 50c5822: Trim the `@rhinestone/sdk/smart-sessions` subpath to a curated public surface. It now exports only `toSession`, `SMART_SESSION_EMISSARY_ADDRESS`, the policy address constants (`SPENDING_LIMITS_POLICY_ADDRESS`, `TIME_FRAME_POLICY_ADDRESS`, `SUDO_POLICY_ADDRESS`, `UNIVERSAL_ACTION_POLICY_ADDRESS`, `ARG_POLICY_ADDRESS`, `USAGE_LIMIT_POLICY_ADDRESS`, `VALUE_LIMIT_POLICY_ADDRESS`, `INTENT_EXECUTION_POLICY_ADDRESS`), and the `SessionDetails` and `ChainDigest` types. The remaining low-level helpers, constants, and types that the subpath previously re-exported are now internal. Use the account's `experimental_*` methods and the `@rhinestone/sdk/actions/smart-sessions` actions instead.

### Minor Changes

- a415156: Add `experimental_disableSession` to the smart-sessions actions. Removes a single enabled session from an account via the emissary's `removeConfig`. The account executes the call itself, so the user authorizes it by signing the outer transaction — no separate session-digest signature is needed. Takes the resolved session and an `expires` deadline (`Date`).
- 9731767: Make `expires` optional in `experimental_disableSession`. Omitting it disables the session with no expiry (`maxUint256` sentinel), matching the enable paths, instead of forcing callers to invent a far-future `Date`.
- cc406d9: Add `SessionDefinition.crossChainPermits` (`CrossChainPermissionInput`) to authorise session keys to move funds across chains via Permit2 arbiter settlement. Pick settlement layers (`SAME_CHAIN` / `ECO` / `ACROSS`, or all by default); bridge-to-self is enforced unless `allowRecipientNotAccount` is set.
- c5e2777: Add app-fee quote support by threading `appFees` through transaction preparation and exposing app-fee quote details in orchestrator responses.

## 2.0.0-beta.29

### Patch Changes

- d44f9ea: Improve JSDoc across the public API (account methods, `RhinestoneSDK`, actions, and utils) for richer in-editor docs and to power the generated SDK reference.

## 2.0.0-beta.28

### Patch Changes

- ab18401: Fix `enable` (ECDSA) on Nexus accounts. The OwnableValidator is the Nexus default validator and cannot be added via `installModule` (`DefaultValidatorAlreadyInstalled`); on passkey-bootstrapped accounts it is also never initialized, so `addOwner` reverts with `NotInitialized`. `enable` now initializes the default validator directly via `onInstall`, and throws a clear error (instead of an opaque simulation revert) when ECDSA is already enabled.

## 2.0.0-beta.27

### Minor Changes

- a77d0f2: Expose `signIntent` on the account to sign orchestrator-prepared intents in headless flows, and export the `SignedIntentData` type.

## 2.0.0-beta.26

### Minor Changes

- 8bdb6f5: Add `createCrossChainPermission()` and `SessionDefinition.crossChainPermits` for authorising session keys to move funds across chains via Permit2 arbiter settlement. Each permit expands into a `Permit2ClaimPolicy` (claim-side) plus optional `SpendingLimitsPolicy` / `TimeFramePolicy` entries on the fallback action — the claim policy itself doesn't enforce amounts or expiry on-chain. Devs select settlement layers (`SAME_CHAIN` / `ECO` / `ACROSS`) and the SDK resolves them to the canonical Permit2 arbiter addresses from `@rhinestone/shared-configs`; omitting (or passing `[]`) expands to the union of every supported layer. Bridge-to-self (`recipientIsAccount`) is enforced by default — opt out explicitly with `allowRecipientNotAccount: true`.

## 2.0.0-beta.25

### Patch Changes

- fba610c: Resolve the `settlementLayers` `{ exclude }` filter on the orchestrator instead of in the SDK, so excluding specific layers automatically accounts for new settlement layers as they are added.

## 2.0.0-beta.24

### Minor Changes

- 3ae5d61: Add ENS-HCA (Hierarchical Contract Account) support

### Patch Changes

- e81f02e: Retry transient transport errors (socket closed, connection reset, DNS/TLS failures) while polling intent status in `waitForExecution`, instead of treating them as terminal. These bubble up untyped from `fetch` and were previously surfaced as bridge failures despite the intent still settling.

## 2.0.0-beta.23

### Minor Changes

- 55762ad: Surface orchestrator `SIMULATION_FAILED` responses as a typed `SimulationFailedError`, preserving classification fields such as `category`, `errorSelector`, `errorName`, `errorArgs`, `retryable`, `retryHint`, `simulations`, and `nonce` so callers can re-prepare stale submissions when instructed.

## 2.0.0-beta.22

### Patch Changes

- 99f5161: Send HyperCore recipients as EOA-typed orchestrator accounts. HyperCore recipients are EVM EOAs, but `getRecipient` emitted them as a bare `{ address }` (the Solana/Tron shape, with no `accountType`). The orchestrator's HyperCore planning gate strictly requires `accountType === 'EOA'`, so deposits were rejected at `/quotes` with "HyperCore destinations require an EOA recipient". HyperCore now takes the EVM passthrough (`accountType: 'EOA'`) while remaining solver-mediated for signing.

## 2.0.0-beta.21

### Minor Changes

- 663fea9: Add HyperCore as a destination chain. `hyperCoreMainnet` (Hyperliquid's virtual trading L1, chain id 1337, settling on HyperEVM 999) can now be passed as `targetChain`, exactly like `solanaMainnet` / `tronMainnet`. HyperCore deposits are solver-mediated — the orchestrator builds the core-deposit executions and the user signs no destination session — so they prepare and sign without a destination-side smart session. Previously, expressing a HyperCore destination as a viem chain with id 1337 threw `UnsupportedChainError` at signing because 1337 is not a registered EVM chain.

## 2.0.0-beta.20

### Major Changes

- 8cec964: Update SmartSession action policy singleton addresses to the new canonical V2 deployments (`SudoPolicy`, `UniversalActionPolicy`, `UsageLimitPolicy`, `ValueLimitPolicy`, `TimeFramePolicy`, `ERC20SpendingLimitPolicy`) and add `ArgPolicy` support for expression-tree rules. Sessions enabled against the previous policy contracts are not compatible with newly encoded session data and need re-enabling, or per-session opt-in to the old addresses via `SessionDefinition.policyAddresses`.

  - Add the `arg-policy` policy variant (`ArgPolicyExpression` AST with `rule` / `not` / `and` / `or` nodes) for action rules that need disjunction or negation. `universal-action` stays available for plain AND-of-rules.
  - Extend the `permissions` builder used by `toSession`: `params` constraints accept `{ anyOf: [v1, v2, ...] }` to allowlist values (compiles to `arg-policy`); per-function sugar fields `maxUses`, `validUntil`, `validAfter`, `valueLimit`, and `spendingLimit` map 1:1 to their policy types, with `valueLimit` type-gated to `payable` functions and `spendingLimit` type-gated to ERC-20 transfer-shaped ABIs.
  - Remove the `permissions.functions.*.policies` escape hatch. Use the typed permission fields instead; stale runtime callers that still provide `policies` now throw instead of silently dropping guards.
  - Add `SessionDefinition.policyAddresses` — a partial override map (`sudo`, `universalAction`, `argPolicy`, `spendingLimits`, `timeFrame`, `usageLimit`, `valueLimit`) for accounts already enabled against the previous deployments. Defaults to the new V2 addresses.
  - Fix `bytesN` (N<32) reference values in `permissions`: pre-pad right so the encoded `bytes32` matches Solidity calldata alignment instead of being read at the wrong end of the word.

### Patch Changes

- 55320de: Bump `@rhinestone/shared-configs` to 1.6.7.

## 2.0.0-beta.19

### Minor Changes

- fff29d2: Expose orchestrator `traceId` values on successful quote, split, submit, and intent-status responses.

## 2.0.0-beta.18

### Patch Changes

- d464a1b: Shape each per-chain mock signature to match that chain's resolved signing shape. `buildMockSignature` previously always emitted the ENABLE-mode (verifyExecution) payload, so the orchestrator simulated `verifyExecution` even for steady-state ERC-1271 bundles — overestimating validation gas. It now threads the per-chain resolved `verifyExecutions` so an already-enabled session emits the plain ERC-1271 mock shape (mode byte `0x00`) and a first-use session keeps the ENABLE shape (mode byte `0x01`), letting the orchestrator pick the matching gas simulation. Note these mock shapes are per-chain and may differ across chains; the declared `signatureMode` is a single global value resolved conservatively, so a chain's mock shape need not match the global mode in mixed states.

## 2.0.0-beta.17

### Patch Changes

- 8598c5a: Fix `experimental_enableSession` dropping `permissions` for scoped sessions. The function accepted `SessionInput` and re-ran `toSession` on it inside `resolve`, but callers pass a resolved `Session` (which carries the derived `actions` but not the original `SessionDefinition.permissions`). The re-resolution treated `permissions` as undefined and replaced the action set with a sole `sudoAction`, so the on-chain digest computed by `SmartSessionLens.getAndVerifyDigest` no longer matched the digest signed in `getSessionDetails` and the emissary rejected the enable. The parameter type is now `Session` and the resolved value is passed straight to `getEnableSessionCall`.
- 87ba706: Fix `uninstallModule` reverting on Nexus, Safe7579, and Startale accounts. These ERC-7579 accounts store validators in a `SentinelList` and decode `uninstallModule`'s `deInitData` arg as `(address prev, bytes moduleDeInit)`. The SDK was passing module-level `deInitData` (typically `'0x'`) straight into that slot, which fails `abi.decode` before the linked list pop can run. `getModuleUninstallationCalls` now reads the live validator list, computes the prev pointer, and wraps `module.deInitData` as `abi.encode(prev, module.deInitData)` for validator-type uninstalls on SentinelList accounts. Kernel and EOA paths are untouched (Kernel treats the slot as raw module bytes; EOA has no modules).

  Affects every existing disable action — `ecdsa.disable`, `passkeys.disable`, `mfa.disable`, `experimental_disable` (smart sessions), and the generic `uninstallModule(module)` — all of which were silently broken on Nexus before.

## 2.0.0-beta.16

### Patch Changes

- 2a6f56b: Fix claim-only sessions failing on first use after the `verifyExecutions` derivation change. `resolveSignersForChain` now forces `verifyExecutions=true` whenever the session is not yet enabled on-chain, regardless of `hasExplicitPermissions`. This routes the first intent through the emissary's `verifyExecution` path (mode 5, ENABLE-mode signature, dummy preClaimOp) so the session gets installed via `setConfig`. Subsequent intents on an already-enabled claim-only session drop back to mode 1.

## 2.0.0-beta.15

### Major Changes

- bec6a8a: - Drop `protocol` and `settlement` from `FeeBreakdown`. The orchestrator only returns `gas`, `bridge`, and `swap`.
- b5c30f1: - `account.waitForExecution` now polls until the intent reaches a terminal state (`COMPLETED` or `FAILED`), without an SDK-side deadline. The previous `expiresAt`-based timeout proved unreliable for some flows (e.g. intent executor), where the quote `expiresAt` doesn't reflect the actual fill deadline. The orchestrator handles expiry internally and surfaces it as `FAILED`.
  - Removed the `IntentExpiredError` class — expiry now surfaces as `IntentFailedError` (inspect `operations[].failureReason` for the cause).
  - Removed the `expiresAt` field from `TransactionResult`.
  - Narrowed `SettlementLayerFilter` to `CrossChainSettlementLayer[]` (`ACROSS | ECO | RELAY | OFT | NEAR | RHINO | CCTP`) — `SAME_CHAIN` and `INTENT_EXECUTOR` are picked by the orchestrator and were never accepted in the filter at runtime.

## 2.0.0-beta.14

### Patch Changes

- 9f018c8: Re-export `OriginSignature` from the public entry. Consumers iterating intent signature arrays for the merkle / encoded-signature path can now `import type { OriginSignature } from '@rhinestone/sdk'` (or from `@rhinestone/sdk/orchestrator`) instead of inlining the union locally.
- 02e5003: Fix `getPolicyData('time-frame')` to match the deployed `TimeFramePolicy` contract. Was emitting `encodePacked(['uint48','uint48'], [validUntil, validAfter])`; now emits `encodeAbiParameters([uint48, uint48], [validAfter, validUntil])`. Sessions installed with a `time-frame` policy through the SDK now behave as intended.

## 2.0.0-beta.13

### Minor Changes

- 641dec4: Surface orchestrator `KEY_SCOPE_DENIED` responses as a typed `KeyScopeDeniedError` (subclass of `ForbiddenError`) carrying the failed `scope`, the `required` level, and the key's `actual` level. Integrators can now distinguish "scoped out" from "invalid key" without losing the structured payload.

## 2.0.0-beta.12

### Major Changes

- 487b93e: Remove `verifyExecutions` from the public session signer API.

### Patch Changes

- 8746989: Sync intent `signatureMode` with the bytes shape the SDK actually signs: EOAs, non-session smart accounts, and claim-only sessions now emit `SIG_MODE_ERC1271` (1), while sessions with `verifyExecutions=true` continue to emit the dual-sig `SIG_MODE_EMISSARY_EXECUTION_ERC1271` (5). Previously the SDK always picked a hybrid mode, wasting an on-chain call attempt on the wrong validator path.

## 2.0.0-beta.11

### Major Changes

- 26ef7ce: **BREAKING**: Align SDK with the orchestrator's new operation model (blanc API version).

  ### Breaking changes

  - **`IntentStatus`** reduced to 3 states: `PENDING`, `COMPLETED`, `FAILED`.
    Removed: `PRECONFIRMED`, `CLAIMED`, `FILLED`, `EXPIRED`.
  - **`IntentOpStatus`** response shape replaced with flat per-chain `operations[]`.
    Removed: `claims`, `fillTransactionHash`, `fillTimestamp`, `destinationChainId`.
  - **`TransactionStatus`** (returned by `waitForExecution`) now contains `status`, `accountAddress`, and `operations[]` instead of `fill` / `claims`.
  - **`waitForExecution`**: removed the `acceptsPreconfirmations` parameter.
  - **Removed types**: `Claim`, `ClaimStatus`.
  - **Removed status constants**: `INTENT_STATUS_EXPIRED`, `INTENT_STATUS_FILLED`, `INTENT_STATUS_PRECONFIRMED`, `INTENT_STATUS_CLAIMED`.
  - **API version** bumped to `2026-04.blanc`.

  ### New types

  - `OperationStatus`: `'PENDING' | 'COMPLETED' | 'FAILED'`
  - `FailureReason`: `'EXPIRED' | 'REVERTED' | 'RELAYER_FAILURE'`
  - `ChainOperation`: discriminated union with one operation per chain

## 2.0.0-beta.10

### Major Changes

- 54eb5aa: - `account.waitForExecution` now polls until the intent's quote `expiresAt`, replacing the previous hardcoded 3.5-minute cap. Long-fill intents are no longer cut off prematurely, and the orchestrator's `EXPIRED` status is now treated as terminal.
  - The `IntentStatusTimeoutError` class has been renamed to `IntentExpiredError`. Update any `catch` / `instanceof` checks accordingly.

## 2.0.0-beta.9

### Minor Changes

- 7940667: Support non-EVM destination chains (Solana, Tron) in the intent flow.

  - New `NonEvmChain` descriptor type and `solanaMainnet` / `tronMainnet` exports. Pass them anywhere a viem `Chain` was accepted for the destination: `targetChain: solanaMainnet`. The `DestinationChain` type alias (`Chain | NonEvmChain`) is the union form used by `Transaction.targetChain`.
  - `CrossChainTransaction` is now a discriminated union — `CrossChainEvmTransaction` (EVM destinations) and `CrossChainNonEvmTransaction` (Solana / Tron). On non-EVM destinations, `recipient` accepts a `NonEvmAddress` (Solana base58 / Tron T-prefix) and `tokenRequests[].address` accepts non-EVM token strings without consumer casts.
  - CAIP-2 helpers (`toCaip2`, `fromCaip2`, `isCaip2`) now dispatch on namespace and round-trip non-EVM synthetic chain ids through the orchestrator's CAIP-2 strings. The synthetic numeric id is used internally for orchestrator wire mapping but is intentionally not exposed on `NonEvmChain` — use `getChainId(chain)` for the numeric id of either chain kind.
  - `IntentOpStatus.fillTransactionHash` is now `string` (`FillTransactionHash`), so Solana base58 / Tron hex fill hashes round-trip cleanly.
  - Token-symbol validation and EVM-address parsing are skipped on the destination side for non-EVM chains; orchestrator-side validation handles SPL mints / Tron contracts.
  - EIP-7702 authorization, smart-session target-execution signing, and the destination-side session resolution all skip non-EVM destinations — there's no validator there to verify a destination signature, and per-chain experimental sessions don't need an entry for the synthetic Solana / Tron chain id.
  - `Account.accountType` and `Account.setupOps` are now optional. Non-EVM recipients emit just `{ address }`; the orchestrator schema requires these fields unset for non-EVM destinations.

  No UserOp support for non-EVM destinations: the UserOp path remains EVM-only by construction.

## 2.0.0-beta.8

### Patch Changes

- 10cf96b: Bump @rhinestone/shared-configs to 1.5.1

## 2.0.0-beta.7

### Major Changes

- 46a197a: - `Transaction.settlementLayers` is now `{ include: SettlementLayer[] } | { exclude: SettlementLayer[] }` — you can blacklist specific layers without enumerating every other one.

### Patch Changes

- 4411a46: Re-export `Quote` from the main entry so consumers don't need to derive it from `PreparedQuotes['best']`

## 2.0.0-beta.6

### Patch Changes

- 20bb8e3: Add soneium usdt support

## 2.0.0-beta.5

### Patch Changes

- db826fe: Fix BridgeFill.destinationChainId type

## 2.0.0-beta.4

### Patch Changes

- e223a77: Add bridgeFill param as response

## 2.0.0-beta.3

### Major Changes

- edeae4c: - `PortfolioToken.chains[]` replaces `locked`/`unlocked` with a single `amount: bigint`, matching the orchestrator's blanc wire shape (`balance: { locked, unlocked }` collapsed to a flat `amount`; post-compact, locked is always `0`).
- a5bded7: - Drop the unused `feeToken` field from the `Cost` response and remove the public `FeeToken` type. The orchestrator's blanc `POST /quotes` response never populates this field.

## 2.0.0-beta.2

### Major Changes

- 522d3df: - Remove `passport` account support. `account.type: 'passport'` is no longer accepted; the `PassportAccount` type and the `passport` member of `AccountType` / `AccountProviderConfig` are removed.
- 522d3df: - Drop the `acceptsPreconfirmations` parameter from `account.waitForExecution`. The method now always waits for `FILLED` / `COMPLETED` and never treats `PRECONFIRMED` as terminal.
- 522d3df: - Drop the `account.sendTransaction(transaction)` shortcut. Use the `prepareTransaction` → `signTransaction` → `submitTransaction` flow instead.
- 3f6adba: - Replace `Session.actions` with `toSession({ permissions, claimPolicies })`, an ABI-driven session definition shape (`{ abi, address, functions }`) that resolves to a low-level `Session`. Function selectors and param calldata offsets are derived from the ABI, param value types are checked against ABI input types, and public Permit2 claim policies use chain-aware fields that resolve to the internal onchain schema.
- 522d3df: - Reshape `account.submitTransaction` to take an options bag: `submitTransaction(signed, { authorizations?, internal_dryRun? })` instead of positional `submitTransaction(signed, authorizations?, dryRun?)`.
- 9bebb79: - Remove the `@rhinestone/sdk/actions/compact` subpackage entry and its helpers.
  - Remove the public `deployAccountsForOwners` helper.
  - Remove the public `checkERC20AllowanceDirect` helper.
  - Remove the public `getPermit2Address` helper.
  - Remove the `account.checkERC20Allowance` method.
  - Move `walletClientToAccount` from the package root to `@rhinestone/sdk/utils`.
  - Move `wrapParaAccount` from the package root to `@rhinestone/sdk/utils`.
  - Move `toSession` from the package root to `@rhinestone/sdk/smart-sessions`.
  - Remove the public `getSupportedTokens` helper.
  - Remove the public `getTokenAddress` helper.
  - Remove the public `getTokenDecimals` helper.
  - Remove the public `getAllSupportedChainsAndTokens` helper.

## 2.0.0-beta.1

### Major Changes

- f3f4fb2: - Switch the orchestrator client to the `2026-04.blanc` API version.
- 766128e: - Drop the public `signPermit2Batch` / `signPermit2Sequential` helpers along with the `MultiChainPermit2Config` / `MultiChainPermit2Result` / `BatchPermit2Result` types.
- 4391772: - `PortfolioToken` drops the token-level `decimals` and `balances` aggregate; `decimals` now lives on each `chains[]` entry.
- edd83bf: - `RhinestoneSDK.getIntentStatus(intentId)` now takes a `string` (was `bigint`).
- 839f2a6: - Drop compact-bound fields (`lockFunds` transaction option, `emissaryConfig` on the orchestrator `Account` type) to match the orchestrator's blanc API trim.
- 6398613: - `RhinestoneAccount.getTransactionMessages` now surfaces the optional `targetExecution` typed data, matching the underlying helper.
- f7c2de0: - `prepareTransaction` returns `quotes: { best, all }` instead of `quote`.
  - `signTransaction(prepared, { intentId })` lets callers sign a non-default quote from `prepared.quotes.all`.
  - `getTransactionMessages(prepared, { intentId })` accepts the same selection so external signers see the route `signTransaction` will sign.
  - `SignedTransactionData.quote` is the selected quote.
  - `intentId` is required on the options argument; pass an id from `prepared.quotes.all` or omit options entirely to sign the recommended quote.

### Patch Changes

- c778494: Don't use fallback target for the dummy preclaim op.
- 5f7f20e: Respect `Retry-After` headers when polling intent status after rate limits.

## 2.0.0-beta.0

### Major Changes

- 81f4567: ESM-only build and trimmed public surface.

  The SDK no longer ships a CommonJS build. `package.json` is now
  `"type": "module"` with a single `"exports"` block that resolves to ESM
  artifacts; `main` and the `require` conditions have been removed.

  Subpackage exports that leaked internal `./dist/src/*` paths have been
  dropped. Consumers should import from the curated entry points (`.`,
  `./actions`, `./actions/*`, `./signing/passkeys`, `./errors`, `./utils`,
  `./smart-sessions`, `./jwt-server`).

  Tooling implications: requires a Node / bundler that resolves ESM cleanly.
  Old CJS `require('@rhinestone/sdk')` call sites must move to `import` or
  use a bundler that bridges them.

## 1.5.0

### Minor Changes

- e8bbde0: Add JWT authentication support alongside existing API key flow.

  - New `auth` config option with `{ mode: 'experimental_jwt', accessToken, getIntentExtensionToken }`
  - `createJwtSigner` helper in `@rhinestone/sdk/jwt-server` for same-host RS256 signing
  - JCS canonicalization (RFC 8785) and intent input digest computation
  - `shouldSponsor` config-based filtering (chain, account, calls predicates) built into `createJwtSigner`
  - Framework handler wrappers for Web Standard (`Request`/`Response`) and Express
  - `SponsorshipDeniedError` custom error class for typed denial handling

### Patch Changes

- d3ef16c: Support EC JWKs in `createJwtSigner`. The JWS algorithm is now derived from the supplied JWK (`P-256` → `ES256`, `P-384` → `ES384`, `P-521` → `ES512`); RSA keys continue to sign as `RS256`. Unsupported `kty`/`crv` combinations throw at signer construction.
- cc71613: Drop `ox` dependency by inlining the single type reference (`WebAuthnP256.SignMetadata`). The SDK had no runtime usage of `ox` — only a type-only import — so this has no behavioral impact. Consumers still get `ox` transitively through `viem` if needed.
- 7613f1d: Revert the `2026-04.blanc` orchestrator submit schema and restore the `2026-01.alps` API version. Submit requests again send `{ signedIntentOp }` and expect the nested `result.id`/`status` intent response.

## 1.4.2

### Patch Changes

- 44b15b3: Fix `deploy()` for EIP-7702 accounts by passing `eip7702InitSignature` through to `sendTransaction`. Auto-signs via `signEip7702InitData` when no signature is provided.
- 09650a9: Bump shared config version

## 1.4.1

### Patch Changes

- 3695877: support v0 factory-backed initData in Safe EIP-712 domain and widen V0 util types

## 1.4.0

### Minor Changes

- d557674: - Add per-chain session configuration via `sessions` map
  - Allow enabling sessions on both source and target chains
  - Remove `verifyExecutions` from public API (determined internally via on-chain checks)

### Patch Changes

- 20be9a5: Fix startale initData packing
- c599380: Add ERC-7739 signing for session enable on Startale+K1 accounts
- f9dfa30: Use proper wrapped token address for smart sessions instead of WETH

## 1.3.0

### Minor Changes

- eaf8d64: Export `buildMockSignature` for generating Smart Sessions mock signatures used in gas estimation

### Patch Changes

- a0747f4: Make K1 validator opt-in for Startale accounts via owners.module override
- 1e57df8: Enable more headers
- 2439e4d: Use type-safe function selectors for injected session actions

## 1.2.18

### Patch Changes

- 553678b: Fix startale getDeployArgs and getAddress

## 1.2.17

### Patch Changes

- ed15083: Remove experimental_session check from sendAsUserOp condition

## 1.2.16

### Patch Changes

- a7758f0: Add optional Authorization header to orch

## 1.2.15

### Patch Changes

- 64b30eb: Update swapOrigin type
- 08ab15d: Add 'USDT0' token symbol
- a4a07fc: Allow partial custom provider URLs

## 1.2.14

### Patch Changes

- 623f9f1: Use provider param in smart session

## 1.2.13

### Patch Changes

- ba80541: Remove default 1 wei token request for cross-chain transactions
- c24fa2c: Remove legacy single ops signing code path
- 0545b2f: Remove targetExecution parameter from cross-chain transaction signing

## 1.2.12

### Patch Changes

- e7255bc: add mock usd token

## 1.2.11

### Patch Changes

- 69f99d7: Include swap types on intent
- 7400889: - Pass `eip7702InitSignature` to `sendTransaction`
  - Improve EIP-7702 init signature required error message
- 995f064: add auxiliary funds to route

## 1.2.10

### Patch Changes

- d190b56: Skip initData check if factory data is not provided
- 220e282: Lowercase contract addresses in account implementations

## 1.2.9

### Patch Changes

- d3e41bc: Fix intents to chains with no USDC

## 1.2.8

### Patch Changes

- b6ebd62: Add dev contract support for smart session emissary and fix target executions

## 1.2.7

### Patch Changes

- 03bbe2b: Allow arbitrary tokens as origin assets
- ba76c90: add split intents function
- 496f3c0: bump viem dependency to 2.40.1

## 1.2.6

### Patch Changes

- 588ca01: latest shared configs

## 1.2.5

### Patch Changes

- 8be0ba1: Remove 7702 defensive check from isDeployed function
- 292c270: Remove cost endpoint and max amount util from SDK

## 1.2.4

### Patch Changes

- 38965d0: Add SSX module actions and experimental `isSessionEnabled` function

## 1.2.3

### Patch Changes

- f492c7d: Fix enabling smart sessions with a signature when making a cross-chain transaction

## 1.2.2

### Patch Changes

- 895d168: Allow single token request with no amount

## 1.2.1

### Patch Changes

- 64c0fc0: Fix signature mode for non-"smart session" flows
- 6c7813c: Fix session data signing for undeployed accounts

## 1.2.0

### Minor Changes

- 26b2b3e: Enable exact input on access list

### Patch Changes

- eb6b4e8: Enable sessions via signature

## 1.1.3

### Patch Changes

- 88fec05: Update yeet shared config

## 1.1.2

### Patch Changes

- 3932774: Override default signature mode

## 1.1.1

### Patch Changes

- 01e44d3: Enable calls for EOAs

## 1.1.0

### Minor Changes

- c394ecb: Preliminary support for smart session emissary module (unscoped session keys for cross-chain intents).

## 1.0.43

### Patch Changes

- f163a3c: contract remediation changes

## 1.0.42

### Patch Changes

- 40f87b7: Custom bundler send transaction condition

## 1.0.41

### Patch Changes

- 6e0f02c: Allow bundler and paymaster config to support custom types

## 1.0.40

### Patch Changes

- f391e91: Support existing Nexus accounts created with SDK V1

## 1.0.39

### Patch Changes

- 144256a: Add `getTransactionMessages` to expose the typed data signed by the user.

## 1.0.38

### Patch Changes

- ca31bf8: add gnosis and sonic

## 1.0.37

### Patch Changes

- e9b8795: add token decimals helper

## 1.0.36

### Patch Changes

- 4d9900f: Expose more modules

## 1.0.35

### Patch Changes

- 75b6919: Allow module address overrides for smart sessions
- 734b0fc: Add utility to deploy V0-compatible accounts

## 1.0.34

### Patch Changes

- 7f171c7: Use intent's `element` chain instead of `target` for EIP-712 signing

## 1.0.33

### Patch Changes

- 93723a5: Switch chains during signing
- b93ce99: Fix “max amount” estimation for undeployed accounts

## 1.0.32

### Patch Changes

- d42a5ac: Sponsorship types

## 1.0.31

### Patch Changes

- 53c915e: Fix error in `toViewOnlyAccount` util

## 1.0.30

### Patch Changes

- 5e7d4f5: Account deployment action

## 1.0.29

### Patch Changes

- a27b03a: Add support for deployAccountsForOwners

## 1.0.28

### Patch Changes

- 1140dbd: Allow initiate existing accounts with address only

## 1.0.27

### Patch Changes

- f541d77: simplify supported tokens

## 1.0.26

### Patch Changes

- fc66314: Custom modules for account deployment
- 59ca158: Set minimal `viem` version to `2.38.0`

## 1.0.25

### Patch Changes

- 59a798a: Add helper to get `initData` for Rhinestone accounts

## 1.0.24

### Patch Changes

- ecb9ab8: Disallow EOA executions (calls)
- e77a12b: Account nonces
- 26eca68: Update `recipient` param

## 1.0.23

### Patch Changes

- 96d883d: Clean up logs

## 1.0.22

### Patch Changes

- 7a736ca: Fix API request params: rename `tokenTransfers` → `tokenRequests`

## 1.0.21

### Patch Changes

- ee9287f: increase initial polling duration
- 10f974f: Fix typing with useDevContracts

## 1.0.20

### Patch Changes

- dd1134b: export getInitCode

## 1.0.19

### Patch Changes

- 39b930a: update latest chains

## 1.0.18

### Patch Changes

- baa581f: Add ens ownable validator support

## 1.0.17

### Patch Changes

- e7eaa9c: use funding method field
- c680345: Fix signing for multi-chain intents

## 1.0.16

### Patch Changes

- a89112e: Expose "simulation failed" error

## 1.0.15

### Patch Changes

- 700ca58: Fix add recipient parameter in sendTransaction

## 1.0.14

### Patch Changes

- 5e4fc1c: Add eoa response types and getAllSupportedChainsAndTokens function

## 1.0.13

### Patch Changes

- a678eaa: add optional recipient

## 1.0.12

### Patch Changes

- 9788afb: ERC-7739 policies for session keys

## 1.0.11

### Patch Changes

- a4a83b6: Custom RPC endpoints

## 1.0.10

### Patch Changes

- 8425d5c: Implement clear signing for session enablement

## 1.0.9

### Patch Changes

- 81e7007: add wrapParaAccount 0/1 v-byte signer

## 1.0.8

### Patch Changes

- 58c0bf4: use singlechain ops

## 1.0.7

### Patch Changes

- 33bc2b5: Fix the intent executor logic for correct counterfactual generation

## 1.0.6

### Patch Changes

- 668d926: Add "get intent status" utility

## 1.0.5

### Patch Changes

- 096d98f: Allow token symbols for `getMaxSpendableAmount`

## 1.0.4

### Patch Changes

- 1b68dba: Fix default chains in `getPortfolio`

## 1.0.3

### Patch Changes

- 35a6093: Smart sessions and module installation for Passport accounts

## 1.0.2

### Patch Changes

- 3a6b21e: Enhance intent status polling logic

## 1.0.1

### Patch Changes

- 501591f: Minimal Passport account support

## 1.0.0

### Major Changes

- 036f989: The Compact support

### Minor Changes

- 6602670: Add Sonic support
- b7b5faa: Support Startale account

### Patch Changes

- 0bb2c42: Fix API request in `getMaxTokenAmount`
- 9e034b8: Take sponsorship into account in `getMaxSpendableAmount`
- dea6f57: update compact address
- e4dc710: Fix portfolio
- d03fe29: Standalone intents
- 43429c6: Multi source chain
- a6b1718: Export the registry methods getSupportedTokens and getTokenAddress
- 7ca0cc2: Enhance error handling
- ae93ddc: - Introduce `RhinestoneSDK` an entry point
  - Move action utilities into separate subpackages
  - Make actions lazily executed
  - Split the intent and userop flows
- 883706c: Resource locking
- 7e879d3: Remove `axios` dependency
- 233c8bf: fix: always send setup ops
- 12b4d87: Add signer conversion helpers methods
- e21d83c: Update dependencies
- 82f6851: Add relay types
- 6107c7e: allow for settlement layer selection
- 533c84f: - Selecting source assets (per chain or globally) by setting `sourceAssets`
  - Don't pass the default token request when using same-chain settlement
  - Choosing a fee token by setting `feeAsset`
- d39b2ba: Expose missing types
- 5bd056d: 7702 delegations
- 9b1fa4f: Custon accounts
- 865142b: Add `isDeployed` utility
- 18566eb: Intent-based account deployments
- 359d07f: Existing accounts support ("Bring your own account")
- 912ee8a: Permit2 signing
- 436daea: Add optional orchestratorUrl parameter for internal testing
- 54f5506: Allow using token symbols
- 9d09cc9: fix validation error
- 1d76bad: Use latest contracts
- ec215ed: Add transaction simulation method
- 8e767ba: add soneium
- 859a46d: Provide CJS exports for subpackages
- 8fa26d7: add dry run flag (internal use only)
- 29ccb04: Custom accounts support
- 6750bdf: Move `@rhinestone/shared-configs` into package deps
- 9719915: Fee sponsorship
- 50774b2: ERC20 deposits for TheCompact
- 109f624: Account signing utilities for message and typed data signing
- f12656f: Passkey multisig
- f6456f0: Multi-factor validator
- 94605e9: updated 712 types
- a10ed68: Add EOA support
- ef7fd0e: - Custom JSON-RPC providers
  - Biconomy bundler/paymaster
  - Make `tokenRequests` optional
- cf08197: Make Rhinestone API key optional (staging only)
- af1de6b: remove status endpoint

## 1.0.0-beta.43

### Patch Changes

- 9d09cc9: fix validation error

## 1.0.0-beta.42

### Patch Changes

- dea6f57: update compact address

## 1.0.0-beta.41

### Patch Changes

- d03fe29: Standalone intents
- af1de6b: remove status endpoint

## 1.0.0-beta.40

### Patch Changes

- 7ca0cc2: Enhance error handling

## 1.0.0-beta.39

### Patch Changes

- 7e879d3: Remove `axios` dependency
- 233c8bf: fix: always send setup ops

## 1.0.0-beta.38

### Patch Changes

- 8fa26d7: add dry run flag (internal use only)

## 1.0.0-alpha.37

### Patch Changes

- a10ed68: Add EOA support

## 1.0.0-alpha.36

### Patch Changes

- 94605e9: updated 712 types

## 1.0.0-alpha.35

### Patch Changes

- 859a46d: Provide CJS exports for subpackages

## 1.0.0-alpha.34

### Patch Changes

- e21d83c: Update dependencies

## 1.0.0-alpha.33

### Patch Changes

- ae93ddc: - Introduce `RhinestoneSDK` an entry point
  - Move action utilities into separate subpackages
  - Make actions lazily executed
  - Split the intent and userop flows

## 1.0.0-alpha.32

### Patch Changes

- 883706c: Resource locking

## 1.0.0-alpha.31

### Patch Changes

- 533c84f: - Selecting source assets (per chain or globally) by setting `sourceAssets`
  - Don't pass the default token request when using same-chain settlement
  - Choosing a fee token by setting `feeAsset`

## 1.0.0-alpha.30

### Patch Changes

- 912ee8a: Permit2 signing

## 1.0.0-alpha.29

### Patch Changes

- 865142b: Add `isDeployed` utility

## 1.0.0-alpha.28

### Patch Changes

- d39b2ba: Expose missing types

## 1.0.0-alpha.27

### Patch Changes

- 9b1fa4f: Custon accounts

## 1.0.0-alpha.26

### Patch Changes

- 359d07f: Existing accounts support ("Bring your own account")

## 1.0.0-alpha.25

### Patch Changes

- 82f6851: Add relay types

## 1.0.0-alpha.24

### Patch Changes

- 12b4d87: Add signer conversion helpers methods

## 1.0.0-alpha.23

### Patch Changes

- 6107c7e: allow for settlement layer selection

## 1.0.0-alpha.22

### Patch Changes

- 436daea: Add optional orchestratorUrl parameter for internal testing

## 1.0.0-alpha.21

### Minor Changes

- 6602670: Add Sonic support

## 1.0.0-alpha.20

### Patch Changes

- 9e034b8: Take sponsorship into account in `getMaxSpendableAmount`

## 1.0.0-alpha.19

### Patch Changes

- 0bb2c42: Fix API request in `getMaxTokenAmount`

## 1.0.0-alpha.18

### Patch Changes

- 6750bdf: Move `@rhinestone/shared-configs` into package deps

## 1.0.0-alpha.17

### Patch Changes

- ec215ed: Add transaction simulation method

## 1.0.0-alpha.16

### Patch Changes

- 29ccb04: Custom accounts support

## 1.0.0-alpha.15

### Patch Changes

- f12656f: Passkey multisig

## 1.0.0-alpha.14

### Patch Changes

- cf08197: Make Rhinestone API key optional (staging only)

## 1.0.0-alpha.13

### Patch Changes

- a6b1718: Export the registry methods getSupportedTokens and getTokenAddress

## 1.0.0-alpha.12

### Patch Changes

- 109f624: Account signing utilities for message and typed data signing

## 1.0.0-alpha.11

### Patch Changes

- 9719915: Fee sponsorship

## 1.0.0-alpha.10

### Patch Changes

- 5bd056d: 7702 delegations

## 1.0.0-alpha.9

### Minor Changes

- b7b5faa: Support Startale account

## 1.0.0-alpha.8

### Patch Changes

- 8e767ba: add soneium

## 1.0.0-alpha.7

### Patch Changes

- 1d76bad: Use latest contracts

## 1.0.0-alpha.6

### Patch Changes

- 43429c6: Multi source chain

## 1.0.0-alpha.5

### Patch Changes

- f6456f0: Multi-factor validator

## 1.0.0-alpha.4

### Patch Changes

- 18566eb: Intent-based account deployments

## 1.0.0-alpha.3

### Patch Changes

- 54f5506: Allow using token symbols
- ef7fd0e: - Custom JSON-RPC providers
  - Biconomy bundler/paymaster
  - Make `tokenRequests` optional

## 1.0.0-alpha.2

### Patch Changes

- 50774b2: ERC20 deposits for TheCompact

## 1.0.0-alpha.1

### Patch Changes

- e4dc710: Fix portfolio

## 1.0.0-alpha.0

### Major Changes

- 036f989: The Compact support

## 0.12.7

### Patch Changes

- a438baf: Custom type-safe errors

## 0.12.6

### Patch Changes

- c584325: Fix `exports` path

## 0.12.5

### Patch Changes

- e4ea79d: Fix `solady` import

## 0.12.4

### Patch Changes

- d95819b: Handle custom signers in `prepareTransaction`

## 0.12.3

### Patch Changes

- 38e4bd7: Adds account state read functions:

  - `getValidators`
  - `getOwners`
  - `areAttestersTrusted`

- e697296: Multi-chain session keys
- ec2a7d1: Make paymaster use optional

## 0.12.2

### Patch Changes

- a551259: Fix portfolio endpoint request encoding

## 0.12.1

### Patch Changes

- 5b6d52d: remove default access list

## 0.12.0

### Minor Changes

- 6f73fea: - Validator installation
  - Validator uninstallation
  - Custom signers

## 0.11.3

### Patch Changes

- 034c36e: Add missing action exports

## 0.11.2

### Patch Changes

- 8a04205: Add Social Recovery (guardians) support

## 0.11.1

### Patch Changes

- b075665: add zksync to chains

## 0.11.0

### Minor Changes

- f84da0d: Kernel V3 support

## 0.10.3

### Patch Changes

- 6d175c4: add zksync to supported chains

## 0.10.2

### Patch Changes

- 238b12b: Fix: remove support for USDT on testnets

## 0.10.1

### Patch Changes

- f611ebe: Add support for USDT

## 0.10.0

### Minor Changes

- 262a06d: Expose low-level APIs:

  - deploy
  - prepareTransaction
  - signTransaction
  - submitTransaction

## 0.9.0

### Minor Changes

- 07bab17: Pass tokenPrices, gasPrices and opGasParams on POST /bundles

## 0.8.3

### Patch Changes

- c198a38: Fix export paths

## 0.8.2

### Patch Changes

- 568ee10: Disallow Polygon|ETH usage

## 0.8.1

### Patch Changes

- c034b30: Use account access list for source chain

## 0.8.0

### Minor Changes

- 2a01beb: Switch to CJS

## 0.7.10

### Patch Changes

- 0feea4b: Fix incorrect condition in `waitForExecution`

## 0.7.9

### Patch Changes

- a01c5dc: CJS build for Orchestrator utilities

## 0.7.8

### Patch Changes

- 8cdc036: Export `OrderCost`, `OrderCostResult`, `OrderFeeInput`, `UserTokenBalance` orchestrator types.

## 0.7.7

### Patch Changes

- 0892b1e: Add `applyInjectedExecutions` and `getSupportedTokens` orchestrator utils

## 0.7.6

### Patch Changes

- 410af4a: Add `isTokenAddressSupported` orchestrator utility

## 0.7.5

### Patch Changes

- 5a063c7: Improvements:

  - default value for `tokenRequests` (1 unit of ether)
  - make `sourceChain` optional (when possible)
  - executor flow: custom `gasLimit`
  - add portfolio util to `rhinestoneAccount`
  - add an optional `acceptsPreconfirmations` param to `waitForExecution`

  Bug fixes:

  - user op flow: fix `maxPriorityFeePerGas` (arbitrum sepolia)
  - make sure the statuses are handled properly when waiting for a bundle result

## 0.7.4

### Patch Changes

- e86fc28: Adds new "preconfirmed" status for bundles

## 0.7.3

### Patch Changes

- eb0fd7f: Reduce bundle size from 3.5MB to 200KB

## 0.7.2

### Patch Changes

- 656c85d: Don't install the smart session compatibility module by default

## 0.7.1

### Patch Changes

- 19d3202: - Use public Pimlico bundler endpoint by default
  - Use dev orchestrator instance for testnet transactions

## 0.7.0

### Minor Changes

- b293aab: Change `getTokenBalanceSlot` function signature

### Patch Changes

- b293aab: Fix ESM build import paths

## 0.6.4

### Patch Changes

- 7c6427e: Export `getTokenSymbol` util

## 0.6.3

### Patch Changes

- be4870a: Add `getTokenSymbol` util

## 0.6.2

### Patch Changes

- ef5d38a: Add `getRhinestoneSpokePoolAddress` method

## 0.6.1

### Patch Changes

- 7c2e4d3: Export `dist/src/orchestrator` subpackage

## 0.6.0

### Minor Changes

- 1c8a6d4: Export BundleStatus enum from the orchestrator.

## 0.5.4

### Patch Changes

- 1eae19b: Add missing export for Orchestrator

## 0.5.3

### Patch Changes

- b92f390: Add missing bundle status values

## 0.5.2

### Patch Changes

- 1eeab87: Fix types

## 0.5.1

### Patch Changes

- ead932d: Export missing types

## 0.5.0

### Minor Changes

- 83f1548: Return chain IDs instead of viem chain objects in the transaction result
- 83f1548: Rename `sendTransactions` → `sendTransaction`

### Patch Changes

- 83f1548: Allow deploys via ERC-4337 bundler

## 0.4.3

### Patch Changes

- 221e20f: Add "max spendable token amount" util

## 0.4.2

### Patch Changes

- ed82f25: Expose Orchestrator service and utilities

## 0.4.1

### Patch Changes

- 38b337f: Smart session support for Safe7579 accounts.

## 0.4.0

### Minor Changes

- d224af3: Fix timestamp policy encoding

## 0.3.0

### Minor Changes

- 881a353: Smart sessions

## 0.2.1

### Patch Changes

- 0d9a187: EIP-7702 support

## 0.2.0

### Minor Changes

- a1ee520: Biconomy Nexus support

## 0.1.0

### Minor Changes

- 0d94c35: Initial release

### Patch Changes

- 1f4f100: Passkey signers
