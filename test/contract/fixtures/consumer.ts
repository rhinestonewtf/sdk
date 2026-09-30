import {
  type AccountProviderConfig,
  type CallInput,
  RhinestoneSDK,
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

// `Transaction` differs between base and current, so it is exercised in
// legacy-consumer.ts and current-consumer.ts rather than here.
const lazyCall: CallInput = {
  async resolve({ accountAddress, chain, config }) {
    void accountAddress
    void chain
    void config
    return []
  },
}
void lazyCall

void accountProviders
void legacySdk
void apiKeySdk
void jwtSdk
void actions
void ecdsaActions
void mfaActions
void passkeyActions
void sessionActions
void errors
void jwtServer
void passkeySigning
void smartSessions

// @ts-expect-error api-key auth requires an api key
new RhinestoneSDK({ auth: { mode: 'apiKey' } })

const invalidProvider: AccountProviderConfig = {
  type: 'safe',
  // @ts-expect-error unsupported account provider version
  version: '9.9.9',
}
void invalidProvider
