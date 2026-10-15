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
- `bun run check:architecture` - Enforce dependency direction, import boundaries, and host-independent ordering.
- `bun run typecheck` - Type check without emit

## Stack

- Runtime: Bun
- Language: TypeScript (strict mode)
- Testing: Vitest
- Linting: Biome
- Dependencies: viem (peer), jose (optional peer for `jwt-server`); the published package has no runtime dependencies

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
- `/src/hypercore` - HyperCore order builders and Hyperliquid market reads (`@rhinestone/sdk/hypercore`)
- `/src/errors`, `/src/utils`, `/src/smart-sessions` - Published compatibility barrels
- `/src/jwt-server` - Server-side JWT signer (Express-compatible middleware + Web handlers)
- `/test` - Unit helpers, type tests, and live integration tests

See [docs/architecture.md](docs/architecture.md) for how these fit together and the transaction flow.

## Docs

- [Architecture](docs/architecture.md) — layering and transaction flow
- [Testing](docs/testing.md) — unit, type, and live integration tests
- [Code generation](docs/codegen.md) — SDK Reference and orchestrator wire types

Keep these in sync with the code — update the relevant doc in the same PR as any change it covers.

## Branching

- `main` — **v3** development; snapshots publish under `@dev`
- `release` — stable **v3** releases; publishes to `@latest`
- `v2` — **v2** maintenance; publishes to `@v2-latest`
- `v1` — **v1** maintenance; publishes to `@v1-latest`
- `solana` — frozen historical v3/Solana/Caucasus branch; it must not publish

Target `main` for v3 changes, `v2` for v2 maintenance, and `v1` for v1 fixes. Carry applicable fixes between generations deliberately.

On `v2`, include a changeset with each consumer-facing change. Pushes run unit tests, build, and publint, then Changesets opens or updates a `Release` PR. Merging that PR publishes the versioned package under `v2-latest`; it must never move `latest` or `dev`. The manifest, changelog, and default SDK version header start from the already-published `2.17.1`, so the next patch is `2.17.2`.

Maintenance releases use the existing npm OIDC trusted publisher for `.github/workflows/release.yaml` and the release-bot GitHub App. They do not promote to `release` or regenerate the current v3 reference. Install the maintenance line with `@rhinestone/sdk@v2-latest` after its first publication, or pin an exact v2 version until then.

Only `main` publishes `@dev` snapshots and opens `main` → `release` promotion PRs. Use the `release-promotion` skill for v3 releases; merging the Changesets `Release` PR publishes `@latest`, which cannot be undone.

## Patterns

- Use viem types for addresses, chains, and hex values
- Ordering and case conversion must never depend on the host locale — sort hex values with `compareHexValues` and use the default `.sort()` comparator or `toLowerCase`/`toUpperCase` elsewhere; `check:architecture` rejects `localeCompare`, `toLocale*Case`, and `Intl.Collator` in `src/`
- Placement of a new public method — `RhinestoneSDK` vs `RhinestoneAccount`: put it on **`RhinestoneSDK`** when its data is scoped to the API key's project/integrator and needs no account (auth-only orchestrator reads, e.g. `getIntentStatus`, `splitIntents`, `getAppFeeBalances`); put it on **`RhinestoneAccount`** only when it is genuinely account-scoped (needs the account address / owners / on-chain state, e.g. `getPortfolio`, signing). Exposing project-scoped data as an account method misleads callers into reading it as account-scoped.
- Account implementations live in `/src/accounts/adapters/*.ts`
- Public API is the union of the explicit exports from `src/index.ts` and the subpath exports in `src/package.json` (`/actions`, `/errors`, `/jwt-server`, `/smart-sessions`, etc.) — adding, renaming, or removing exports is a breaking change. Determine root exports from export declarations or the packed package; a symbol imported into `src/index.ts` only for use in a public signature is not itself a named export.
- When changing the public surface (types, exports, account/action APIs, config, errors, defaults), use the `dx` skill to keep it safe and ergonomic to integrate
- When writing or editing JSDoc on public symbols (it generates the published SDK Reference), use the `jsdoc` skill
- The project uses `changeset` to manage releases. Create a changeset file for each fix or feature, and use the `changesets` skill when adding, editing, or reviewing SDK changelog wording. Any change that adds a public export, including a publicly thrown error, requires a minor changeset because patch changesets must preserve the exact export surface.

## Testing

Unit tests live next to source as `*.test.ts`; run a single file with `bun run test -- path/to/file.test.ts`. Live integration tests run manually against testnets. They require a matching orchestrator API key, and funded scenarios also require a funded testnet account. See [docs/testing.md](docs/testing.md).

## Code generation

The SDK Reference (from JSDoc) and the orchestrator wire types (from the OpenAPI spec) are both generated — don't hand-edit. Regenerate with `bun run generate:reference` and `bun run generate:wire`. See [docs/codegen.md](docs/codegen.md). When writing the JSDoc that feeds the reference, use the `jsdoc` skill.
