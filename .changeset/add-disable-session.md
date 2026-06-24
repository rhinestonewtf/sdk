---
'@rhinestone/sdk': minor
---

Add `experimental_disableSession` to the smart-sessions actions. Removes a single enabled session from an account via the emissary's `removeConfig`. The account executes the call itself, so the user authorizes it by signing the outer transaction — no separate session-digest signature is needed. Takes the resolved session and an `expires` deadline (`Date`).
