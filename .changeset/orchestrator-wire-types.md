---
'@rhinestone/sdk': patch
---

Generate the orchestrator client's wire types from the published OpenAPI spec instead of hand-maintaining them. Wire-shape drift now surfaces as a typecheck error at the client's encode/decode boundary.
