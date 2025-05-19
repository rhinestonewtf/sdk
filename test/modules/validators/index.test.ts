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
} from '../../../src/modules/validators'

import { getMockSignature as coreMockSignature, getOwnerValidator as coreOwnerValidator } from '../../../src/modules/validators/core'
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
} from '../../../src/modules/validators/smart-sessions'

vi.mock('../../../src/modules/validators/core', () => ({
    getMockSignature: vi.fn(),
    getOwnerValidator: vi.fn(),
}))

vi.mock('../../../src/modules/validators/smart-sessions', () => ({
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
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            coreMockSignature.mockReturnValue(mockResult)

            const result = getMockSignature(mockArgs)

            expect(coreMockSignature).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getMockSignature from core', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            coreOwnerValidator.mockReturnValue(mockResult)

            const result = getOwnerValidator(mockArgs)

            expect(coreOwnerValidator).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getSmartSessionValidator from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetValidator.mockReturnValue(mockResult)

            const result = getSmartSessionValidator(mockArgs)

            expect(smartSessionsGetValidator).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getEnableSessionCall from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsEnableCall.mockReturnValue(mockResult)

            const result = getEnableSessionCall(mockArgs)

            expect(smartSessionsEnableCall).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export encodeSmartSessionSignature from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsEncodeSignature.mockReturnValue(mockResult)

            const result = encodeSmartSessionSignature(mockArgs)

            expect(smartSessionsEncodeSignature).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getPermissionId from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetPermissionId.mockReturnValue(mockResult)

            const result = getPermissionId(mockArgs)

            expect(smartSessionsGetPermissionId).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getAccountEIP712Domain from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetDomain.mockReturnValue(mockResult)

            const result = getAccountEIP712Domain(mockArgs)

            expect(smartSessionsGetDomain).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export isSessionEnabled from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsIsEnabled.mockReturnValue(mockResult)

            const result = isSessionEnabled(mockArgs)

            expect(smartSessionsIsEnabled).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })

        it('should export getSessionAllowedERC7739Content from smart-sessions', () => {
            const mockArgs = { type: 'test' }
            const mockResult = { result: 'test' }
            smartSessionsGetContent.mockReturnValue(mockResult)

            const result = getSessionAllowedERC7739Content(mockArgs)

            expect(smartSessionsGetContent).toHaveBeenCalledWith(mockArgs)
            expect(result).toBe(mockResult)
        })
    })
})
