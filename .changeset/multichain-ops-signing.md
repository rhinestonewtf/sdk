---
"@rhinestone/sdk": patch
---

Sign intents whose legs the orchestrator covers with one payload. On the `2026-04.blanc` API version, the orchestrator can serve multi-leg intents as one payload whose signing domain names no chain. Such intents are now signed once, and EIP-7702 accounts authorize every chain a leg runs on. Smart sessions, quorum owners and Startale's K1 validator bind the chain into what they sign, so they refuse payloads whose legs span multiple chains when preparing, before anything is signed.
