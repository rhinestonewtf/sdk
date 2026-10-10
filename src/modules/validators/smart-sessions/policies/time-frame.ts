import type { Permission, SessionPolicy } from '../types'

/** Year 2100 in ms: the always-passing validUntil of a one-sided window. */
export const FAR_FUTURE_MS = 4_102_444_800_000

export type TimeFrame = Extract<SessionPolicy, { type: 'time-frame' }>

/** Whether `ms` is a time TimeFramePolicy can hold: whole seconds in uint48. */
export function isWindowTime(ms: unknown): ms is number {
  return typeof ms === 'number' && ms >= 0 && ms < 2 ** 48 * 1000
}

/** A window (unix ms) as a time-frame policy; an open end always passes. */
export function timeFrame(validAfter?: number, validUntil?: number): TimeFrame {
  return {
    type: 'time-frame',
    validUntil: validUntil ?? FAR_FUTURE_MS,
    validAfter: validAfter ?? 0,
  }
}

/** A permit's window (unix seconds) as a time-frame policy, if it sets one. */
export function permitTimeFrame(permit: {
  readonly validAfter?: bigint
  readonly validUntil?: bigint
}): TimeFrame | undefined {
  const ms = (s?: bigint) => (s === undefined ? s : Number(s * 1000n))
  return permit.validAfter === undefined && permit.validUntil === undefined
    ? undefined
    : timeFrame(ms(permit.validAfter), ms(permit.validUntil))
}

/** The time both windows allow: the later start and the earlier end. */
export function intersectTimeFrames(a: TimeFrame, b: TimeFrame): TimeFrame {
  return timeFrame(
    Math.max(a.validAfter, b.validAfter),
    Math.min(a.validUntil, b.validUntil),
  )
}

/** The time either window allows, and any gap between them. */
export function unionTimeFrames(a: TimeFrame, b: TimeFrame): TimeFrame {
  return timeFrame(
    Math.min(a.validAfter, b.validAfter),
    Math.max(a.validUntil, b.validUntil),
  )
}

/** Whether no second passes the policy's `validAfter <= t < validUntil`. */
export function isEmptyTimeFrame({
  validAfter,
  validUntil,
}: Omit<TimeFrame, 'type'>): boolean {
  return Math.ceil(validAfter / 1000) >= Math.floor(validUntil / 1000)
}

/** The action with `window` added to its policies. */
export function withTimeFrame<
  T extends { readonly policies?: SessionPolicy[] },
>(action: T, window: TimeFrame | undefined): T {
  return window
    ? { ...action, policies: [...(action.policies ?? []), window] }
    : action
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
