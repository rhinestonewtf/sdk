---
'@rhinestone/sdk': minor
---

Deprecate `saltMode`; it is now ignored. The salt always hashes the actions
alone, which is what it did by default.

`'v1'` only ever named that default. `'strict'` was meant to let a session
built here be rebuilt on 2.x, but the majors also pin different policy
addresses, so matching the salt still left the digest different — and a
session built with it matched neither shape the deposit service rebuilds,
failing every deposit for that account. Anything set to `'strict'` now
produces a session that can be rebuilt.

The option stays in the type so 1.18.0 callers keep compiling; it is removed
in the next major.
