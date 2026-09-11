---
'@rhinestone/sdk': patch
---

Stop sending the placeholder `x-api-key: jwt` header alongside the bearer credential in `experimental_jwt` auth mode. Requests now present only the access token, which every Rhinestone orchestrator environment accepts.
