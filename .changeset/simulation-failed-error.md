---
'@rhinestone/sdk': minor
---

Surface orchestrator `SIMULATION_FAILED` responses as a typed `SimulationFailedError`, preserving classification fields such as `category`, `errorSelector`, `errorName`, `errorArgs`, `retryable`, `retryHint`, `simulations`, and `nonce` so callers can re-prepare stale submissions when instructed.
