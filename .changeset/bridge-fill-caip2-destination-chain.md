---
'@rhinestone/sdk': patch
---

Parse CAIP-2 `destinationChainId` values on a quote route's `bridgeFill`, so the field stays a numeric chain id when the orchestrator sends `eip155:` or `solana:` ids; a `bridgeFill` with an unrecognized chain id is dropped instead of carrying a string.
