import type { Address } from 'viem'
import type { SigningRequest, SigningScope } from '../../src/index'

declare const request: SigningRequest

type EvmHyperCore = NonNullable<
  Extract<SigningScope, { vm: 'evm' }>['hyperCore']
>

if (request.scope.vm === 'evm' && request.scope.hyperCore) {
  // The first registration is guaranteed once the list is present.
  const [first, ...rest] = request.scope.hyperCore
  const agent: Address = first.agent
  const slot: string = first.slot
  const nonce: number = first.nonce
  void agent
  void slot
  void nonce
  void rest

  // @ts-expect-error — a list of registrations, not a single one.
  void request.scope.hyperCore.agent
}

// @ts-expect-error — the orchestrator omits the field rather than sending [].
const empty: EvmHyperCore = []
void empty

// Exhaustive over every scope the SDK narrows at the wire boundary.
function describeScope(scope: SigningScope): string {
  switch (scope.vm) {
    case 'evm':
      return scope.action
    case 'svm':
      switch (scope.action) {
        case 'spend':
          return `${scope.instructions.length} instructions`
        case 'manageAuthority':
          return `${scope.authority.action} role ${scope.authority.roleId}`
        default: {
          const unreachable: never = scope
          return unreachable
        }
      }
    default: {
      const unreachable: never = scope
      return unreachable
    }
  }
}
void describeScope
