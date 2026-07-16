import type { AccountAdapter } from '../adapter'
import { deploymentPlan } from '../deployment'
import { ModuleInstallationNotSupportedError } from '../error'
import type { AccountConstruction } from '../types'

function eoaAddress(input: AccountConstruction) {
  if (input.account.kind !== 'eoa') throw new Error('Expected EOA account')
  if (!input.eoa) throw new Error('EOA account is required')
  return input.eoa.address
}

export function createEoaAdapter(
  construction: AccountConstruction,
): AccountAdapter {
  if (construction.account.kind !== 'eoa') {
    throw new Error('Expected EOA account')
  }
  return {
    account: construction.account,
    capabilities: {
      modular: false,
      supportsDeployment: false,
      supportsUserOperations: false,
      supportsEip7702Adoption: false,
      supportsSmartSessions: false,
      supportsOriginSignatureReuse: true,
      signatureEnvelope: { kind: 'none' },
    },
    getIdentity: (input) => ({
      definition: input.account,
      address: eoaAddress(input),
    }),
    getDeploymentPlan: (input) =>
      deploymentPlan(input.chain, { address: eoaAddress(input) }, true),
    encodeCalls: () => {
      throw new Error('EOA calls do not use ERC-7579 encoding')
    },
    encodeModuleInstallation: () => {
      throw new ModuleInstallationNotSupportedError('eoa')
    },
    encodeModuleUninstallation: () => {
      throw new ModuleInstallationNotSupportedError('eoa')
    },
    encodeSignatureEnvelope: ({ envelope, validatorContribution }) => {
      if (envelope.kind !== 'none') throw new Error('Expected EOA envelope')
      return validatorContribution
    },
  }
}
