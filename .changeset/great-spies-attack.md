---
"@rhinestone/sdk": patch
---

Bug fixes:

- default value for `tokenRequests` (1 unit of ether)
- make `sourceChain` optional (when possible)
- executor flow: custom `gasLimit`
- user op flow: fix `maxPriorityFeePerGas` (arbitrum sepolia)
- add portfolio util to `rhinestoneAccount`
- make sure the statuses are handled properly when waiting for a bundle result
