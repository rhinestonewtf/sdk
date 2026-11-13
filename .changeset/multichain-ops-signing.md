---
"@rhinestone/sdk": patch
---

Support chain-independent MultiChainOps payloads without a domain chain on `2026-04.blanc` for ECDSA/multisig and passkey owners. The SDK reuses a signature for a shared origin/destination payload. EIP-7702 accounts authorize all required leg chains plus the target unless a recipient is supplied, skipping existing delegation. Smart sessions, quorum owners and Startale's K1 validator reject payloads spanning multiple chains during preparation, before signing, because their signatures bind to one chain.
