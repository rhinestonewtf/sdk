---
"@rhinestone/sdk": patch
---

Intent status, portfolio, splits and app-fee balance reads use the orchestrator's `2026-04.blanc` API version. Results are unchanged. An unknown chain id in `splitIntents` or in a portfolio chain filter is now reported with blanc's validation message. Validation errors for malformed inputs to the low-level client's portfolio read name blanc's request fields and use its wording.
