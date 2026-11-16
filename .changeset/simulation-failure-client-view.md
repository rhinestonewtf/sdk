---
'@rhinestone/sdk': minor
---

Align `SimulationFailedError` with the simulation details the orchestrator now returns.

- Expose `revertedBy` on the error and on each entry of `simulations`: the contract that reverted, when the orchestrator recovered it from a call trace.
- Keep the `ACCOUNT_SETUP_FAILED`, `SESSION_POLICY_VIOLATION`, and `SWAP_SLIPPAGE` categories on `category` and `simulations[].errorCategory` instead of dropping them to `undefined`.
- Deprecate `simulations[].call` and `simulations[].details`. The orchestrator no longer returns the simulated call or simulator state, so both are always `undefined`; they will be removed in the next major version.
