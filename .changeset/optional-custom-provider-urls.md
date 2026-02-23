---
"@rhinestone/sdk": patch
---

Allow custom provider URLs to be specified for only the chains you need. When using `provider.type: 'custom'`, chains without a configured URL will now fall back to the default public provider instead of throwing an error. This improves DX by removing the requirement to specify URLs for all chains in the `sourceChains` array.
