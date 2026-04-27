---
"@rhinestone/sdk": patch
---

Drop `ox` dependency by inlining the single type reference (`WebAuthnP256.SignMetadata`). The SDK had no runtime usage of `ox` — only a type-only import — so this has no behavioral impact. Consumers still get `ox` transitively through `viem` if needed.
