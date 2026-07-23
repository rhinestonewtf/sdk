import type { Address } from 'viem'
import type { ResolvedModule } from '../../types'

export const SMART_SESSION_EMISSARY_ADDRESS: Address =
  '0xad568b3f825a8d5ffc06dd3253526b64d810ae89'
export const SMART_SESSION_EMISSARY_ADDRESS_DEV: Address =
  '0x60731de80d78548875f8a67c4fec2a8660194e0c'

export function getSmartSessionEmissaryAddress(
  environment: 'production' | 'development',
): Address {
  return environment === 'development'
    ? SMART_SESSION_EMISSARY_ADDRESS_DEV
    : SMART_SESSION_EMISSARY_ADDRESS
}

export function resolveSmartSessionModule(input: {
  readonly enabled: boolean
  readonly address?: Address
  readonly environment: 'production' | 'development'
}): ResolvedModule | undefined {
  if (!input.enabled) return undefined
  return {
    kind: 'validator',
    address: input.address ?? getSmartSessionEmissaryAddress(input.environment),
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
  }
}
