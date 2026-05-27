---
'@rhinestone/sdk': patch
---

Use per-chain mock signature shapes during quote simulation. Steady-state ERC-1271 bundles no longer pay the validation gas of an `ENABLE`-mode session enable, giving more accurate gas estimates.
