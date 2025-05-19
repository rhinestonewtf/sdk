// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect } from 'vitest'
import { OrchestratorError } from '../../src/orchestrator/error'

describe('OrchestratorError Tests', () => {
    describe('constructor', () => {
        it('should create an error with default values', () => {
            const error = new OrchestratorError()
            
            expect(error.message).toBe('OrchestratorError ')
            expect(error.context).toEqual({})
            expect(error.errorType).toBe('Unknown')
            expect(error.traceId).toBe('')
        })

        it('should create an error with provided values', () => {
            const error = new OrchestratorError({
                message: 'Test error message',
                context: { key: 'value' },
                errorType: 'TestError',
                traceId: '123456'
            })
            
            expect(error.message).toBe('Test error message')
            expect(error.context).toEqual({ key: 'value' })
            expect(error.errorType).toBe('TestError')
            expect(error.traceId).toBe('123456')
        })
    })

    describe('getters', () => {
        it('should return the correct values from getters', () => {
            const error = new OrchestratorError({
                message: 'Test error message',
                context: { key: 'value' },
                errorType: 'TestError',
                traceId: '123456'
            })
            
            expect(error.message).toBe('Test error message')
            expect(error.context).toEqual({ key: 'value' })
            expect(error.errorType).toBe('TestError')
            expect(error.traceId).toBe('123456')
        })
    })

    describe('inheritance', () => {
        it('should be an instance of Error', () => {
            const error = new OrchestratorError()
            
            expect(error).toBeInstanceOf(Error)
            expect(error).toBeInstanceOf(OrchestratorError)
        })
    })
})
