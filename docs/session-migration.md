# Smart Session and config migration

SDK-owned migration notes for new definitions and persisted grants. Account
addresses and factory data do not change with these session compiler defaults.

## Removed inputs

| Removed | Replacement |
| --- | --- |
| `new RhinestoneSDK({ apiKey })` | `new RhinestoneSDK({ auth: { mode: 'apiKey', apiKey } })` |
| `SolanaPasskeyPermission` | `SolanaAuthorityPermission` from `@rhinestone/sdk/solana` |
| `SessionDefinition.claimPolicies` | Standard settlement routes use `crossChainPermits`; arbitrary custom spenders have no replacement definition input |

Delete removed keys entirely. Setting them to `undefined` or an empty value
still rejects at runtime, even on widened objects. Online creation throws before
RPC/catalog reads; online and standalone validation report
`REMOVED_CLAIM_POLICIES_INPUT` without resolving the rest of the definition.
Nested API-key/JWT auth and bundler/paymaster service credentials are unchanged.

## New definitions

1. Name source tokens and destination legs in `crossChainPermits`.
2. Select explicit settlement layers for strict enforcement, or omit/use an empty
   list/`all` to use every enforceable served layer and inspect dropped coverage.
3. Inspect validation refusals, `access`, coverage and warnings before enabling.
4. Persist the resolved session, permission identity and authorization artifacts.

Scoped Permit2 actions are now the default; open `intentExecution`/`sudo` fallback
is opt-in. Fallback retains the ACROSS default when layers are omitted. Do not
add fallback merely to make an incompatible scope compile. Reusable scoped
`maxAmount` counts a lifetime approval/value budget, not existing allowances or
all unrelated actions. Re-enabling an already-enabled budgeted session requires
`allowBudgetReset: true` and coherent enabled-state/nonce reads. Once sessions
permit at most one settlement transaction per participating chain, not one op.

Action windows use the action-enforcing TimeFramePolicy; settlement/once policy
addresses and deployed UAP copies are defaulted by chain/environment. Offline
resolution needs caller-supplied catalog data for catalog-dependent routes and
does not verify bytecode. Prefer `sdk.createSession`/`sdk.validateSession` for
online checks. Fees and stable-swap floors stay opt-in; their coverage is not a
universal spending bound.

## Persisted artifacts

`Session.claimPolicies` remains compiled signing metadata, not an input to the
new-definition compiler. Keep it, the encoded ERC-1271 list, salt, actions and
permissionId intact. Pass the restored `Session` to enable/disable/sign methods;
never send it back through `createSession`, `toSession` or definition validation.
Informational access/coverage metadata is optional on older persisted sessions.

Rebuilding under a new catalog, clock or defaults can change permissionId and
enable digests. A new identity does not upgrade an installed grant. Old grants
retain their installed policies; revoke or authorize a replacement deliberately.
See [architecture](architecture.md#smart-sessions) and
[testing](testing.md#smart-session-parity) for boundary and regression coverage.
