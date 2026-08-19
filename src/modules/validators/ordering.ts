import type { Hex } from 'viem'

// Order by value, never by host collation: `localeCompare` sorts `0xaa…` after
// `0xb1…` on Danish-family locales, which would change derived addresses and
// break the validators' ascending-order requirement.
export function compareHexValues(left: Hex, right: Hex): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue === rightValue) {
    return 0
  }
  return leftValue < rightValue ? -1 : 1
}
