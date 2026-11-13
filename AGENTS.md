# Rhinestone SDK

End-to-end chain abstraction and modularity toolkit for Ethereum smart accounts.

Uses the Rhinestone infrastructure for cross-chain intent orchestration under the hood.

Docs: https://docs.rhinestone.dev/smart-wallet

## Commands

- `bun run build` - Build the project (clean + tsc)
- `bun run test` - Run tests (vitest).
- `bun run check` - Lint and format (biome)
- `bun run typecheck` - Type check without emit

## Stack

- Runtime: Bun
- Language: TypeScript (strict mode)
- Testing: Vitest
- Linting: Biome
- Dependencies: viem (peer), solady, jose (optional peer, for `jwt-server`)

## Structure

- `/src` - Main package source (`@rhinestone/sdk`); `src/package.json` is the published manifest
- `/src/accounts` - Smart account implementations (Safe, Kernel, Nexus, Startale, Passport)
- `/src/actions` - Atomic account actions (ECDSA, passkeys, smart-sessions, recovery)
- `/src/auth` - Auth provider (API key / JWT modes)
- `/src/execution` - Transaction execution and signing
- `/src/jwt-server` - Server-side JWT signer (Express + Web handlers)
- `/src/modules` - Module validators and chain abstraction
- `/src/orchestrator` - Rhinestone API client
- `/test` - Integration tests

## Branching

The SDK uses three long-lived branches:

- `main` — dev releases for **v2** SDK (snapshots published under the `@dev` tag)
- `release` — prod releases for **v2** SDK (published to `@latest`)
- `v1` — prod releases for the legacy **v1** SDK (published under the `@v1-latest` tag)

Where to open PRs:

- **v2 changes** (features and fixes) → target `main`
- **v1 fixes** → target `v1`

The release process: push `main` for a v2 dev release, `release` for a v2 release, `v1` for a v1 release.

## Patterns

- Use viem types for addresses, chains, and hex values
- Ordering and case conversion must never depend on the host locale — sort hex values with `compareHexValues` and use the default `.sort()` comparator or `toLowerCase`/`toUpperCase` elsewhere; `test/locale-independence.test.ts` rejects `localeCompare`, `toLocale*Case`, and `Intl.Collator` in `src/`
- Placement of a new public method — `RhinestoneSDK` vs `RhinestoneAccount`: put it on **`RhinestoneSDK`** when its data is scoped to the API key's project/integrator and needs no account (auth-only orchestrator reads, e.g. `getIntentStatus`, `splitIntents`, `getAppFeeBalances`); put it on **`RhinestoneAccount`** only when it is genuinely account-scoped (needs the account address / owners / on-chain state, e.g. `getPortfolio`, signing). Exposing project-scoped data as an account method misleads callers into reading it as account-scoped.
- Account implementations live in `/src/accounts/*.ts`
- Public API is the union of `src/index.ts` re-exports and the subpath exports in `src/package.json` (`/actions`, `/orchestrator`, `/jwt-server`, `/smart-sessions`, etc.) — adding, renaming, or removing exports is a breaking change
- The project is using `changeset` to manage releases. Create a changeset file for each fix or feature.

## Testing

- Run single test: `bun run test -- path/to/file.test.ts`
- Tests use prool for local chain testing
- Integration tests in `/test` require `.env` configuration
- Make sure to remove the `src/dist` build folder before running integration tests
