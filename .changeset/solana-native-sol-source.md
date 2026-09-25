---
'@rhinestone/sdk': minor
---

Support native SOL as the source asset of a Solana → EVM delivery: `sourceAssets: [{ chain, address: '11111111111111111111111111111111', amount? }]`, capped or uncapped, behaves exactly as an SPL mint. The wallet's rent-exempt reserve is never spendable, so spending the whole balance or a cap takes at most the lamports above it. Same-chain transfers still refuse native SOL, now before quoting with `UnsupportedAccountCapabilityError`.
