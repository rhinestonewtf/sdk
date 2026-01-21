# Rhinestone SDK

End-to-end chain abstraction and modularity toolkit for Ethereum smart accounts.

## Commands

- `bun run build` - Build the project (clean + tsc)
- `bun run test` - Run tests (vitest)
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
- `/src/actions` - Account actions (ECDSA, passkeys, smart-sessions, recovery)
- `/src/execution` - Transaction execution and permit2 signing
- `/src/orchestrator` - Cross-chain orchestration client
- `/src/modules` - Module validators and chain abstraction
- `/test` - Integration tests

## Patterns

- Use viem types for addresses, chains, and hex values
- Account implementations live in `/src/accounts/*.ts`
- Exports are defined explicitly in `src/package.json` (no barrel re-exports)
- Biome enforces `noBarrelFile` and `noReExportAll`

## Testing

- Run single test: `bun run test -- path/to/file.test.ts`
- Tests use prool for local chain testing
- Integration tests in `/test` require `.env` configuration
