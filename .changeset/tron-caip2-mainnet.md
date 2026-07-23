---
'@rhinestone/sdk': patch
---

Use `tron:mainnet` as Tron's canonical CAIP-2 (was `tron:0x2b6653dc`). Updates the hardcoded `tronMainnet` destination descriptor so `toCaip2(728126428)` and `fromCaip2('tron:mainnet')` resolve. Hard cutover: `tron:0x2b6653dc` no longer resolves.
