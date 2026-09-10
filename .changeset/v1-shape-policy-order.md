---
'@rhinestone/sdk': patch
---

`saltMode: 'v1'` now reproduces a 1.x digest when the scope carries a spend
cap. The cap adds a second policy to the approve action, and it was emitted
ahead of the params policy rather than after it as 1.x does. Uncapped scopes
were already correct and are unchanged, as is any session that does not set
`saltMode`.
