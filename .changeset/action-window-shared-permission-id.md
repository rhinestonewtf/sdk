---
'@rhinestone/sdk': patch
---

`validateSession` warns with `ACTION_WINDOW_SHARED_PERMISSION_ID` when a restricted session sets a window on a `permissions` function or a raw `time-frame` action and is salted with `zeroHash` (the default `saltMode`). Such a session shares its permissionId with every other session of the same owners, so if one of them is already enabled, the window is not installed. Use `saltMode: 'strict'` or a fresh session key. Sessions already salted (`oneTimeUse`, claim policies, a settlement-scoped permit, or `saltMode` `'strict'` / `'v1'`) get no warning. No session's permissionId or enable digest changes.
