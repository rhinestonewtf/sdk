const abi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'intentExecutor', type: 'address', internalType: 'address' },
      { name: 'lens', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  { type: 'fallback', stateMutability: 'nonpayable' },
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'INTENT_EXECUTOR',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'LENS',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'eip712Domain',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1', internalType: 'bytes1' },
      { name: 'name', type: 'string', internalType: 'string' },
      { name: 'version', type: 'string', internalType: 'string' },
      { name: 'chainId', type: 'uint256', internalType: 'uint256' },
      { name: 'verifyingContract', type: 'address', internalType: 'address' },
      { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
      { name: 'extensions', type: 'uint256[]', internalType: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getConfig',
    inputs: [
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'configId', type: 'uint8', internalType: 'uint8' },
      { name: 'validator', type: 'address', internalType: 'address' },
      { name: 'lockTag', type: 'bytes12', internalType: 'bytes12' },
    ],
    outputs: [{ name: 'config', type: 'bytes', internalType: 'bytes' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isValidSignatureWithSender',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' },
      { name: 'hash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'signature', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [{ name: 'result', type: 'bytes4', internalType: 'bytes4' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'removeConfig',
    inputs: [
      { name: 'account', type: 'address', internalType: 'address' },
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct SmartSessionEmissaryConfig',
        components: [
          { name: 'scope', type: 'uint8', internalType: 'enum Scope' },
          {
            name: 'resetPeriod',
            type: 'uint8',
            internalType: 'enum ResetPeriod',
          },
          { name: 'allocator', type: 'address', internalType: 'address' },
          {
            name: 'permissionId',
            type: 'bytes32',
            internalType: 'PermissionId',
          },
        ],
      },
      {
        name: 'disableData',
        type: 'tuple',
        internalType: 'struct SmartSessionEmissaryDisable',
        components: [
          { name: 'allocatorSig', type: 'bytes', internalType: 'bytes' },
          { name: 'userSig', type: 'bytes', internalType: 'bytes' },
          { name: 'expires', type: 'uint256', internalType: 'uint256' },
          {
            name: 'session',
            type: 'tuple',
            internalType: 'struct DisableSession',
            components: [
              {
                name: 'chainDigestIndex',
                type: 'uint8',
                internalType: 'uint8',
              },
              {
                name: 'hashesAndChainIds',
                type: 'tuple[]',
                internalType: 'struct ChainDigest[]',
                components: [
                  { name: 'chainId', type: 'uint64', internalType: 'uint64' },
                  {
                    name: 'sessionDigest',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setConfig',
    inputs: [
      { name: 'account', type: 'address', internalType: 'address' },
      {
        name: 'config',
        type: 'tuple',
        internalType: 'struct SmartSessionEmissaryConfig',
        components: [
          { name: 'scope', type: 'uint8', internalType: 'enum Scope' },
          {
            name: 'resetPeriod',
            type: 'uint8',
            internalType: 'enum ResetPeriod',
          },
          { name: 'allocator', type: 'address', internalType: 'address' },
          {
            name: 'permissionId',
            type: 'bytes32',
            internalType: 'PermissionId',
          },
        ],
      },
      {
        name: 'enableData',
        type: 'tuple',
        internalType: 'struct SmartSessionEmissaryEnable',
        components: [
          { name: 'allocatorSig', type: 'bytes', internalType: 'bytes' },
          { name: 'userSig', type: 'bytes', internalType: 'bytes' },
          { name: 'expires', type: 'uint256', internalType: 'uint256' },
          {
            name: 'session',
            type: 'tuple',
            internalType: 'struct EnableSession',
            components: [
              {
                name: 'chainDigestIndex',
                type: 'uint8',
                internalType: 'uint8',
              },
              {
                name: 'hashesAndChainIds',
                type: 'tuple[]',
                internalType: 'struct ChainDigest[]',
                components: [
                  { name: 'chainId', type: 'uint64', internalType: 'uint64' },
                  {
                    name: 'sessionDigest',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
              {
                name: 'sessionToEnable',
                type: 'tuple',
                internalType: 'struct Session',
                components: [
                  {
                    name: 'sessionValidator',
                    type: 'address',
                    internalType: 'contract ISessionValidator',
                  },
                  {
                    name: 'sessionValidatorInitData',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  { name: 'salt', type: 'bytes32', internalType: 'bytes32' },
                  {
                    name: 'actions',
                    type: 'tuple[]',
                    internalType: 'struct ActionData[]',
                    components: [
                      {
                        name: 'actionTargetSelector',
                        type: 'bytes4',
                        internalType: 'bytes4',
                      },
                      {
                        name: 'actionTarget',
                        type: 'address',
                        internalType: 'address',
                      },
                      {
                        name: 'actionPolicies',
                        type: 'tuple[]',
                        internalType: 'struct PolicyData[]',
                        components: [
                          {
                            name: 'policy',
                            type: 'address',
                            internalType: 'address',
                          },
                          {
                            name: 'initData',
                            type: 'bytes',
                            internalType: 'bytes',
                          },
                        ],
                      },
                    ],
                  },
                  {
                    name: 'claimPolicies',
                    type: 'tuple[]',
                    internalType: 'struct PolicyData[]',
                    components: [
                      {
                        name: 'policy',
                        type: 'address',
                        internalType: 'address',
                      },
                      {
                        name: 'initData',
                        type: 'bytes',
                        internalType: 'bytes',
                      },
                    ],
                  },
                  {
                    name: 'erc7739Policies',
                    type: 'tuple',
                    internalType: 'struct ERC7739Data',
                    components: [
                      {
                        name: 'allowedERC7739Content',
                        type: 'tuple[]',
                        internalType: 'struct ERC7739Context[]',
                        components: [
                          {
                            name: 'appDomainSeparator',
                            type: 'bytes32',
                            internalType: 'bytes32',
                          },
                          {
                            name: 'contentNames',
                            type: 'string[]',
                            internalType: 'string[]',
                          },
                        ],
                      },
                      {
                        name: 'erc1271Policies',
                        type: 'tuple[]',
                        internalType: 'struct PolicyData[]',
                        components: [
                          {
                            name: 'policy',
                            type: 'address',
                            internalType: 'address',
                          },
                          {
                            name: 'initData',
                            type: 'bytes',
                            internalType: 'bytes',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'verifyClaim',
    inputs: [
      { name: 'sponsor', type: 'address', internalType: 'address' },
      { name: 'digest', type: 'bytes32', internalType: 'bytes32' },
      { name: '', type: 'bytes32', internalType: 'bytes32' },
      { name: 'emissaryData', type: 'bytes', internalType: 'bytes' },
      { name: 'lockTag', type: 'bytes12', internalType: 'bytes12' },
    ],
    outputs: [{ name: '', type: 'bytes4', internalType: 'bytes4' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'verifyExecution',
    inputs: [
      { name: 'sponsor', type: 'address', internalType: 'address' },
      { name: 'digest', type: 'bytes32', internalType: 'bytes32' },
      { name: 'emissaryData', type: 'bytes', internalType: 'bytes' },
      {
        name: 'executions',
        type: 'tuple',
        internalType: 'struct Types.Operation',
        components: [{ name: 'data', type: 'bytes', internalType: 'bytes' }],
      },
    ],
    outputs: [{ name: '', type: 'bytes4', internalType: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'EmissaryConfigUpdated',
    inputs: [
      {
        name: 'account',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'validator',
        type: 'address',
        indexed: true,
        internalType: 'contract IStatelessValidator',
      },
      {
        name: 'lockTag',
        type: 'bytes12',
        indexed: true,
        internalType: 'bytes12',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PolicyEnabled',
    inputs: [
      {
        name: 'permissionId',
        type: 'bytes32',
        indexed: false,
        internalType: 'PermissionId',
      },
      {
        name: 'policyType',
        type: 'uint8',
        indexed: false,
        internalType: 'enum PolicyType',
      },
      {
        name: 'policy',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'smartAccount',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SessionValidatorDisabled',
    inputs: [
      {
        name: 'permissionId',
        type: 'bytes32',
        indexed: false,
        internalType: 'PermissionId',
      },
      {
        name: 'sessionValidator',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'smartAccount',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SessionValidatorEnabled',
    inputs: [
      {
        name: 'permissionId',
        type: 'bytes32',
        indexed: false,
        internalType: 'PermissionId',
      },
      {
        name: 'sessionValidator',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'smartAccount',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'SmartSessionEmissaryConfigUpdated',
    inputs: [
      {
        name: 'account',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'permissionId',
        type: 'bytes32',
        indexed: false,
        internalType: 'PermissionId',
      },
      {
        name: 'lockTag',
        type: 'bytes12',
        indexed: true,
        internalType: 'bytes12',
      },
      { name: 'enabled', type: 'bool', indexed: false, internalType: 'bool' },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'ChainIdMismatch',
    inputs: [
      { name: 'providedChainId', type: 'uint64', internalType: 'uint64' },
    ],
  },
  { type: 'error', name: 'ForbiddenValidationData', inputs: [] },
  {
    type: 'error',
    name: 'HashMismatch',
    inputs: [
      { name: 'providedHash', type: 'bytes32', internalType: 'bytes32' },
      { name: 'computedHash', type: 'bytes32', internalType: 'bytes32' },
    ],
  },
  { type: 'error', name: 'IncorrectType', inputs: [] },
  { type: 'error', name: 'InvalidActionId', inputs: [] },
  { type: 'error', name: 'InvalidAllocatorSignature', inputs: [] },
  { type: 'error', name: 'InvalidAllocatorSignature', inputs: [] },
  { type: 'error', name: 'InvalidDataLength', inputs: [] },
  { type: 'error', name: 'InvalidEmissaryDisableData', inputs: [] },
  { type: 'error', name: 'InvalidEmissaryEnableData', inputs: [] },
  {
    type: 'error',
    name: 'InvalidISessionValidator',
    inputs: [
      {
        name: 'sessionValidator',
        type: 'address',
        internalType: 'contract ISessionValidator',
      },
    ],
  },
  { type: 'error', name: 'InvalidNonce', inputs: [] },
  {
    type: 'error',
    name: 'InvalidPermissionId',
    inputs: [
      { name: 'permissionId', type: 'bytes32', internalType: 'PermissionId' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidPermissionId',
    inputs: [
      { name: 'permissionId', type: 'bytes32', internalType: 'PermissionId' },
    ],
  },
  { type: 'error', name: 'InvalidSelfCall', inputs: [] },
  {
    type: 'error',
    name: 'InvalidSession',
    inputs: [
      { name: 'permissionId', type: 'bytes32', internalType: 'PermissionId' },
    ],
  },
  { type: 'error', name: 'InvalidSignature', inputs: [] },
  { type: 'error', name: 'InvalidTarget', inputs: [] },
  { type: 'error', name: 'InvalidUserSignature', inputs: [] },
  { type: 'error', name: 'InvalidUserSignature', inputs: [] },
  { type: 'error', name: 'NoExecutionsInBatch', inputs: [] },
  {
    type: 'error',
    name: 'NoPoliciesSet',
    inputs: [
      { name: 'permissionId', type: 'bytes32', internalType: 'PermissionId' },
    ],
  },
  { type: 'error', name: 'NotSet', inputs: [] },
  {
    type: 'error',
    name: 'PolicyViolation',
    inputs: [
      { name: 'permissionId', type: 'bytes32', internalType: 'PermissionId' },
      { name: 'policy', type: 'address', internalType: 'address' },
    ],
  },
  { type: 'error', name: 'Reentrancy', inputs: [] },
  {
    type: 'error',
    name: 'SignerNotFound',
    inputs: [
      { name: 'permissionId', type: 'bytes32', internalType: 'PermissionId' },
      { name: 'account', type: 'address', internalType: 'address' },
    ],
  },
  { type: 'error', name: 'UnauthorizedSource', inputs: [] },
  { type: 'error', name: 'UnsafeFallbackNotAllowed', inputs: [] },
  {
    type: 'error',
    name: 'UnsupportedPolicy',
    inputs: [{ name: 'policy', type: 'address', internalType: 'address' }],
  },
] as const

export default abi
