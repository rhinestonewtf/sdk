const enableSessionsAbi = [
  {
    type: 'function',
    name: 'enableSessions',
    inputs: [
      {
        name: 'sessions',
        type: 'tuple[]',
        internalType: 'struct Session[]',
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
            name: 'userOpPolicies',
            type: 'tuple[]',
            internalType: 'struct PolicyData[]',
            components: [
              {
                name: 'policy',
                type: 'address',
                internalType: 'address',
              },
              { name: 'initData', type: 'bytes', internalType: 'bytes' },
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
                    name: 'contentName',
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
            name: 'permitERC4337Paymaster',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
    ],
    outputs: [
      {
        name: 'permissionIds',
        type: 'bytes32[]',
        internalType: 'PermissionId[]',
      },
    ],
    stateMutability: 'nonpayable',
  },
] as const

export { enableSessionsAbi }
