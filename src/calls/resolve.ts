import type {
  Call,
  CallResolveContext,
  LazyCallInput,
  UnresolvedCall,
} from './types'

function isLazyCall<CompatibilityConfig>(
  call: UnresolvedCall<CompatibilityConfig>,
): call is LazyCallInput<CompatibilityConfig> {
  return 'resolve' in call && typeof call.resolve === 'function'
}

export async function resolveCalls<CompatibilityConfig>(
  calls: readonly UnresolvedCall<CompatibilityConfig>[],
  context: CallResolveContext<CompatibilityConfig>,
): Promise<readonly Call[]> {
  const resolved: Call[] = []
  for (const call of calls) {
    if (!isLazyCall(call)) {
      resolved.push(call)
      continue
    }
    const value = await call.resolve(context)
    resolved.push(...(Array.isArray(value) ? value : [value]))
  }
  return resolved
}
