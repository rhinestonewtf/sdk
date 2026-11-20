// source: owned dev quote 0048ea94ba509be0176a6f890f3396e6.
export const permit2Types = {
  PermitBatchWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions[]' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'mandate', type: 'Mandate' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Token: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Ops: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  Op: [
    { name: 'vt', type: 'bytes32' },
    { name: 'ops', type: 'Ops[]' },
  ],
  Target: [
    { name: 'recipient', type: 'address' },
    { name: 'tokenOut', type: 'Token[]' },
    { name: 'targetChain', type: 'uint256' },
    { name: 'fillExpiry', type: 'uint256' },
  ],
  Mandate: [
    { name: 'target', type: 'Target' },
    { name: 'minGas', type: 'uint128' },
    { name: 'originOps', type: 'Op' },
    { name: 'destOps', type: 'Op' },
    { name: 'q', type: 'bytes32' },
  ],
} as const

export const singleChainOpsTypes = {
  SingleChainOps: [
    { name: 'account', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'op', type: 'Op' },
    { name: 'gasRefund', type: 'GasRefund' },
  ],
  Op: permit2Types.Op,
  Ops: permit2Types.Ops,
  GasRefund: [
    { name: 'token', type: 'address' },
    { name: 'exchangeRate', type: 'uint256' },
    { name: 'overhead', type: 'uint256' },
  ],
} as const
