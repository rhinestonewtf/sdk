import type { RhinestoneAccount } from '../api/account'
import type { LazyCallInput } from '../config/account'

export function deploy(account: RhinestoneAccount): LazyCallInput {
  const initData = account.getInitData()
  return {
    async resolve() {
      return { to: initData.factory, data: initData.factoryData }
    },
  }
}
