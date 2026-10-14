import type { RhinestoneAccount } from '../api/account'
import type { LazyCallInput } from '../config/account'

/**
 * Build a factory call to deploy a managed EVM account.
 * @param account The managed EVM account whose factory and initialization data to use
 * @returns A lazy deployment call; this builder does not wait for execution
 */
export function deploy(account: RhinestoneAccount): LazyCallInput {
  const initData = account.getInitData()
  return {
    async resolve() {
      return { to: initData.factory, data: initData.factoryData }
    },
  }
}
