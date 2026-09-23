---
'@rhinestone/sdk': major
---

Change `SigningScope.hyperCore` on EVM signing requests from a single HyperCore agent registration to a non-empty list of `{ action, nonce, agent, slot }` in slot order: one on a per-leg request, every registration on an aggregate request. Read `scope.hyperCore[0]` where you read `scope.hyperCore` before, or iterate the list.
