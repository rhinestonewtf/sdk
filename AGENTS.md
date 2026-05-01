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
- `/src/accounts` - Smart account implementations (Safe, Kernel, Nexus, Startale)
- `/src/actions` - Atomic account actions (ECDSA, passkeys, smart-sessions, recovery)
- `/src/auth` - Auth provider (API key / JWT modes)
- `/src/execution` - Transaction execution and signing
- `/src/jwt-server` - Server-side JWT signer (Express + Web handlers)
- `/src/modules` - Module validators and chain abstraction
- `/src/orchestrator` - Rhinestone API client
- `/test` - Integration tests

## Patterns

- Use viem types for addresses, chains, and hex values
- Account implementations live in `/src/accounts/*.ts`
- Public API is the union of `src/index.ts` re-exports and the subpath exports in `src/package.json` (`/actions`, `/orchestrator`, `/jwt-server`, `/smart-sessions`, etc.) — adding, renaming, or removing exports is a breaking change
- The project is using `changeset` to manage releases. Create a changeset file for each fix or feature.

## Testing

- Run single test: `bun run test -- path/to/file.test.ts`
- Tests use prool for local chain testing
- Integration tests in `/test` require `.env` configuration
- Make sure to remove the `src/dist` build folder before running integration tests
