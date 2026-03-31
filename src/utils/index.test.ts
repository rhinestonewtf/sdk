import { describe, expect, test } from 'vitest'

import { accountA } from '../../test/consts'
import {
  experimental_getRhinestoneInitData,
  experimental_getV0InitData,
} from './index'

describe('Utils', () => {
  test('experimental_getV0InitData accepts session-enabled safe config', () => {
    const baseConfig = {
      account: {
        type: 'safe' as const,
      },
      owners: {
        type: 'ecdsa' as const,
        accounts: [accountA],
      },
    }

    const withoutSessions = experimental_getV0InitData(baseConfig)
    const withSessions = experimental_getV0InitData({
      ...baseConfig,
      experimental_sessions: {
        enabled: true,
      },
    })

    expect(withSessions.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(withSessions.factoryData).not.toEqual(withoutSessions.factoryData)
  })

  test('experimental_getRhinestoneInitData accepts session-enabled safe config', () => {
    const initData = experimental_getRhinestoneInitData({
      account: {
        type: 'safe',
      },
      owners: {
        type: 'ecdsa',
        accounts: [accountA],
      },
      experimental_sessions: {
        enabled: true,
      },
    })

    expect('factory' in initData).toBe(true)
  })
})
