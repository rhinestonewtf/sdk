---
'@rhinestone/sdk': major
---

Switch the orchestrator client to the `2026-04.blanc` API version.

- Bump `API_VERSION` to `2026-04.blanc`.
- Rename the public types: `Quote` / `SignData` / `Cost` /
  `CostTokenEntry` / `FeeBreakdown` / `Fees` / `FeeToken` /
  `EstimatedFillTime` / `Price` / `UsdAmount` / `TokenRequirements`
  replace `IntentRoute` / `IntentOp` / `IntentCost` / `feeBreakdownUSD`.
- Methods aligned with the orchestrator: `createQuote`, `getSplit`,
  `createIntent`, `getIntent`, `getPortfolio`. `getIntentCost` and
  `getMaxTokenAmount` are dropped.
- One error envelope (`{ code, message, traceId, details }`); error
  classes mapped per `code`. SDK-local `UnsupportedChainError` /
  `UnsupportedTokenError` no longer extend `OrchestratorError`.
- CAIP-2 at the HTTP boundary; consumer surface stays numeric.
- `IntentInput` is unchanged for consumers; the client translates
  `destinationGasUnits` → `destinationGasLimit`,
  `sponsorSettings.gasSponsored/bridgeFeesSponsored/swapFeesSponsored` →
  `gas`/`bridgeFees`/`swapFees`, and the flat-array `accountAccessList`
  → `{ chainIds, tokens }` on the way out.
- Singular `account.mockSignature` is gone; only the per-chain
  `mockSignatures` map is supported.
- `IntentStatus` returns `accountAddress` (was `userAddress`); portfolio
  responses use `symbol` / `decimals` / `chains` / `address` (were
  `tokenName` / `tokenDecimals` / `tokenChainBalance` / `tokenAddress`).
