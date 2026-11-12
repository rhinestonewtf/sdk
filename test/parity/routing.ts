type ApiVersion = 'alps' | 'blanc'

type Op =
  | 'quote'
  | 'submit'
  | 'status'
  | 'portfolio'
  | 'splits'
  | 'appFeeBalances'
  | 'chains'
  | 'other'

interface Route {
  apiVersion: ApiVersion
  op: Op
}

const PATH_ROUTES: {
  method: string
  pattern: RegExp
  apiVersion: ApiVersion
  op: Op
}[] = [
  {
    method: 'POST',
    pattern: /^\/intents\/route$/,
    apiVersion: 'alps',
    op: 'quote',
  },
  {
    method: 'POST',
    pattern: /^\/intent-operations$/,
    apiVersion: 'alps',
    op: 'submit',
  },
  {
    method: 'GET',
    pattern: /^\/intent-operations$/,
    apiVersion: 'alps',
    op: 'other',
  },
  {
    method: 'GET',
    pattern: /^\/intent-operation\/[^/]+$/,
    apiVersion: 'alps',
    op: 'status',
  },
  {
    method: 'POST',
    pattern: /^\/intents\/split$/,
    apiVersion: 'alps',
    op: 'splits',
  },
  { method: 'POST', pattern: /^\/quotes$/, apiVersion: 'blanc', op: 'quote' },
  {
    method: 'POST',
    pattern: /^\/quotes\/estimate$/,
    apiVersion: 'blanc',
    op: 'other',
  },
  { method: 'POST', pattern: /^\/intents$/, apiVersion: 'blanc', op: 'submit' },
  {
    method: 'POST',
    pattern: /^\/intents\/splits$/,
    apiVersion: 'blanc',
    op: 'splits',
  },
  {
    method: 'GET',
    pattern: /^\/intents\/[^/]+$/,
    apiVersion: 'blanc',
    op: 'status',
  },
]

const SHARED_ROUTES: { method: string; pattern: RegExp; op: Op }[] = [
  { method: 'GET', pattern: /^\/accounts\/[^/]+\/portfolio$/, op: 'portfolio' },
  { method: 'GET', pattern: /^\/app-fees\/balances$/, op: 'appFeeBalances' },
  { method: 'GET', pattern: /^\/chains$/, op: 'chains' },
]

function versionFromHeader(header: string | undefined): ApiVersion | undefined {
  if (!header) return undefined
  if (header.endsWith('.blanc')) return 'blanc'
  if (header.endsWith('.alps')) return 'alps'
  return undefined
}

// The path decides first: alps submits carry no version header. Shared paths
// fall back to the header, then to alps (the server default).
function routeRequest(
  method: string,
  path: string,
  apiVersionHeader: string | undefined,
): Route {
  const upper = method.toUpperCase()
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path
  for (const route of PATH_ROUTES) {
    if (route.method === upper && route.pattern.test(trimmed)) {
      return { apiVersion: route.apiVersion, op: route.op }
    }
  }
  const apiVersion = versionFromHeader(apiVersionHeader) ?? 'alps'
  const shared = SHARED_ROUTES.find(
    (route) => route.method === upper && route.pattern.test(trimmed),
  )
  return { apiVersion, op: shared?.op ?? 'other' }
}

export type { ApiVersion, Op, Route }
export { routeRequest }
