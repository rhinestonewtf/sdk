# SDK Integration Tests

These tests run live SDK flows against the production orchestrator on testnets.
They are manual for now and require `INTEGRATION_RHINESTONE_API_KEY`.

```bash
INTEGRATION_RHINESTONE_API_KEY=... bun run test:integration:smoke
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
