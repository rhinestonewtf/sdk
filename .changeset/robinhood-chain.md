---
"@rhinestone/sdk": patch
---

Bump @rhinestone/shared-configs to 1.7.8 to add Robinhood Chain (4663). Raise the
`viem` peer floor to ^2.55.0 — shared-configs 1.7.8's generated networks import
`robinhood` from `viem/chains`, which was added in viem 2.55.0; on older viem the
package crashes at module load.
