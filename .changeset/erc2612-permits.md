---
"@rhinestone/sdk": minor
---

EOA accounts sign the ERC-2612 permit the orchestrator offers in `tokenRequirements[chainId][token].permit` and submit it with the intent as `signatures.permits`, in place of the onchain Permit2 approve. `signTransaction` returns them as `permitSignatures`, and `sendTransaction` signs them too. Where a permit is offered, skip the approve transaction.
