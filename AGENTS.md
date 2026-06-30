# Rhinestone SDK

End-to-end chain abstraction and modularity toolkit for Ethereum smart accounts.

Uses the Rhinestone infrastructure for cross-chain intent orchestration under the hood.

Docs: https://docs.rhinestone.dev/smart-wallet

## Commands

- `bun run build` - Build the project (clean + tsc)
- `bun run test` - Run tests (vitest).
- `bun run test:integration:smoke` - Run the live SDK smoke suite against testnets.
- `bun run test:integration` - Run all live SDK integration tests.
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
- `/src/accounts` - Smart account implementations (Safe, Kernel, Nexus, Startale)
- `/src/actions` - Atomic account actions (ECDSA, passkeys, smart-sessions, recovery)
- `/src/auth` - Auth provider (API key / JWT modes)
- `/src/execution` - Transaction execution and signing
- `/src/jwt-server` - Server-side JWT signer (Express + Web handlers)
- `/src/modules` - Module validators and chain abstraction
- `/src/orchestrator` - Rhinestone API client
- `/test` - Unit helpers, type tests, and live integration tests

See [docs/architecture.md](docs/architecture.md) for how these fit together and the transaction flow.

## Docs

- [Architecture](docs/architecture.md) — layering and transaction flow
- [Testing](docs/testing.md) — unit, type, and live integration tests
- [Code generation](docs/codegen.md) — SDK Reference and orchestrator wire types

## Branching

The SDK uses three long-lived branches while v2 stabilizes:

- `main` — dev releases for **v1** SDK
- `release` — beta releases for **v2** SDK
- `v1` — prod releases for **v1** SDK

Where to open PRs:

- **v2 changes** → target `release`
- **Bug fixes for existing users** → target `main` (will be ported to v1/v2 as needed)

Once v2 is stable, we'll switch back to the standard `main` (dev) / `release` (prod) flow.

## Patterns

- Use viem types for addresses, chains, and hex values
- Account implementations live in `/src/accounts/*.ts`
- Public API is the union of `src/index.ts` re-exports and the subpath exports in `src/package.json` (`/actions`, `/errors`, `/jwt-server`, `/smart-sessions`, etc.) — adding, renaming, or removing exports is a breaking change
- When changing the public surface (types, exports, account/action APIs, config, errors, defaults), use the `dx` skill to keep it safe and ergonomic to integrate
- When writing or editing JSDoc on public symbols (it generates the published SDK Reference), use the `jsdoc` skill
- The project uses `changeset` to manage releases. Create a changeset file for each fix or feature, and use the `changesets` skill when adding, editing, or reviewing SDK changelog wording.

## Testing

Unit tests live next to source as `*.test.ts`; run a single file with `bun run test -- path/to/file.test.ts`. Live integration tests need API keys and run manually. See [docs/testing.md](docs/testing.md).

## Code generation

The SDK Reference (from JSDoc) and the orchestrator wire types (from the OpenAPI spec) are both generated — don't hand-edit. Regenerate with `bun run reference` and `bun run generate:wire`. See [docs/codegen.md](docs/codegen.md). When writing the JSDoc that feeds the reference, use the `jsdoc` skill.
