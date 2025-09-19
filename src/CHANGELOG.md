# @rhinestone/sdk

## 1.0.0-alpha.32

### Patch Changes

- 883706c: Resource locking

## 1.0.0-alpha.31

### Patch Changes

- 533c84f: - Selecting source assets (per chain or globally) by setting `sourceAssets`
  - Don't pass the default token request when using same-chain settlement
  - Choosing a fee token by setting `feeAsset`

## 1.0.0-alpha.30

### Patch Changes

- 912ee8a: Permit2 signing

## 1.0.0-alpha.29

### Patch Changes

- 865142b: Add `isDeployed` utility

## 1.0.0-alpha.28

### Patch Changes

- d39b2ba: Expose missing types

## 1.0.0-alpha.27

### Patch Changes

- 9b1fa4f: Custon accounts

## 1.0.0-alpha.26

### Patch Changes

- 359d07f: Existing accounts support ("Bring your own account")

## 1.0.0-alpha.25

### Patch Changes

- 82f6851: Add relay types

## 1.0.0-alpha.24

### Patch Changes

- 12b4d87: Add signer conversion helpers methods

## 1.0.0-alpha.23

### Patch Changes

- 6107c7e: allow for settlement layer selection

## 1.0.0-alpha.22

### Patch Changes

- 436daea: Add optional orchestratorUrl parameter for internal testing

## 1.0.0-alpha.21

### Minor Changes

- 6602670: Add Sonic support

## 1.0.0-alpha.20

### Patch Changes

- 9e034b8: Take sponsorship into account in `getMaxSpendableAmount`

## 1.0.0-alpha.19

### Patch Changes

- 0bb2c42: Fix API request in `getMaxTokenAmount`

## 1.0.0-alpha.18

### Patch Changes

- 6750bdf: Move `@rhinestone/shared-configs` into package deps

## 1.0.0-alpha.17

### Patch Changes

- ec215ed: Add transaction simulation method

## 1.0.0-alpha.16

### Patch Changes

- 29ccb04: Custom accounts support

## 1.0.0-alpha.15

### Patch Changes

- f12656f: Passkey multisig

## 1.0.0-alpha.14

### Patch Changes

- cf08197: Make Rhinestone API key optional (staging only)

## 1.0.0-alpha.13

### Patch Changes

- a6b1718: Export the registry methods getSupportedTokens and getTokenAddress

## 1.0.0-alpha.12

### Patch Changes

- 109f624: Account signing utilities for message and typed data signing

## 1.0.0-alpha.11

### Patch Changes

- 9719915: Fee sponsorship

## 1.0.0-alpha.10

### Patch Changes

- 5bd056d: 7702 delegations

## 1.0.0-alpha.9

### Minor Changes

- b7b5faa: Support Startale account

## 1.0.0-alpha.8

### Patch Changes

- 8e767ba: add soneium

## 1.0.0-alpha.7

### Patch Changes

- 1d76bad: Use latest contracts

## 1.0.0-alpha.6

### Patch Changes

- 43429c6: Multi source chain

## 1.0.0-alpha.5

### Patch Changes

- f6456f0: Multi-factor validator

## 1.0.0-alpha.4

### Patch Changes

- 18566eb: Intent-based account deployments

## 1.0.0-alpha.3

### Patch Changes

- 54f5506: Allow using token symbols
- ef7fd0e: - Custom JSON-RPC providers
  - Biconomy bundler/paymaster
  - Make `tokenRequests` optional

## 1.0.0-alpha.2

### Patch Changes

- 50774b2: ERC20 deposits for TheCompact

## 1.0.0-alpha.1

### Patch Changes

- e4dc710: Fix portfolio

## 1.0.0-alpha.0

### Major Changes

- 036f989: The Compact support

## 0.12.7

### Patch Changes

- a438baf: Custom type-safe errors

## 0.12.6

### Patch Changes

- c584325: Fix `exports` path

## 0.12.5

### Patch Changes

- e4ea79d: Fix `solady` import

## 0.12.4

### Patch Changes

- d95819b: Handle custom signers in `prepareTransaction`

## 0.12.3

### Patch Changes

- 38e4bd7: Adds account state read functions:

  - `getValidators`
  - `getOwners`
  - `areAttestersTrusted`

- e697296: Multi-chain session keys
- ec2a7d1: Make paymaster use optional

## 0.12.2

### Patch Changes

- a551259: Fix portfolio endpoint request encoding

## 0.12.1

### Patch Changes

- 5b6d52d: remove default access list

## 0.12.0

### Minor Changes

- 6f73fea: - Validator installation
  - Validator uninstallation
  - Custom signers

## 0.11.3

### Patch Changes

- 034c36e: Add missing action exports

## 0.11.2

### Patch Changes

