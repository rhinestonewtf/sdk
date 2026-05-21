---
'@rhinestone/sdk': patch
---

Shape each per-chain mock signature to match that chain's resolved signing shape. `buildMockSignature` previously always emitted the ENABLE-mode (verifyExecution) payload, so the orchestrator simulated `verifyExecution` even for steady-state ERC-1271 bundles — overestimating validation gas. It now threads the per-chain resolved `verifyExecutions` so an already-enabled session emits the plain ERC-1271 mock shape (mode byte `0x00`) and a first-use session keeps the ENABLE shape (mode byte `0x01`), letting the orchestrator pick the matching gas simulation. Note these mock shapes are per-chain and may differ across chains; the declared `signatureMode` is a single global value resolved conservatively, so a chain's mock shape need not match the global mode in mixed states.
