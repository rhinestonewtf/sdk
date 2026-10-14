import { base } from 'viem/chains'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import persistedClaims from '../../test/utils/persisted-claim-sessions.json'
import { captureLegacySdkConfig } from '../config/legacy'
import { resolveSdkConfig } from '../config/resolve'
import { RhinestoneSDK } from '../index'
import { getSessionData } from '../modules/validators/smart-sessions/digest'
import { resolveSessionData } from '../modules/validators/smart-sessions/resolve'
import type { Session } from '../modules/validators/smart-sessions/types'
import { toSession, validateSession } from '../smart-sessions/index'
import {
  createSession,
  validateSession as validateOnline,
} from './queries/session'

const auth = { mode: 'apiKey' as const, apiKey: 'offline' }
const owners = { type: 'ecdsa' as const, accounts: [accountA] }
const definition = { chain: base, owners }
afterEach(() => vi.restoreAllMocks())

describe('removed inputs fail before effects', () => {
  test.each(['old', '', undefined])(
    'rejects top-level apiKey=%s including beside JWT auth',
    (apiKey) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const getToken = vi.fn(async () => 'token')
      for (const nested of [
        auth,
        { mode: 'experimental_jwt' as const, accessToken: getToken },
      ]) {
        const widened = { apiKey, auth: nested }
        expect(() => new RhinestoneSDK(widened)).toThrow(
          /Top-level `apiKey` was removed/,
        )
        expect(() => resolveSdkConfig(widened)).toThrow(
          /Top-level `apiKey` was removed/,
        )
        expect(() => captureLegacySdkConfig(widened, {})).toThrow(
          /Top-level `apiKey` was removed/,
        )
      }
      expect(fetch).not.toHaveBeenCalled()
      expect(getToken).not.toHaveBeenCalled()
    },
  )

  test.each([undefined, [], [{ type: 'permit2' }]])(
    'rejects present claimPolicies=%j on every definition entrypoint',
    async (claimPolicies) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const sign = vi.spyOn(accountA, 'signTypedData')
      const widened = { ...definition, claimPolicies }
      const sdk = new RhinestoneSDK({ auth })
      await expect(sdk.createSession(widened)).rejects.toThrow(
        /claimPolicies.*was removed/,
      )
      expect((await sdk.validateSession(widened)).refusals[0].code).toBe(
        'REMOVED_CLAIM_POLICIES_INPUT',
      )
      expect(() => toSession(widened)).toThrow(/claimPolicies.*was removed/)
      expect(() => resolveSessionData(widened)).toThrow(
        /claimPolicies.*was removed/,
      )
      expect(validateSession(widened).refusals[0].code).toBe(
        'REMOVED_CLAIM_POLICIES_INPUT',
      )
      const getChainCatalog = vi.fn()
      const forChain = vi.fn()
      const onlineInput = {
        definition: widened,
        orchestrator: { getChainCatalog },
        rpc: { forChain },
        environment: 'production' as const,
      }
      await expect(createSession(onlineInput as never)).rejects.toThrow(
        /claimPolicies.*was removed/,
      )
      expect(
        (await validateOnline(onlineInput as never)).refusals[0].code,
      ).toBe('REMOVED_CLAIM_POLICIES_INPUT')
      expect(getChainCatalog).not.toHaveBeenCalled()
      expect(forChain).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
      expect(sign).not.toHaveBeenCalled()
    },
  )

  test('inherited removed keys reject too', async () => {
    const widened = Object.assign(
      Object.create({ claimPolicies: undefined }),
      definition,
    )
    await expect(
      new RhinestoneSDK({ auth }).createSession(widened),
    ).rejects.toThrow(/was removed/)
    expect(() => toSession(widened)).toThrow(/was removed/)
    expect(
      () =>
        new RhinestoneSDK(
          Object.assign(Object.create({ apiKey: undefined }), { auth }),
        ),
    ).toThrow(/was removed/)
  })

  test('new standard permits keep compiled metadata and persisted artifacts keep encoding', () => {
    const fresh = toSession({
      ...definition,
      crossChainPermits: [
        {
          settlementLayers: ['ACROSS'],
          from: {
            chain: base,
            token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          },
        },
      ],
    })
    expect(fresh.claimPolicies).toHaveLength(1)
    expect(getSessionData(fresh).claimPolicies).toEqual([])
    const restored = {
      ...persistedClaims.claimPolicies,
      ...definition,
    } as unknown as Session
    expect(restored.claimPolicies).toHaveLength(1)
    expect(
      getSessionData(restored).erc7739Policies.erc1271Policies[0].initData,
    ).toBe(restored.erc7739Policies.erc1271Policies[0].initData)
    expect(() => toSession(restored as never)).toThrow(
      /pass that Session directly/,
    )
  })
})
