import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Keypair } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import {
  assertSolanaIntegrationNetworks,
  createSolanaReport,
  getSolanaIntegrationConfig,
  parseSolanaFunderPrivateKey,
  SOLANA_DEVNET_GENESIS,
  SOLANA_DEVNET_RPC_URL,
  SOLANA_ENDPOINTS,
} from './solana'

const keypair = Keypair.fromSeed(new Uint8Array(32).fill(17))
const secret = JSON.stringify(Array.from(keypair.secretKey))
const validEnv = {
  INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY: secret,
  INTEGRATION_FUNDER_PRIVATE_KEY: `0x${'01'.repeat(32)}`,
  INTEGRATION_RHINESTONE_API_KEY: 'unit-test-api-key',
}

describe('Solana funder JSON64', () => {
  it('accepts a consistent keypair', () => {
    expect(
      parseSolanaFunderPrivateKey(secret).publicKey.equals(keypair.publicKey),
    ).toBe(true)
  })

  it.each([
    undefined,
    '',
    'not-json-sensitive-input',
    '{}',
    'null',
    JSON.stringify(Array(32).fill(1)),
    JSON.stringify(Array(65).fill(1)),
    JSON.stringify(Array(64).fill(-1)),
    JSON.stringify(Array(64).fill(256)),
    JSON.stringify(Array(64).fill(0.5)),
    JSON.stringify(Array(64).fill('1')),
    JSON.stringify(Array(64).fill(null)),
    JSON.stringify(Array(64).fill(0)),
  ])(
    'refuses malformed input without echoing or preserving parser errors (#%#)',
    (input) => {
      let caught: unknown
      try {
        parseSolanaFunderPrivateKey(input)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      const error = caught as Error
      expect(error.message).toBe(
        'INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY must be a consistent JSON array of 64 integer bytes (0–255) from a Solana keypair',
      )
      expect(error.cause).toBeUndefined()
    },
  )

  it('checks public and private halves match', () => {
    const bytes = Array.from(keypair.secretKey)
    bytes[63] ^= 1
    expect(() => parseSolanaFunderPrivateKey(JSON.stringify(bytes))).toThrow(
      'consistent JSON array',
    )
  })
})

describe('shared Solana configuration', () => {
  it('defaults to prod endpoint and matching contracts, with testnet RPCs', () => {
    const config = getSolanaIntegrationConfig(validEnv)
    expect(config).toMatchObject({
      target: 'prod',
      endpointUrl: SOLANA_ENDPOINTS.prod,
      useDevContracts: false,
      solanaRpcUrl: SOLANA_DEVNET_RPC_URL,
      sdkConfig: { endpointUrl: SOLANA_ENDPOINTS.prod, useDevContracts: false },
    })
    expect(config.funder.publicKey.equals(keypair.publicKey)).toBe(true)
  })

  it('treats blank optional .env entries as unset', () => {
    const config = getSolanaIntegrationConfig({
      ...validEnv,
      INTEGRATION_ORCHESTRATOR_URL: '',
      INTEGRATION_USE_DEV_CONTRACTS: '',
      INTEGRATION_SOLANA_RPC_URL: '',
      INTEGRATION_RPC_URL_84532: '',
    })
    expect(config.target).toBe('prod')
    expect(config.solanaRpcUrl).toBe(SOLANA_DEVNET_RPC_URL)
    expect(config.baseSepoliaRpcUrl).toMatch(/^https:/)
  })

  it('selects dev via the shared endpoint without changing the Solana cluster', () => {
    const config = getSolanaIntegrationConfig({
      ...validEnv,
      INTEGRATION_ORCHESTRATOR_URL: `${SOLANA_ENDPOINTS.dev}/`,
    })
    expect(config.sdkConfig).toMatchObject({
      endpointUrl: SOLANA_ENDPOINTS.dev,
      useDevContracts: true,
    })
    expect(config.solanaRpcUrl).toBe(SOLANA_DEVNET_RPC_URL)
  })

  it('accepts explicit contract selection when it agrees with the environment', () => {
    expect(
      getSolanaIntegrationConfig({
        ...validEnv,
        INTEGRATION_USE_DEV_CONTRACTS: 'false',
      }).useDevContracts,
    ).toBe(false)
    expect(
      getSolanaIntegrationConfig({
        ...validEnv,
        INTEGRATION_ORCHESTRATOR_URL: SOLANA_ENDPOINTS.dev,
        INTEGRATION_USE_DEV_CONTRACTS: 'true',
      }).useDevContracts,
    ).toBe(true)
  })

  it.each([
    { INTEGRATION_USE_DEV_CONTRACTS: 'true' },
    {
      INTEGRATION_ORCHESTRATOR_URL: SOLANA_ENDPOINTS.prod,
      INTEGRATION_USE_DEV_CONTRACTS: 'false',
    },
    { INTEGRATION_ORCHESTRATOR_URL: SOLANA_ENDPOINTS.prod },
    {
      INTEGRATION_ORCHESTRATOR_URL:
        'https://untrusted.invalid/?secret=do-not-echo',
    },
    { INTEGRATION_USE_DEV_CONTRACTS: 'yes' },
    {
      INTEGRATION_ORCHESTRATOR_URL: SOLANA_ENDPOINTS.dev,
      INTEGRATION_USE_DEV_CONTRACTS: 'false',
    },
    { INTEGRATION_SOLANA_RPC_URL: 'file:///secret' },
    { INTEGRATION_RPC_URL_84532: 'invalid' },
    { INTEGRATION_FUNDER_PRIVATE_KEY: `0x${'00'.repeat(32)}` },
  ])('rejects incompatible or unsafe configuration (#%#)', (overrides) => {
    expect(() =>
      getSolanaIntegrationConfig({ ...validEnv, ...overrides }),
    ).toThrow('Solana integration prerequisites failed')
  })

  it('aggregates prerequisites without keys, URLs or raw errors', () => {
    expect(() => getSolanaIntegrationConfig({})).toThrow(
      /INTEGRATION_RHINESTONE_API_KEY[\s\S]*INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY[\s\S]*INTEGRATION_FUNDER_PRIVATE_KEY/,
    )
    try {
      getSolanaIntegrationConfig({
        INTEGRATION_SOLANA_FUNDER_PRIVATE_KEY: 'sensitive-key',
        INTEGRATION_FUNDER_PRIVATE_KEY: 'sensitive-evm-key',
        INTEGRATION_ORCHESTRATOR_URL:
          'https://host.invalid/?token=sensitive-token',
      })
    } catch (error) {
      expect(String(error)).not.toContain('sensitive-')
    }
  })
})

describe('read-only network preflight', () => {
  it('accepts only Devnet and Base Sepolia', async () => {
    await expect(
      assertSolanaIntegrationNetworks(
        { getGenesisHash: async () => SOLANA_DEVNET_GENESIS },
        { getChainId: async () => 84532 },
      ),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['mainnet-genesis', 84532],
    [SOLANA_DEVNET_GENESIS, 1],
    ['testnet-genesis', 8453],
  ])(
    'rejects wrong networks before any writer can be invoked (#%#)',
    async (genesis, chainId) => {
      const write = vi.fn()
      const run = async () => {
        await assertSolanaIntegrationNetworks(
          { getGenesisHash: async () => genesis },
          { getChainId: async () => chainId },
        )
        write()
      }
      await expect(run()).rejects.toThrow('network prerequisites failed')
      expect(write).not.toHaveBeenCalled()
    },
  )

  it('aggregates failed RPCs without exposing credential-bearing URLs', async () => {
    await expect(
      assertSolanaIntegrationNetworks(
        {
          getGenesisHash: async () => {
            throw new Error('https://rpc/?key=secret')
          },
        },
        {
          getChainId: async () => {
            throw new Error('sensitive transport')
          },
        },
      ),
    ).rejects.toThrow(
      'Solana network prerequisites failed:\n- Solana RPC must respond with the Devnet genesis hash\n- EVM RPC must respond with Base Sepolia chain ID 84532',
    )
  })
})

describe('sanitized report API', () => {
  it('persists only safe evidence', async () => {
    await mkdir('.scratch/integration', { recursive: true })
    const root = await mkdtemp('.scratch/integration/report-')
    try {
      const path = join(root, 'nested/report.json')
      const report = createSolanaReport(path)
      report.record({
        caseId: 'SC-D-sponsored',
        intentId: 'intent-123',
        balanceDelta: '10000',
        errorCode: 'https://rpc/?key=secret',
        ...{
          privateKey: secret,
          apiKey: 'sensitive',
          headers: { authorization: 'sensitive' },
        },
      })
      await report.write()
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        entries: [
          {
            caseId: 'SC-D-sponsored',
            intentId: 'intent-123',
            balanceDelta: '10000',
          },
        ],
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
