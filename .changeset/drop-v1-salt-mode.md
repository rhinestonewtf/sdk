---
'@rhinestone/sdk': minor
---

Remove `saltMode`.

It was added in 1.18.0 on a premise that does not hold. `'v1'` was already the
default — an alias for the actions-only hash this SDK has always produced — and
`'strict'` was meant to let a session built here be rebuilt on 2.x, which it
cannot do: the two majors also pin different policy addresses, so aligning the
salt closes one of two gaps and the digest still differs.

Worse than useless in practice. A restricted session built with `'strict'`
matches neither shape the deposit service rebuilds — not 2.x, whose policy
addresses differ, and not the 1.x shape, which derives the salt the default
way. Every deposit for such an account would fail.

Nothing is affected that did not set it: `'v1'` was a no-op, the default
derivation is unchanged and pinned by test, and cross-major reproduction is
handled where it belongs, on the 2.x side, which rebuilds a session built here.
