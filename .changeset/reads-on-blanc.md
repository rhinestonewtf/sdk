---
"@rhinestone/sdk": patch
---

Intent status, portfolio, splits and app-fee balance reads use the orchestrator's `2026-04.blanc` API version. Results are unchanged. An unknown chain id in `splitIntents` or in a portfolio chain filter is now reported with blanc's validation message.
