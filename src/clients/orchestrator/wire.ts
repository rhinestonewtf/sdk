// Named aliases for the generated orchestrator wire shapes (`wire.gen.ts`).
// The mappers read/write these at the HTTP boundary; keying the mapper casts on
// these aliases turns an OpenAPI schema drift into a typecheck error the next
// time `bun run generate:wire` runs, per the generator's contract.
import type { operations } from './wire.gen'

type JsonRequest<Operation extends keyof operations> =
  operations[Operation] extends {
    requestBody: { content: { 'application/json': infer Body } }
  }
    ? Body
    : never

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

export type WireQuoteRequest = JsonRequest<'createQuote'>
export type WireIntentRequest = JsonRequest<'createIntent'>
// The orchestrator consumes this internal simulation flag outside the public schema.
export type WireIntentRequestInternal = WireIntentRequest & {
  readonly options?: { readonly dryRun?: boolean }
}
export type WireSplitRequest = JsonRequest<'getSplit'>
export type WireQuoteResponse = Folded<JsonResponse<'createQuote'>>
export type WireQuote = WireQuoteResponse['routes'][number]
export type WirePortfolioResponse = Folded<JsonResponse<'getPortfolio'>>
export type WireIntentStatusResponse = Folded<JsonResponse<'getIntent'>>
export type WireSplitResponse = Folded<JsonResponse<'getSplit'>>
// The `/chains` catalog: a CAIP-2-keyed map of chain facts. Not folded — the
// trace id (if present) is a non-CAIP-2 key the catalog parser skips.
export type WireChainsResponse = JsonResponse<'listChains'>
