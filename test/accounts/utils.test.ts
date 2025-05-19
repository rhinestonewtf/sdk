// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
    Address,
    Client,
    concatHex,
    encodeAbiParameters,
    encodeFunctionData,
    encodePacked,
    Hex,
    http,
    toBytes,
    toHex,
} from 'viem'
import { createBundlerClient } from 'viem/account-abstraction'
import { readContract } from 'viem/actions'
import { getAction } from 'viem/utils'

import { encode7579Calls, getAccountNonce, getBundlerClient } from '../../src/accounts/utils'
import { BundlerConfig, RhinestoneAccountConfig } from '../../src/types'

vi.mock('viem', async () => {
    const actual = await vi.importActual('viem')
    return {
        ...actual,
        concatHex: vi.fn(),
        encodeAbiParameters: vi.fn(),
        encodeFunctionData: vi.fn(),
        encodePacked: vi.fn(),
        http: vi.fn(),
        toBytes: vi.fn(),
        toHex: vi.fn(),
    }
})

vi.mock('viem/account-abstraction', () => ({
    createBundlerClient: vi.fn(),
}))

vi.mock('viem/actions', () => ({
    readContract: vi.fn(),
}))

vi.mock('viem/utils', () => ({
    getAction: vi.fn(),
}))

describe('Account Utils Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    describe('encode7579Calls', () => {
        it('should encode a single call correctly', () => {
            vi.mocked(encodePacked).mockReturnValue('0xexecMode')
            vi.mocked(concatHex).mockReturnValue('0xconcatenatedHex')
            vi.mocked(encodeFunctionData).mockReturnValue('0xencodedFunctionData')
            vi.mocked(toBytes).mockReturnValue(new Uint8Array([0]))
            vi.mocked(toHex).mockReturnValue('0x00')

            const mode = {
                type: 'call',
                revertOnError: false,
                selector: '0x12345678',
                context: '0xabcdef',
            }
            const callData = [
                {
                    to: '0x1234567890123456789012345678901234567890',
                    value: 100n,
                    data: '0xcalldata',
                },
            ]

            const result = encode7579Calls({ mode, callData })

            expect(encodePacked).toHaveBeenCalled()
            expect(concatHex).toHaveBeenCalledWith([
                '0x1234567890123456789012345678901234567890',
                expect.any(String),
                '0xcalldata',
            ])
            expect(encodeFunctionData).toHaveBeenCalledWith({
                abi: expect.any(Array),
                functionName: 'execute',
                args: ['0xexecMode', '0xconcatenatedHex'],
            })
            expect(result).toBe('0xencodedFunctionData')
        })

        it('should encode multiple calls as a batch', () => {
            vi.mocked(encodePacked).mockReturnValue('0xexecMode')
            vi.mocked(encodeAbiParameters).mockReturnValue('0xencodedParams')
            vi.mocked(encodeFunctionData).mockReturnValue('0xencodedFunctionData')
            vi.mocked(toBytes).mockReturnValue(new Uint8Array([0]))
            vi.mocked(toHex).mockReturnValue('0x00')

            const mode = {
                type: 'batchcall',
                revertOnError: true,
            }
            const callData = [
                {
                    to: '0x1111111111111111111111111111111111111111',
                    value: 100n,
                    data: '0xcalldata1',
                },
                {
                    to: '0x2222222222222222222222222222222222222222',
                    data: '0xcalldata2',
                },
            ]

            const result = encode7579Calls({ mode, callData })

            expect(encodePacked).toHaveBeenCalled()
            expect(encodeAbiParameters).toHaveBeenCalledWith(
                expect.any(Array),
                [
                    expect.arrayContaining([
                        expect.objectContaining({
                            target: '0x1111111111111111111111111111111111111111',
                            value: 100n,
                            callData: '0xcalldata1',
                        }),
                        expect.objectContaining({
                            target: '0x2222222222222222222222222222222222222222',
                            value: 0n,
                            callData: '0xcalldata2',
                        }),
                    ]),
                ]
            )
            expect(encodeFunctionData).toHaveBeenCalledWith({
                abi: expect.any(Array),
                functionName: 'execute',
                args: ['0xexecMode', '0xencodedParams'],
            })
            expect(result).toBe('0xencodedFunctionData')
        })

        it('should throw an error if mode type is not batchcall for multiple calls', () => {
            const mode = {
                type: 'call',
                revertOnError: false,
            }
            const callData = [
                { to: '0x1111111111111111111111111111111111111111' },
                { to: '0x2222222222222222222222222222222222222222' },
            ]

            expect(() => encode7579Calls({ mode, callData })).toThrow(
                'mode {"type":"call","revertOnError":false} does not supported for batchcall calldata'
            )
        })

        it('should throw an error if no calls are provided', () => {
            const mode = {
                type: 'call',
                revertOnError: false,
            }
            const callData = []

            expect(() => encode7579Calls({ mode, callData })).toThrow('No calls to encode')
        })

        it('should handle undefined values and data', () => {
            vi.mocked(encodePacked).mockReturnValue('0xexecMode')
            vi.mocked(concatHex).mockReturnValue('0xconcatenatedHex')
            vi.mocked(encodeFunctionData).mockReturnValue('0xencodedFunctionData')
            vi.mocked(toBytes).mockReturnValue(new Uint8Array([0]))
            vi.mocked(toHex).mockReturnValue('0x00')

            const mode = {
                type: 'call',
            }
            const callData = [
                {
                    to: '0x1234567890123456789012345678901234567890',
                },
            ]

            const result = encode7579Calls({ mode, callData })

            expect(concatHex).toHaveBeenCalledWith([
                '0x1234567890123456789012345678901234567890',
                expect.any(String),
                '0x',
            ])
            expect(result).toBe('0xencodedFunctionData')
        })
    })

    describe('getAccountNonce', () => {
        it('should call readContract with the correct parameters', async () => {
            const mockReadContract = vi.fn().mockResolvedValue(42n)
            vi.mocked(getAction).mockReturnValue(mockReadContract)

            const mockClient = {} as Client
            const args = {
                address: '0x1234567890123456789012345678901234567890' as Address,
                entryPointAddress: '0xentryPointAddress' as Address,
                key: 123n,
            }

            const result = await getAccountNonce(mockClient, args)

            expect(getAction).toHaveBeenCalledWith(
                mockClient,
                readContract,
                'readContract'
            )
            expect(mockReadContract).toHaveBeenCalledWith({
                address: '0xentryPointAddress',
                abi: expect.any(Array),
                functionName: 'getNonce',
                args: ['0x1234567890123456789012345678901234567890', 123n],
            })
            expect(result).toBe(42n)
        })

        it('should use default key value if not provided', async () => {
            const mockReadContract = vi.fn().mockResolvedValue(42n)
            vi.mocked(getAction).mockReturnValue(mockReadContract)

            const mockClient = {} as Client
            const args = {
                address: '0x1234567890123456789012345678901234567890' as Address,
                entryPointAddress: '0xentryPointAddress' as Address,
            }

            await getAccountNonce(mockClient, args)

            expect(mockReadContract).toHaveBeenCalledWith({
                address: '0xentryPointAddress',
                abi: expect.any(Array),
                functionName: 'getNonce',
                args: ['0x1234567890123456789012345678901234567890', 0n],
            })
        })
    })

    describe('getBundlerClient', () => {
        it('should create a bundler client with the correct parameters for Pimlico', () => {
            vi.mocked(http).mockReturnValue('httpTransport' as any)
            vi.mocked(createBundlerClient).mockReturnValue('bundlerClient' as any)

            const mockConfig = {
                bundler: {
                    type: 'pimlico',
                    apiKey: 'test-api-key',
                },
            } as RhinestoneAccountConfig
            const mockClient = {
                chain: {
                    id: 1,
                },
            } as Client

            const result = getBundlerClient(mockConfig, mockClient)

            expect(http).toHaveBeenCalledWith('https://api.pimlico.io/v2/1/rpc?apikey=test-api-key')
            expect(createBundlerClient).toHaveBeenCalledWith({
                client: mockClient,
                transport: 'httpTransport',
                paymaster: true,
            })
            expect(result).toBe('bundlerClient')
        })

        it('should use default Pimlico endpoint if bundler is not provided', () => {
            vi.mocked(http).mockReturnValue('httpTransport' as any)
            vi.mocked(createBundlerClient).mockReturnValue('bundlerClient' as any)

            const mockConfig = {} as RhinestoneAccountConfig
            const mockClient = {
                chain: {
                    id: 1,
                },
            } as Client

            const result = getBundlerClient(mockConfig, mockClient)

            expect(http).toHaveBeenCalledWith('https://public.pimlico.io/v2/1/rpc')
            expect(createBundlerClient).toHaveBeenCalledWith({
                client: mockClient,
                transport: 'httpTransport',
                paymaster: true,
            })
            expect(result).toBe('bundlerClient')
        })

        it('should throw an error if chain id is not available', () => {
            const mockConfig = {
                bundler: {
                    type: 'pimlico',
                    apiKey: 'test-api-key',
                },
            } as RhinestoneAccountConfig
            const mockClient = {} as Client

            expect(() => getBundlerClient(mockConfig, mockClient)).toThrow('Chain id is required')
        })
    })
})