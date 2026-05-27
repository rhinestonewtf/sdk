---
'@rhinestone/sdk': patch
---

Normalize `BridgeFill.destinationChainId` to a numeric chain ID. The orchestrator returns CAIP-2 strings; the SDK now decodes them to numbers for consistency with the rest of the API.
