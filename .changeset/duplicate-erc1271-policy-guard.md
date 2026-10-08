---
'@rhinestone/sdk': patch
---

Refuse a session that would carry the same ERC-1271 policy contract twice. The list is an address set and each config is keyed per `(policy, configId)`, so a repeated address stores once and keeps only the last config — the session would enforce one of the declared restrictions while reporting success for all of them. This replaces the count-based check on Permit2 claim policies, which was only incidentally correct: several declared permits collide because they share a policy contract, not because there is more than one of them. A future claim policy at a different address is unaffected.
