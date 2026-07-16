import type { AccountAdapter } from './adapter'
import { createEoaAdapter } from './adapters/eoa'
import { createHcaAdapter } from './adapters/hca'
import { createKernelAdapter } from './adapters/kernel'
import { createNexusAdapter } from './adapters/nexus'
import { createSafeAdapter } from './adapters/safe'
import { createStartaleAdapter } from './adapters/startale'
import type { AccountConstruction } from './types'

export function createAccountAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  switch (construction.account.kind) {
    case 'safe':
      return createSafeAdapter(construction)
    case 'nexus':
      return createNexusAdapter(construction)
    case 'kernel':
      return createKernelAdapter(construction)
    case 'startale':
      return createStartaleAdapter(construction)
    case 'hca':
      return createHcaAdapter(construction)
    case 'eoa':
      return createEoaAdapter(construction)
  }
}
