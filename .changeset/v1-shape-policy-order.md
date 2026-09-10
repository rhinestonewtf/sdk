---
'@rhinestone/sdk': patch
---

Emit an action's policies in 1.x's order under `saltMode: 'v1'`.

Reproducing a session the 1.x SDK built takes more than the salt. 1.x builds an
approve action as `[arg policy, spending limits]`; here the `spendingLimit`
sugar expands before `params` compiles, so the pair came out reversed. Action
policies are hashed in array order, so the rebuilt digest diverged.

Only visible once the scope carries a spend cap — with no cap the action has a
single policy and nothing to order — which is why the pinned uncapped fixtures
agreed and a capped scope did not. Verified both ways against sessions built by
a real `@rhinestone/sdk@1.18.0`: capped and uncapped digests now match it
exactly.

Scoped to `saltMode: 'v1'`, so no session that does not opt in changes.
