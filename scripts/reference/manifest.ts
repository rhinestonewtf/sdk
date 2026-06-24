// Curated mapping from public SDK symbols to reference pages.
//
// This is the single source of truth for BOTH the symbol -> page mapping and the
// docs.json navigation tree. Leaves are symbols, keyed by (source, container,
// symbol) so that names that collide across subpaths (e.g. `enable` in ecdsa,
// passkeys, and mfa) resolve unambiguously.
//
// Scope is intentionally the hot path: the RhinestoneSDK entry point, the
// account instance, actions, and utils. Types, errors, jwt-server, the
// standalone createRhinestoneAccount function, and the /smart-sessions module
// are out of scope for now.

export type SymbolEntry = {
  kind: 'symbol'
  symbol: string
  // Subpath export the symbol is reached through: '.', './actions/ecdsa', './utils', etc.
  source: string
  // Owning interface/class for instance methods.
  container?: 'RhinestoneAccount' | 'RhinestoneSDK'
  // How the symbol is reached, for the Import/Usage section.
  callStyle:
    | 'function'
    | 'action'
    | 'constructor'
    | 'accountMethod'
    | 'sdkMethod'
  experimental?: boolean
  // Nav label / page title override (defaults to `symbol`).
  title?: string
}

export type Group = {
  kind: 'group'
  group: string
  experimental?: boolean
  items: Node[]
}

export type Node = Group | SymbolEntry

const accountMethod = (symbol: string, experimental = false): SymbolEntry => ({
  kind: 'symbol',
  symbol,
  source: '.',
  container: 'RhinestoneAccount',
  callStyle: 'accountMethod',
  experimental,
})

const action = (
  symbol: string,
  source: string,
  experimental = false,
): SymbolEntry => ({
  kind: 'symbol',
  symbol,
  source,
  callStyle: 'action',
  experimental,
})

const util = (symbol: string, experimental = false): SymbolEntry => ({
  kind: 'symbol',
  symbol,
  source: './utils',
  callStyle: 'function',
  experimental,
})

export const manifest: Group[] = [
  {
    kind: 'group',
    group: 'RhinestoneSDK',
    items: [
      {
        kind: 'symbol',
        symbol: 'RhinestoneSDK',
        source: '.',
        callStyle: 'constructor',
        title: 'RhinestoneSDK',
      },
      {
        kind: 'symbol',
        symbol: 'createAccount',
        source: '.',
        container: 'RhinestoneSDK',
        callStyle: 'sdkMethod',
      },
      {
        kind: 'symbol',
        symbol: 'getIntentStatus',
        source: '.',
        container: 'RhinestoneSDK',
        callStyle: 'sdkMethod',
      },
      {
        kind: 'symbol',
        symbol: 'splitIntents',
        source: '.',
        container: 'RhinestoneSDK',
        callStyle: 'sdkMethod',
      },
    ],
  },
  {
    kind: 'group',
    group: 'Account',
    items: [
      {
        kind: 'group',
        group: 'Deployment',
        items: [
          accountMethod('deploy'),
          accountMethod('isDeployed'),
          accountMethod('setup'),
          accountMethod('getInitData'),
          accountMethod('signEip7702InitData'),
        ],
      },
      {
        kind: 'group',
        group: 'Transactions',
        items: [
          accountMethod('prepareTransaction'),
          accountMethod('getTransactionMessages'),
          accountMethod('signTransaction'),
          accountMethod('signAuthorizations'),
          accountMethod('signIntent'),
          accountMethod('submitTransaction'),
        ],
      },
      {
        kind: 'group',
        group: 'User operations',
        items: [
          accountMethod('prepareUserOperation'),
          accountMethod('signUserOperation'),
          accountMethod('submitUserOperation'),
          accountMethod('sendUserOperation'),
        ],
      },
      {
        kind: 'group',
        group: 'Signing',
        items: [accountMethod('signMessage'), accountMethod('signTypedData')],
      },
      {
        kind: 'group',
        group: 'Execution',
        items: [accountMethod('waitForExecution')],
      },
      {
        kind: 'group',
        group: 'Reads',
        items: [
          accountMethod('getAddress'),
          accountMethod('getPortfolio'),
          accountMethod('getOwners'),
          accountMethod('getValidators'),
          accountMethod('getExecutors'),
        ],
      },
      {
        kind: 'group',
        group: 'Smart sessions',
        experimental: true,
        items: [
          accountMethod('experimental_getSessionDetails', true),
          accountMethod('experimental_isSessionEnabled', true),
          accountMethod('experimental_signEnableSession', true),
        ],
      },
    ],
  },
  {
    kind: 'group',
    group: 'Actions',
    items: [
      {
        kind: 'group',
        group: 'ECDSA',
        items: [
          action('enable', './actions/ecdsa'),
          action('disable', './actions/ecdsa'),
          action('addOwner', './actions/ecdsa'),
          action('removeOwner', './actions/ecdsa'),
          action('changeThreshold', './actions/ecdsa'),
        ],
      },
      {
        kind: 'group',
        group: 'Passkeys',
        items: [
          action('enable', './actions/passkeys'),
          action('disable', './actions/passkeys'),
          action('addOwner', './actions/passkeys'),
          action('removeOwner', './actions/passkeys'),
          action('changeThreshold', './actions/passkeys'),
        ],
      },
      {
        kind: 'group',
        group: 'MFA',
        items: [
          action('enable', './actions/mfa'),
          action('disable', './actions/mfa'),
          action('changeThreshold', './actions/mfa'),
          action('setSubValidator', './actions/mfa'),
          action('removeSubValidator', './actions/mfa'),
        ],
      },
      {
        kind: 'group',
        group: 'Recovery',
        items: [
          action('enable', './actions/recovery'),
          action('recoverEcdsaOwnership', './actions/recovery'),
          action('recoverPasskeyOwnership', './actions/recovery'),
        ],
      },
      {
        kind: 'group',
        group: 'Modules',
        items: [
          action('installModule', './actions'),
          action('uninstallModule', './actions'),
          action('deploy', './actions'),
        ],
      },
      {
        kind: 'group',
        group: 'Smart sessions',
        experimental: true,
        items: [
          action('experimental_enable', './actions/smart-sessions', true),
          action('experimental_disable', './actions/smart-sessions', true),
          action(
            'experimental_enableSession',
            './actions/smart-sessions',
            true,
          ),
          // Returns a CrossChainPermit (not a call), so it is a plain function,
          // not an `action` wrapped in prepareTransaction `calls`.
          {
            kind: 'symbol',
            symbol: 'createCrossChainPermission',
            source: './actions/smart-sessions',
            callStyle: 'function',
            experimental: true,
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    group: 'Utils',
    items: [
      util('experimental_getV0InitData', true),
      util('experimental_getRhinestoneInitData', true),
      util('toViewOnlyAccount'),
    ],
  },
]
