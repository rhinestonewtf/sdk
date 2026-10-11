---
'@rhinestone/sdk': minor
---

Add the `validateSession` warning `ACTION_WINDOW_SHARED_PERMISSION_ID` for a window on a `permissions` function or a raw `time-frame` action in a `zeroHash`-salted session, which shares its permissionId with any other zero-salt session of the same owners, so the window may not be installed when an intent enables the session. Use `saltMode: 'strict'` (restricted sessions) or a fresh session key.
