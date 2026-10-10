import { FAR_FUTURE_MS } from '../../permissions'
import type { Permission, SessionPolicy } from '../types'

export type TimeFrame = Extract<SessionPolicy, { type: 'time-frame' }>

/** A permit's window (unix seconds) as a time-frame policy; an open end always passes. */
export function permitTimeFrame(permit: {
  readonly validAfter?: bigint
  readonly validUntil?: bigint
}): TimeFrame | undefined {
  if (permit.validAfter === undefined && permit.validUntil === undefined) {
    return undefined
  }
  return {
    type: 'time-frame',
    validUntil:
      permit.validUntil === undefined
        ? FAR_FUTURE_MS
        : Number(permit.validUntil * 1000n),
    validAfter:
      permit.validAfter === undefined ? 0 : Number(permit.validAfter * 1000n),
  }
}

/** A window of `Date`s as a time-frame policy; an open end always passes. */
export function dateTimeFrame(validAfter?: Date, validUntil?: Date): TimeFrame {
  return {
    type: 'time-frame',
    validUntil: validUntil?.getTime() ?? FAR_FUTURE_MS,
    validAfter: validAfter?.getTime() ?? 0,
  }
}

/** The time both windows allow: the later start and the earlier end. */
export function intersectTimeFrames(a: TimeFrame, b: TimeFrame): TimeFrame {
  return {
    type: 'time-frame',
    validUntil: Math.min(a.validUntil, b.validUntil),
    validAfter: Math.max(a.validAfter, b.validAfter),
  }
}

/**
 * The action with `window` among its policies. An action keeps one config per
 * policy contract, so a window it already has is narrowed to both.
 */
export function withTimeFrame<
  T extends { readonly policies?: SessionPolicy[] },
>(action: T, window: TimeFrame | undefined): T {
  if (window === undefined) return action
  const policies = action.policies ?? []
  const own = policies.find((policy) => policy.type === 'time-frame')
  return {
    ...action,
    policies: own
      ? policies.map((policy) =>
          policy === own ? intersectTimeFrames(own, window) : policy,
        )
      : [...policies, window],
  }
}

/** The permission with `window` on every function, as `validAfter`/`validUntil`. */
export function permissionWithTimeFrame(
  permission: Permission,
  window: TimeFrame | undefined,
): Permission {
  if (window === undefined) return permission
  return {
    ...permission,
    functions: Object.fromEntries(
      Object.entries(permission.functions).map(([name, config]) => [
        name,
        config && {
          ...config,
          validAfter: new Date(window.validAfter),
          validUntil: new Date(window.validUntil),
        },
      ]),
    ),
  }
}
