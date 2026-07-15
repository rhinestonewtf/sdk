import {
  type AccountProviderConfig,
  type CallInput,
  type RhinestoneAccountConfig,
  RhinestoneSDK,
  type Transaction,
} from '@rhinestone/sdk'
import * as actions from '@rhinestone/sdk/actions'
import * as ecdsaActions from '@rhinestone/sdk/actions/ecdsa'
import * as mfaActions from '@rhinestone/sdk/actions/mfa'
import * as passkeyActions from '@rhinestone/sdk/actions/passkeys'
import * as sessionActions from '@rhinestone/sdk/actions/smart-sessions'
import * as errors from '@rhinestone/sdk/errors'
import * as jwtServer from '@rhinestone/sdk/jwt-server'
import * as passkeySigning from '@rhinestone/sdk/signing/passkeys'
import * as smartSessions from '@rhinestone/sdk/smart-sessions'
import * as utils from '@rhinestone/sdk/utils'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'

const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)

const legacySdk = new RhinestoneSDK({ apiKey: 'legacy-api-key' })
const apiKeySdk = new RhinestoneSDK({
  auth: { mode: 'apiKey', apiKey: 'api-key' },
})
const jwtSdk = new RhinestoneSDK({
  auth: { mode: 'experimental_jwt', accessToken: async () => 'token' },
})

const accountProviders: AccountProviderConfig[] = [
  { type: 'safe', version: '1.4.1', adapter: '2.0.0' },
  { type: 'nexus', version: '1.2.0' },
  { type: 'kernel', version: '3.3' },
  { type: 'startale' },
  { type: 'hca' },
  { type: 'eoa' },
]

const accountConfig: RhinestoneAccountConfig = {
  account: accountProviders[0],
  owners: { type: 'ecdsa', accounts: [owner] },
}

const lazyCall: CallInput = {
  async resolve({ accountAddress, chain, config }) {
    void accountAddress
    void chain
    void config
    return []
  },
}

const transaction: Transaction = {
  sourceChains: [mainnet],
  targetChain: mainnet,
  calls: [lazyCall],
}

void legacySdk.createAccount(accountConfig)
void apiKeySdk.createAccount(accountConfig)
void jwtSdk.createAccount(accountConfig)
void transaction
void actions
void ecdsaActions
void mfaActions
void passkeyActions
void sessionActions
void errors
void jwtServer
void passkeySigning
void smartSessions
void utils

// @ts-expect-error api-key auth requires an api key
new RhinestoneSDK({ auth: { mode: 'apiKey' } })

const invalidProvider: AccountProviderConfig = {
  type: 'safe',
  // @ts-expect-error unsupported account provider version
  version: '9.9.9',
}
void invalidProvider