- 8a04205: Add Social Recovery (guardians) support

## 0.11.1

### Patch Changes

- b075665: add zksync to chains

## 0.11.0

### Minor Changes

- f84da0d: Kernel V3 support

## 0.10.3

### Patch Changes

- 6d175c4: add zksync to supported chains

## 0.10.2

### Patch Changes

- 238b12b: Fix: remove support for USDT on testnets

## 0.10.1

### Patch Changes

- f611ebe: Add support for USDT

## 0.10.0

### Minor Changes

- 262a06d: Expose low-level APIs:

  - deploy
  - prepareTransaction
  - signTransaction
  - submitTransaction

## 0.9.0

### Minor Changes

- 07bab17: Pass tokenPrices, gasPrices and opGasParams on POST /bundles

## 0.8.3

### Patch Changes

- c198a38: Fix export paths

## 0.8.2

### Patch Changes

- 568ee10: Disallow Polygon|ETH usage

## 0.8.1

### Patch Changes

- c034b30: Use account access list for source chain

## 0.8.0

### Minor Changes

- 2a01beb: Switch to CJS

## 0.7.10

### Patch Changes

- 0feea4b: Fix incorrect condition in `waitForExecution`

## 0.7.9

### Patch Changes

- a01c5dc: CJS build for Orchestrator utilities

## 0.7.8

### Patch Changes

- 8cdc036: Export `OrderCost`, `OrderCostResult`, `OrderFeeInput`, `UserTokenBalance` orchestrator types.

## 0.7.7

### Patch Changes

- 0892b1e: Add `applyInjectedExecutions` and `getSupportedTokens` orchestrator utils

## 0.7.6

### Patch Changes

- 410af4a: Add `isTokenAddressSupported` orchestrator utility

## 0.7.5

### Patch Changes

- 5a063c7: Improvements:

  - default value for `tokenRequests` (1 unit of ether)
  - make `sourceChain` optional (when possible)
  - executor flow: custom `gasLimit`
  - add portfolio util to `rhinestoneAccount`
  - add an optional `acceptsPreconfirmations` param to `waitForExecution`

  Bug fixes:

  - user op flow: fix `maxPriorityFeePerGas` (arbitrum sepolia)
  - make sure the statuses are handled properly when waiting for a bundle result

## 0.7.4

### Patch Changes

- e86fc28: Adds new "preconfirmed" status for bundles

## 0.7.3

### Patch Changes

- eb0fd7f: Reduce bundle size from 3.5MB to 200KB

## 0.7.2

### Patch Changes

- 656c85d: Don't install the smart session compatibility module by default

## 0.7.1

### Patch Changes

- 19d3202: - Use public Pimlico bundler endpoint by default
  - Use dev orchestrator instance for testnet transactions

## 0.7.0

### Minor Changes

- b293aab: Change `getTokenBalanceSlot` function signature

### Patch Changes

- b293aab: Fix ESM build import paths

## 0.6.4

### Patch Changes

- 7c6427e: Export `getTokenSymbol` util

## 0.6.3

### Patch Changes

- be4870a: Add `getTokenSymbol` util

## 0.6.2

### Patch Changes

- ef5d38a: Add `getRhinestoneSpokePoolAddress` method

## 0.6.1

### Patch Changes

- 7c2e4d3: Export `dist/src/orchestrator` subpackage

## 0.6.0

### Minor Changes

- 1c8a6d4: Export BundleStatus enum from the orchestrator.

## 0.5.4

### Patch Changes

- 1eae19b: Add missing export for Orchestrator

## 0.5.3

### Patch Changes

- b92f390: Add missing bundle status values

## 0.5.2

### Patch Changes

- 1eeab87: Fix types

## 0.5.1

### Patch Changes

- ead932d: Export missing types

## 0.5.0

### Minor Changes

- 83f1548: Return chain IDs instead of viem chain objects in the transaction result
- 83f1548: Rename `sendTransactions` → `sendTransaction`

### Patch Changes

- 83f1548: Allow deploys via ERC-4337 bundler

## 0.4.3

### Patch Changes

- 221e20f: Add "max spendable token amount" util

## 0.4.2

### Patch Changes

- ed82f25: Expose Orchestrator service and utilities

## 0.4.1

### Patch Changes

- 38b337f: Smart session support for Safe7579 accounts.

## 0.4.0

### Minor Changes

- d224af3: Fix timestamp policy encoding

## 0.3.0

### Minor Changes

- 881a353: Smart sessions

## 0.2.1

### Patch Changes

- 0d9a187: EIP-7702 support

## 0.2.0

### Minor Changes

- a1ee520: Biconomy Nexus support

## 0.1.0

### Minor Changes

- 0d94c35: Initial release

### Patch Changes

- 1f4f100: Passkey signers
