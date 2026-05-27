---
'@rhinestone/sdk': patch
---

Fix claim-only sessions failing on first use. The session is now installed via the emissary on the first intent; subsequent intents on the same session use the cached state.
