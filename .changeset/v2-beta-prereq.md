---
'@rhinestone/sdk': major
---

- ESM-only build; CJS `require('@rhinestone/sdk')` is no longer supported.
- Internal subpath exports are dropped — use the curated entry points (`./actions/*`, `./errors`, `./utils`, `./smart-sessions`, `./jwt-server`, etc.).
