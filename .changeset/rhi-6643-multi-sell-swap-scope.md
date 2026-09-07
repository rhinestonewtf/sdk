---
'@rhinestone/sdk': minor
---

`swap.sell` accepts `tokens` as well as `token`, so one session can authorise spending any of several tokens — for an account that may receive whichever the sender chooses. Each token gets its own approve permission, and the swap actions accept any of them.

Passing a single `token` is unchanged: same permissions, same actions, same session digest, so sessions already signed against it keep working. An empty `tokens` list, a repeated token, or a sell token that is also the buy token are rejected.
