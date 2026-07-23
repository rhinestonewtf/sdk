import { OwnersFieldRequiredError } from '../accounts/error'
import type { ResolvedAccountConfig } from './resolved'

export function assertAccountOwnersConfigured(
  config: ResolvedAccountConfig,
): void {
  if (config.account.kind !== 'eoa' && !config.owners) {
    throw new OwnersFieldRequiredError()
  }
}
