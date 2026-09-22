---
'@rhinestone/sdk': major
---

Make `IntentAccountView.authority` optional for Swig account summaries because historical intent records may not contain authority evidence. Guard `authority` before discriminating its `secp256k1` or `secp256r1` kind; signing requests and caller-supplied authorization remain required.

Remove the obsolete `sponsored.swapValue` option. Use `sponsored.swaps` for swap sponsorship; eligible par-swap value sponsorship is now controlled by the orchestrator under that category.
