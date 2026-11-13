---
"@rhinestone/sdk": patch
---

Support chain-agnostic multi-leg intent payloads on `2026-04.blanc`, signing once and authorizing every leg chain for EIP-7702 accounts. Smart sessions, quorum owners and Startale's K1 validator reject payloads spanning multiple chains during preparation, before signing, because their signatures bind to one chain.
