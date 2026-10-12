---
'@rhinestone/sdk': minor
---

`validateSession` now reports `warnings` beside `refusals`: things `createSession` accepts but that do not hold the way the definition may read. Each warning has a stable `code` (listed in `SESSION_WARNING_CODES`, exported with the `SessionWarning` and `SessionWarningCode` types), a `message` and, when it is about one permit, its `permitIndex`. The field is present only when there is a warning, and a warning never makes `createSession` throw.

- `FALLBACK_RECIPIENT_PIN_ACROSS_ONLY`: a session with `fallback` holds a Permit2-layer permit that pins the recipient (`allowRecipientNotAccount` left `false`, the default, or a `to` leg with a `recipient` other than `'any'`). The pin is enforced by the Permit2 claim policy, which checks `ACROSS` claims only. With `fallback`, intents may also settle through IntentExecutor layers, whose calls the wildcard admits without reading their recipient, so the pin does not hold there. To enforce a recipient on IntentExecutor layers, use a settlement-scoped permit (the recipient is pinned in the layer's calldata) without `fallback`.
- The docs of `allowRecipientNotAccount`, `to`, `recipient`, `recipientIsAccount` and `fallback` now state this.
