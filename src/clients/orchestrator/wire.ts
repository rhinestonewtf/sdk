// Named aliases for the generated orchestrator wire shapes (`wire.gen.ts`).
// The mappers read/write these at the HTTP boundary; keying the mapper casts on
// these aliases turns an OpenAPI schema drift into a typecheck error the next
// time `bun run generate:wire` runs, per the generator's contract.
import type { operations } from './wire.gen'

type JsonResponse<Operation extends keyof operations> = NonNullable<
  operations[Operation]['responses'] extends { 200: infer Ok }
    ? Ok extends { content: { 'application/json': infer Body } }
      ? Body
      : never
    : never
>

// `fetchOrchestratorJson` folds the `x-trace-id` response header into every
// JSON body, so a mapped response is the generated body plus that trace id.
type Folded<Body> = Body & { readonly traceId?: string }

export type WireQuoteResponse = Folded<JsonResponse<'createQuote'>>
export type WireQuote = WireQuoteResponse['routes'][number]
export type WirePortfolioResponse = Folded<JsonResponse<'getPortfolio'>>
export type WireIntentStatusResponse = Folded<JsonResponse<'getIntent'>>
export type WireSplitResponse = Folded<JsonResponse<'getSplit'>>
