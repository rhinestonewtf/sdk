/**
 * Friendly named aliases over the generated {@link wire.gen} types.
 *
 * The generated spec inlines every schema (no `components.schemas`), so the
 * request/response shapes are otherwise only reachable through deep
 * `operations[...]` indexing. These aliases give the orchestrator client stable
 * names to adapt against; when the wire shape drifts, regenerating `wire.gen.ts`
 * surfaces the change as a typecheck error at the adapter boundary in
 * `client.ts`.
 */
import type { operations } from './wire.gen'

type SuccessJson<
  O extends keyof operations,
  S extends number,
> = operations[O]['responses'] extends Record<
  S,
  { content: { 'application/json': infer T } }
>
  ? T
  : never

// POST /quotes
export type WireQuoteResponse = SuccessJson<'createQuote', 200>
export type WireRoute = WireQuoteResponse['routes'][number]
export type WireCost = WireRoute['cost']
export type WireCostInputEntry = WireCost['input'][number]
export type WireCostOutputEntry = WireCost['output'][number]
export type WireAppFee = NonNullable<WireRoute['appFee']>[number]
export type WireBridgeFill = NonNullable<WireRoute['bridgeFill']>
export type WireTokenRequirements = NonNullable<WireRoute['tokenRequirements']>

// POST /intents/splits
export type WireSplitResponse = SuccessJson<'getSplit', 200>

// POST /intents
export type WireIntentSubmitResponse = SuccessJson<'createIntent', 201>

// GET /intents/{id}
export type WireIntentStatus = SuccessJson<'getIntent', 200>

// GET /accounts/{accountAddress}/portfolio
export type WirePortfolioResponse = SuccessJson<'getPortfolio', 200>
