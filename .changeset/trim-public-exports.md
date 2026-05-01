---
'@rhinestone/sdk': major
---

- Remove the `@rhinestone/sdk/actions/compact` subpackage entry and its helpers.
- Remove the public `deployAccountsForOwners` helper.
- Remove the public `checkERC20AllowanceDirect` helper.
- Remove the public `getPermit2Address` helper.
- Move `walletClientToAccount` from the package root to `@rhinestone/sdk/utils`.
- Move `wrapParaAccount` from the package root to `@rhinestone/sdk/utils`.
- Move `toSession` from the package root to `@rhinestone/sdk/smart-sessions`.
- Remove the public `getSupportedTokens` helper.
- Remove the public `getTokenAddress` helper.
- Remove the public `getTokenDecimals` helper.
- Remove the public `getAllSupportedChainsAndTokens` helper.
