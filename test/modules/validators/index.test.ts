// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect } from 'vitest'
import {
    SMART_SESSION_MODE_USE,
    SMART_SESSION_MODE_ENABLE,
    SMART_SESSIONS_VALIDATOR_ADDRESS,
    getOwnerValidator,
    getSmartSessionValidator,
    getEnableSessionCall,
    encodeSmartSessionSignature,
    getPermissionId,
    getMockSignature,
    getAccountEIP712Domain,
    isSessionEnabled,
    getSessionAllowedERC7739Content,
} from './index'

// Import the mocked functions from the source files
import { getMockSignature as coreMockSignature, getOwnerValidator as coreOwnerValidator } from './core'
import {
    encodeSmartSessionSignature as smartSessionsEncodeSignature,
    getAccountEIP712Domain as smartSessionsGetDomain,
    getEnableSessionCall as smartSessionsEnableCall,
    getPermissionId as smartSessionsGetPermissionId,
    getSmartSessionValidator as smartSessionsGetValidator,
    isSessionEnabled as smartSessionsIsEnabled,
    getSessionAllowedERC7739Content as smartSessionsGetContent,
    SMART_SESSION_MODE_USE as SMART_SESSION_MODE_USE_ORIGINAL,
    SMART_SESSION_MODE_ENABLE as SMART_SESSION_MODE_ENABLE_ORIGINAL,
    SMART_SESSIONS_VALIDATOR_ADDRESS as SMART_SESSIONS_VALIDATOR_ADDRESS_ORIGINAL,
} from './smart-sessions'

// Mock the source modules
vi.mock('./core', () => ({
    getMockSignature: vi.fn(),
    getOwnerValidator: vi.fn(),
}))

vi.mock('./smart-sessions', () => ({
    encodeSmartSessionSignature: vi.fn(),
    getAccountEIP712Domain: vi.fn(),
    getEnableSessionCall: vi.fn(),
    getPermissionId: vi.fn(),
    getSmartSessionValidator: vi.fn(),
    isSessionEnabled: vi.fn(),
    getSessionAllowedERC7739Content: vi.fn(),
    SMART_SESSION_MODE_USE: '0x00',
    SMART_SESSION_MODE_ENABLE: '0x01',
    SMART_SESSION_MODE_UNSAFE_ENABLE: '0x02',
    SMART_SESSIONS_VALIDATOR_ADDRESS: '0xvalidatorAddress',
}))

describe('Validators Index Tests', () => {
    describe('Constants', () => {
        it('should export the correct constants', () => {
            expect(SMART_SESSION_MODE_USE).toBe(SMART_SESSION_MODE_USE_ORIGINAL)
            expect(SMART_SESSION_MODE_ENABLE).toBe(SMART_SESSION_MODE_ENABLE_ORIGINAL)
            expect(SMART_SESSIONS_VALIDATOR_ADDRESS).toBe(SMART_SESSIONS_VALIDATOR_ADDRESS_ORIGINAL)
        })
    })

    describe('Function Exports', () => {
        it('should export getOwnerValidator from core', () => {
            // Mock the core function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            coreMockSignature.mockReturnValue(mockResult)

            // Call the exported function
            const result = getMockSignature(mockArgs)

            // Verify it calls the core function
            expect(coreMockSignature).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getMockSignature from core', () => {
            // Mock the core function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            coreOwnerValidator.mockReturnValue(mockResult)

            // Call the exported function
            const result = getOwnerValidator(mockArgs)

            // Verify it calls the core function
            expect(coreOwnerValidator).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getSmartSessionValidator from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetValidator.mockReturnValue(mockResult)

            // Call the exported function
            const result = getSmartSessionValidator(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsGetValidator).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getEnableSessionCall from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsEnableCall.mockReturnValue(mockResult)

            // Call the exported function
            const result = getEnableSessionCall(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsEnableCall).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export encodeSmartSessionSignature from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsEncodeSignature.mockReturnValue(mockResult)

            // Call the exported function
            const result = encodeSmartSessionSignature(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsEncodeSignature).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getPermissionId from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetPermissionId.mockReturnValue(mockResult)

            // Call the exported function
            const result = getPermissionId(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsGetPermissionId).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getAccountEIP712Domain from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetDomain.mockReturnValue(mockResult)

            // Call the exported function
            const result = getAccountEIP712Domain(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsGetDomain).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export isSessionEnabled from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsIsEnabled.mockReturnValue(mockResult)

            // Call the exported function
            const result = isSessionEnabled(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsIsEnabled).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getSessionAllowedERC7739Content from smart-sessions', () => {
            // Mock the smart-sessions function
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetContent.mockReturnValue(mockResult)

            // Call the exported function
            const result = getSessionAllowedERC7739Content(mockArgs)

            // Verify it calls the smart-sessions function
            expect(smartSessionsGetContent).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })
    })
})
