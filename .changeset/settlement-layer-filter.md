---
'@rhinestone/sdk': major
---

- `Transaction.settlementLayers` is now `{ include: SettlementLayer[] } | { exclude: SettlementLayer[] }` — you can blacklist specific layers without enumerating every other one.
