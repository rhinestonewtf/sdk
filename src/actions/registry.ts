import { RhinestoneAccount } from '..'
import { getTrustAttesterCall } from '../modules'

function trustAttester(account: RhinestoneAccount) {
  return getTrustAttesterCall(account.config)
}

export { trustAttester }
