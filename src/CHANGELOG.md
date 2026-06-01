# @rhinestone/sdk

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
