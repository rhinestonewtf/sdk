---
'@rhinestone/sdk': minor
---

Remove `saltMode`. A restricted session's salt hashes the actions alone, which
is what it did by default; an unrestricted one stays on `zeroHash`.

`'v1'` only ever named that default. `'strict'` was meant to let a session
built here be rebuilt on 2.x, but the majors also pin different policy
addresses, so matching the salt still left the digest different — and a
session built with it matched neither shape the deposit service rebuilds,
failing every deposit for that account.

**This is a breaking type change shipped in a minor, deliberately.** Removing
an exported field warrants a major, and this line has none left: a major from
1.x is 2.0.0, which is published and belongs to the next major. The option was
released this morning in 1.18.0, produces sessions that cannot be settled, and
has no adopters, so removing it is judged safer than leaving it reachable.
Anyone who did set it should drop it; the default was always the behaviour
they wanted.
