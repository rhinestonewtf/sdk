import { RhinestoneAccountConfig } from './types'

function is7702(config: RhinestoneAccountConfig): boolean {
  return config.eoaAccount !== undefined
}

export { is7702 }
