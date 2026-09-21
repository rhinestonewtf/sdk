---
paths:
  - "src/transactions/intents/**"
  - "src/signing/**"
  - "src/hypercore/**"
---

# Intents and signing

- An intent to a HyperCore or non-EVM destination throws before quoting unless `sourceChains` names an EVM chain: the
  account runtime is hosted on a source chain (`selectAccountChain`, `prepare.ts`), so every example and test must pass one.
- A validator or account route that binds the chain id into the signed hash must refuse payloads where
  `signatureSpansMultipleChains` is true, as quorum and Startale K1 (`typed-data.ts`) and smart sessions
  (`session-signing.ts`) do. The orchestrator cannot refuse them, because no request field names the client's validator.
