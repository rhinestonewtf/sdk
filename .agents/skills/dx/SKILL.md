---
name: dx
description: Design guidance for changing the @rhinestone/sdk public surface so it
  is safe, intuitive, and pleasant to integrate. Use when adding, renaming, or
  changing public exports, types, account/action APIs, config objects, error
  classes, or defaults in sdk/src.
user-invocable: false
---

# SDK DX

You are changing the public surface of `@rhinestone/sdk`. Every public type,
name, default, and error message is something an integrator must learn,
remember, or get right. Design so they have to do less of all three.

This skill is about *designing* the surface well. The mechanics of *what counts
as public* and *how to ship it* (viem types, subpath exports, JSDoc→reference
regen, changesets) live in `sdk/CLAUDE.md` and the `changesets` skill — use
them; don't relitigate them here.

## Apply when

The diff touches the public surface: `src/index.ts` re-exports, subpath exports,
exported types/interfaces, account or action APIs, public config objects, error
classes, or default values. Skip for internal-only changes.

## Principles

### 1. Make illegal states unrepresentable

Model mutually-exclusive options as a discriminated union, not optional fields
guarded by a runtime `throw`. If a consumer *can* construct an invalid object,
they eventually will. A union teaches the rule in autocomplete; a runtime check
teaches it only when it throws.

```ts
// Good — same-chain carries `chain`, cross-chain carries `targetChain`.
// You cannot construct one with both.
interface SameChainTransaction      { chain: Chain; /* ... */ }
interface CrossChainEvmTransaction  { targetChain: Chain; sourceChains?: Chain[] }
type Transaction = SameChainTransaction | CrossChainTransaction

// A tuple can even encode "omit `amount` and you may pass exactly one":
type TokenRequests = [TokenRequestWithoutAmount] | TokenRequestWithAmount[]
```

```ts
// Bad — one flat shape plus a runtime guard the consumer discovers by hitting it.
interface Transaction { chain?: Chain; targetChain?: Chain /* set exactly one */ }
if (tx.chain && tx.targetChain) throw new Error('cannot set both')
```

### 2. Lean on inference; never widen with `any`/`as`

Keep the surface precisely typed with generics, `satisfies`, and literal types so
type-checking does the consumer's work for them. A cast in a public signature
hands a runtime bug to the integrator.

```ts
// Good — the ABI gates which sugar fields are even allowed. `spendingLimit` is
// `never` unless the function is ERC-20 transfer-like, so passing it on
// `vault.deposit` is a compile error, not a silently-dropped field.
type SpendingLimitField<TFn extends AbiFunction> =
  IsERC20TransferLike<TFn> extends true
    ? { spendingLimit?: { token: Address; amount: bigint } }
    : { spendingLimit?: never }
```

```ts
// Bad — accept it always, ignore it at runtime. Silent drops are the worst DX:
// no error, wrong behavior.
type PermissionFunctionConfig = { spendingLimit?: { token: Address; amount: bigint } }
```

### 3. Self-documenting first, JSDoc second

Names should say what they do and read like the rest of the SDK. Give a config
shape a named exported type rather than an inline anonymous object so it appears
in autocomplete and the reference site. Then add JSDoc on every public symbol —
one line on what it's for, plus `@param`/`@returns`/`@throws` where non-obvious.
Mark unstable APIs with the `experimental_` prefix.

### 4. Make the common path short; put depth behind defaults

The minimal call should be minimal. Anything you can infer or default, default —
don't make the consumer pass it. Reserve required arguments for what only the
consumer can know; advanced knobs are optional and additive.

```ts
// Good — `true` covers the common case; reach for the object only when you need
// per-category control.
type Sponsorship = boolean | { gas: boolean; bridging: boolean; swaps: boolean }
```

### 5. Errors are part of the API

When a failure is genuinely runtime (network, orchestrator, async execution),
throw a typed error class exported from `/errors` with an `isXError` guard — not
a bare `throw new Error('string')`. The message must be actionable: what went
wrong, the offending value, and what to do — addressed to an integrator who can't
see SDK internals. A fix-hint must name a **real, current** public export; a
wrong name is worse than no name. No leaked file names or internal jargon.

```ts
// Good — typed, catchable, and the message says what / why / how to fix.
throw new Eip7702InitSignatureRequiredError()
// "EIP-7702 initialization signature is required for 7702 accounts ...
//  Use `signEip7702InitData()` to generate it."

// Bad — opaque and uncatchable: no guard, not exported, no fix hint.
throw new Error('Validator not available')
```

### 6. Be consistent with what's already there

A new API should feel like the existing ones: the `prepare → sign → submit →
waitForExecution` pipeline shape, viem types for addresses/chains/hex, the
subpath layout, async naming. Surprising-but-clever loses to
boring-and-predictable.

## Before you finish

- [ ] Could any new runtime `throw` have been a type? If so, make it a type.
- [ ] Any `any`/`as` in a public signature? Remove it.
- [ ] Every new export has JSDoc and is added to `scripts/reference/manifest.ts`.
- [ ] New error classes are exported from `/errors` with a guard and an
      actionable message.
- [ ] Common-case call works with minimal args; defaults cover the rest.
- [ ] Changeset written (use `changesets`); `bun run typecheck` passes.
