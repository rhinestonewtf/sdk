import type { Address } from 'viem'
import type { ResolvedModule } from './types'

export const INTENT_EXECUTOR_ADDRESS: Address =
  '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF'
export const INTENT_EXECUTOR_ADDRESS_DEV: Address =
  '0xbf9b5b917a83f8adac17b0752846d41d8d7b7e17'

export function getIntentExecutorModule(
  environment: 'production' | 'development',
): ResolvedModule {
  return {
    kind: 'executor',
    address:
      environment === 'development'
        ? INTENT_EXECUTOR_ADDRESS_DEV
        : INTENT_EXECUTOR_ADDRESS,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
  }
}
