---
'@rhinestone/sdk': minor
---

Support `signTypedData` with Smart Sessions whose `signing` is `scoped`: typed data whose domain and type the session allows is signed as an ERC-7739 signature on Nexus and Startale accounts. Typed data outside the scope, plain messages, and Safe and Kernel accounts are refused before any signer runs. Unrestricted sessions sign as before. Verifying these signatures requires the SmartSessionEmissary release that reads ERC-7739 typed contents.
