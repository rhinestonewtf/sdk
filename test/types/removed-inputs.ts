import { base } from 'viem/chains'
import type {
  RhinestoneSDKConfig,
  // @ts-expect-error Removed config alias.
  SolanaPasskeyPermission,
} from '../../src/config/account'
import type { SdkConstructionInput } from '../../src/config/input'
import {
  RhinestoneSDK,
  type Session,
  type SessionDefinition,
} from '../../src/index'
import type { SessionDefinition as DomainDefinition } from '../../src/modules/validators/smart-sessions/types'
import { toSession, validateSession } from '../../src/smart-sessions/index'
import type {
  // @ts-expect-error Removed Solana subpath alias.
  SolanaPasskeyPermission as RemovedSolanaPermission,
  SolanaAuthorityPermission,
} from '../../src/solana/index'
import { accountA } from '../consts'

const owners = { type: 'ecdsa' as const, accounts: [accountA] }
const definition = { chain: base, owners }
const sdk = new RhinestoneSDK({ auth: { mode: 'apiKey', apiKey: 'types' } })
// @ts-expect-error Top-level auth shorthand is removed.
new RhinestoneSDK({ apiKey: 'types' })
new RhinestoneSDK({
  auth: { mode: 'apiKey', apiKey: 'types' },
  // @ts-expect-error A valid auth object does not permit a top-level undefined key.
  apiKey: undefined,
})
// @ts-expect-error Public config cannot use the shorthand.
const config: RhinestoneSDKConfig = { apiKey: '' }
// @ts-expect-error Construction input cannot use the shorthand.
const input: SdkConstructionInput = { apiKey: 'types' }
// @ts-expect-error Generic public definitions reject raw claim metadata.
const generic: SessionDefinition = { ...definition, claimPolicies: [] }
// @ts-expect-error Domain definitions reject undefined raw claims too.
const domain: DomainDefinition = { ...definition, claimPolicies: undefined }
// @ts-expect-error Standalone resolution cannot accept raw claims.
toSession({ ...definition, claimPolicies: [] })
// @ts-expect-error Standalone validation cannot accept raw claims.
validateSession({ ...definition, claimPolicies: undefined })
// @ts-expect-error Online creation cannot accept raw claims.
sdk.createSession({ ...definition, claimPolicies: [] })
// @ts-expect-error Online validation cannot accept raw claims.
sdk.validateSession({ ...definition, claimPolicies: undefined })
const replacement = toSession({
  ...definition,
  crossChainPermits: [{ settlementLayers: ['ACROSS'] }],
})
const persistedClaims: Session['claimPolicies'] = replacement.claimPolicies
const authority: SolanaAuthorityPermission = 'allButManageAuthority'
void [config, input, generic, domain, persistedClaims, authority]
void (null as unknown as SolanaPasskeyPermission)
void (null as unknown as RemovedSolanaPermission)
