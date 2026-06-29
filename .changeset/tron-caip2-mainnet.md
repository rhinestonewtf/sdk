---
'@rhinestone/sdk': patch
---

Use `tron:mainnet` as Tron's canonical CAIP-2 (was `tron:0x2b6653dc`).

Updates the hardcoded `tronMainnet` destination descriptor and bumps `@rhinestone/shared-configs` to `^1.7.0`, so `toCaip2(728126428)` / `fromCaip2('tron:mainnet')` resolve via the registry. Hard cutover: `tron:0x2b6653dc` no longer resolves. Requires shared-configs ≥ 1.7.0.
