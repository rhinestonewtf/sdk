---
'@rhinestone/sdk': minor
---

Make `expires` optional in `experimental_disableSession`. Omitting it disables the session with no expiry (`maxUint256` sentinel), matching the enable paths, instead of forcing callers to invent a far-future `Date`.
