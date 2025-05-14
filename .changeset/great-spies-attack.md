---
"@rhinestone/sdk": patch
---

Improvements:

- default value for `tokenRequests` (1 unit of ether)
- make `sourceChain` optional (when possible)
- executor flow: custom `gasLimit`
- add portfolio util to `rhinestoneAccount`
- add an optional `acceptsPreconfirmations` param to `waitForExecution`


Bug fixes:

- user op flow: fix `maxPriorityFeePerGas` (arbitrum sepolia)
- make sure the statuses are handled properly when waiting for a bundle result
