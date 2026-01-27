# Rhinestone SDK

End-to-end chain abstraction and modularity toolkit for Ethereum smart accounts.

Uses the Rhinestone infrastructure for croscc-chain intent orchestration under the hood.

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
- Dependencies: viem (peer), ox, solady

## Structure

- `/src` - Main package source (`@rhinestone/sdk`)
- `/src/accounts` - Smart account implementations (Safe, Kernel, Nexus, Startale)
- `/src/actions` - Atomic account actions (ECDSA, passkeys, smart-sessions, recovery)
- `/src/execution` - Transaction execution and signing
- `/src/orchestrator` - Rhinestone API client
- `/src/modules` - Module validators and chain abstraction
- `/test` - Integration tests

## Patterns

- Use viem types for addresses, chains, and hex values
- Account implementations live in `/src/accounts/*.ts`

## Testing

- Run single test: `bun run test -- path/to/file.test.ts`
- Tests use prool for local chain testing
- Integration tests in `/test` require `.env` configuration
- Make sure to remove the `src/dist` build folder before running integration tests
