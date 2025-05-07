
import { vi, describe, it, expect } from 'vitest'
import {
    MODULE_TYPE_ID_VALIDATOR,
    MODULE_TYPE_ID_EXECUTOR,
    MODULE_TYPE_ID_FALLBACK,
    MODULE_TYPE_ID_HOOK,
} from '../../src/modules/common'

describe('Module Common Tests', () => {
    describe('Module Type Constants', () => {
        it('should export the correct module type constants', () => {
            expect(MODULE_TYPE_ID_VALIDATOR).toBe(1n)
            expect(MODULE_TYPE_ID_EXECUTOR).toBe(2n)
            expect(MODULE_TYPE_ID_FALLBACK).toBe(3n)
            expect(MODULE_TYPE_ID_HOOK).toBe(4n)
        })

        it('should have unique values for each module type', () => {
            const moduleTypes = [
                MODULE_TYPE_ID_VALIDATOR,
                MODULE_TYPE_ID_EXECUTOR,
                MODULE_TYPE_ID_FALLBACK,
                MODULE_TYPE_ID_HOOK,
            ]
            
            const uniqueModuleTypes = new Set(moduleTypes)
            expect(uniqueModuleTypes.size).toBe(moduleTypes.length)
        })
    })
})
