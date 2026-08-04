# Rhinestone SDK

End-to-end chain abstraction and modularity toolkit for Ethereum smart accounts.

Uses the Rhinestone infrastructure for cross-chain intent orchestration under the hood.

Docs: https://docs.rhinestone.dev/smart-wallet

## Commands

- `bun run build` - Build the project (clean + tsc)
- `bun run test` - Run tests (vitest).
- `bun run test:coverage:pure` - Run the pure-core coverage gate.
- `bun run test:types` - Compile consumer-facing public type fixtures.
- `bun run test:contract` - Compare the packed package with the release baseline.
- `bun run test:integration:smoke` - Run the live SDK smoke suite against testnets.
- `bun run test:integration` - Run all live SDK integration tests.
- `bun run check` - Lint and format (biome)
- `bun run check:architecture` - Enforce dependency direction and import boundaries.
- `bun run typecheck` - Type check without emit

## Stack

- Runtime: Bun
- Language: TypeScript (strict mode)
- Testing: Vitest
- Linting: Biome
- Dependencies: viem (peer), jose and express (optional peers for `jwt-server`); the published package has no runtime dependencies

## Structure

- `/src` - Main package source (`@rhinestone/sdk`); `src/package.json` is the published manifest
- `/src/api` - Public facade: `RhinestoneSDK`, the `RhinestoneAccount` instance, composition, and queries
- `/src/config` - Public config types and resolution to the internal invocation context
- `/src/chains`, `/src/calls` - Chain catalog / CAIP-2 / tokens, and call resolution
- `/src/accounts` - Smart account adapters (Safe, Kernel, Nexus, Startale, HCA, EOA)
- `/src/modules` - Module planning and validators, including Smart Sessions
- `/src/signing` - The signing pipeline (plans, signers, protocols, intent plans)
- `/src/transactions` - Intent and UserOperation workflows (`intents/`, `user-operations/`)
- `/src/clients` - Ports and adapters for the orchestrator, RPC, bundler, and paymaster
- `/src/actions` - Atomic account actions (ECDSA, passkeys, smart-sessions)
- `/src/errors`, `/src/utils`, `/src/smart-sessions` - Published compatibility barrels
- `/src/jwt-server` - Server-side JWT signer (Express + Web handlers)
- `/test` - Unit helpers, type tests, and live integration tests

See [docs/architecture.md](docs/architecture.md) for how these fit together and the transaction flow.

## Docs

- [Architecture](docs/architecture.md) — layering and transaction flow
- [Testing](docs/testing.md) — unit, type, and live integration tests
- [Code generation](docs/codegen.md) — SDK Reference and orchestrator wire types

Keep these in sync with the code — update the relevant doc in the same PR as any change it covers.

## Branching

The SDK uses three long-lived branches:

- `main` — dev releases for **v2** SDK (snapshots published under the `@dev` tag)
- `release` — prod releases for **v2** SDK (published to `@latest`)
- `v1` — prod releases for the legacy **v1** SDK

Where to open PRs:

- **v2 changes** (features and fixes) → target `main`
- **v1 fixes** → target `v1`

After a changeset reaches `main`, a successful `@dev` publish opens one `main` → `release` promotion PR; pushes to `release` and `v1` run their production release workflows.

## Patterns

- Use viem types for addresses, chains, and hex values
- Placement of a new public method — `RhinestoneSDK` vs `RhinestoneAccount`: put it on **`RhinestoneSDK`** when its data is scoped to the API key's project/integrator and needs no account (auth-only orchestrator reads, e.g. `getIntentStatus`, `splitIntents`, `getAppFeeBalances`); put it on **`RhinestoneAccount`** only when it is genuinely account-scoped (needs the account address / owners / on-chain state, e.g. `getPortfolio`, signing). Exposing project-scoped data as an account method misleads callers into reading it as account-scoped.
- Account implementations live in `/src/accounts/adapters/*.ts`
- Public API is the union of the explicit exports from `src/index.ts` and the subpath exports in `src/package.json` (`/actions`, `/errors`, `/jwt-server`, `/smart-sessions`, etc.) — adding, renaming, or removing exports is a breaking change. Determine root exports from export declarations or the packed package; a symbol imported into `src/index.ts` only for use in a public signature is not itself a named export.
- When changing the public surface (types, exports, account/action APIs, config, errors, defaults), use the `dx` skill to keep it safe and ergonomic to integrate
- When writing or editing JSDoc on public symbols (it generates the published SDK Reference), use the `jsdoc` skill
- The project uses `changeset` to manage releases. Create a changeset file for each fix or feature, and use the `changesets` skill when adding, editing, or reviewing SDK changelog wording.

## Testing

Unit tests live next to source as `*.test.ts`; run a single file with `bun run test -- path/to/file.test.ts`. Live integration tests run manually against testnets. They require a matching orchestrator API key, and funded scenarios also require a funded testnet account. See [docs/testing.md](docs/testing.md).

## Code generation

The SDK Reference (from JSDoc) and the orchestrator wire types (from the OpenAPI spec) are both generated — don't hand-edit. Regenerate with `bun run generate:reference` and `bun run generate:wire`. See [docs/codegen.md](docs/codegen.md). When writing the JSDoc that feeds the reference, use the `jsdoc` skill.
