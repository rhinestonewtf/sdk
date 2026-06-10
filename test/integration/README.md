# SDK Integration Tests

These tests run live SDK flows against the production orchestrator on testnets.
They are manual for now and require `INTEGRATION_RHINESTONE_API_KEY`. Funded
specs (smart-session policies and on-chain source-call execution) additionally
require `INTEGRATION_FUNDER_PRIVATE_KEY` — a key whose address holds testnet
native + USDC on the integration chains; without it those specs fail fast with
an actionable message.

```bash
INTEGRATION_RHINESTONE_API_KEY=... bun run test:integration:smoke
```

Run every live integration scenario:

```bash
INTEGRATION_RHINESTONE_API_KEY=... INTEGRATION_FUNDER_PRIVATE_KEY=... \
  bun run test:integration -- --run
```

For verbose per-intent diagnostics on passing and expected-failing cases:

```bash
SDK_ITEST_DEBUG=1 bun run test:integration:smoke
# or
bun run test:integration:smoke:debug
```

Unexpected failures include compact diagnostics by default: phase, duration,
intent id, settlement layer, trace id, transaction result, operation summaries,
and URLs discovered in the error payload.

The smoke suite currently covers:

- sponsored same-chain execution on Base Sepolia
- sponsored cross-chain execution from Base Sepolia to Arbitrum Sepolia
- inline smart-session enablement and execution
- submit-time simulation failure without account deployment
- deployed account reuse

Additional scenarios cover:

- same-chain and cross-chain default Nexus execution
- account kinds on same-chain routes
- signature modes: owner ERC-1271, fresh-session hybrid, enabled-session
  ERC-1271, and tampered-signature rejection
- smart sessions: inline enablement across scope and chain mode, pre-enabled
  use, and scope rejections
- smart-session policies: spending-limit and recipient-allowlist enforcement
  (funded)
- preclaim source calls: enable-op ordering and on-chain execution (funded)
- 7702 missing authorization
- unsupported route errors
