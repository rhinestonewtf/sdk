# @rhinestone/sdk

## 0.13.1

### Patch Changes

- 6e190c9: - Custom JSON-RPC providers (Alchemy)
  - Sonic support

## 0.13.0

### Minor Changes

- 2267d56: Install intent executor module.
- 4976e8e: Custom accounts

## 0.12.8

### Patch Changes

- fd9d430: Provide default `tokenTransfers` value

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
