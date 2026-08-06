---
'@rhinestone/sdk': minor
---

Forward the HyperCore delivery venue on token requests. `tokenRequests[].balance` (`'spot' | 'perp'`) now reaches the orchestrator instead of being dropped while the intent is rebuilt, so a HyperCore destination can be delivered to the recipient's spot wallet rather than always landing in perp margin. Required on HyperCore destinations by the orchestrator and rejected on every other chain.
