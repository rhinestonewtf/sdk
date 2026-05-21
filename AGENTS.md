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
- The project is using `changeset` to manage releases. Create a changeset file for each fix or feature.

## Testing

- Run single test: `bun run test -- path/to/file.test.ts`
- Unit tests live next to source as `*.test.ts`.
- Live SDK integration tests live under `/test/integration` as `*.itest.ts`. They require `INTEGRATION_RHINESTONE_API_KEY` and use `vitest.config.integration.ts`.
- Run the live smoke suite with `bun run test:integration:smoke -- --run`.
