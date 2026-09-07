---
'@rhinestone/sdk': minor
---

`swap.sell` accepts `tokens` as well as `token`, so one session can authorise spending any of several tokens. The sell pins become an OR across the list, evaluated on-chain by ArgPolicy. A single `token` is unchanged — same rules, same policy type, same digest — so sessions already signed against it keep working.
