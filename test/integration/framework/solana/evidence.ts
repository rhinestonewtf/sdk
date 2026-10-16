export interface SolanaDiagnostic {
  runId?: string
  caseId?: string
  commit?: string
  service?: 'dev' | 'prod'
  chain?: string
  mint?: string
  swig?: string
  wallet?: string
  recipient?: string
  stage?: string
  timestamp?: string
  intentId?: string
  traceId?: string
  transaction?: string
  quotedAmount?: string
  balanceDelta?: string
  errorCode?: string
}
const keys = [
  'runId',
  'caseId',
  'commit',
  'service',
  'chain',
  'mint',
  'swig',
  'wallet',
  'recipient',
  'stage',
  'timestamp',
  'intentId',
  'traceId',
  'transaction',
  'quotedAmount',
  'balanceDelta',
  'errorCode',
] as const
export function safeSolanaDiagnostic(
  input: SolanaDiagnostic,
): SolanaDiagnostic {
  const output: SolanaDiagnostic = {}
  for (const key of keys) {
    const value = input[key]
    // No arbitrary errors, URL query strings, headers, proof objects, or artifacts.
    if (
      typeof value === 'string' &&
      /^[a-zA-Z0-9_.:/ -]{1,160}$/.test(value) &&
      !value.includes('://')
    )
      Object.assign(output, { [key]: value })
  }
  return output
}
export interface DeploymentEvidence {
  intentId: string
  quotedAmounts: string[]
  submissions: number
}
export function observeDeploymentFetch(
  fetcher: typeof fetch,
  evidence: DeploymentEvidence[],
  onEvidence?: (evidence: DeploymentEvidence) => void | Promise<void>,
  assertActive: () => void = () => {},
): typeof fetch {
  return (async (input, init) => {
    assertActive()
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    if (
      init?.method?.toUpperCase() === 'POST' &&
      new URL(url).pathname.endsWith('/intents') &&
      typeof init.body === 'string'
    ) {
      let intentId: unknown
      try {
        intentId = JSON.parse(init.body).intentId
      } catch {
        /* Invalid SDK request is left for the transport to refuse. */
      }
      const item = evidence.find((item) => item.intentId === intentId)
      if (item) {
        item.submissions++
        await onEvidence?.({ ...item, quotedAmounts: [...item.quotedAmounts] })
        assertActive()
      }
    }
    const response = await fetcher(input, init)
    if (
      response.ok &&
      init?.method?.toUpperCase() === 'POST' &&
      /\/(?:quotes|intents)\/?$/.test(new URL(url).pathname)
    ) {
      let body: unknown
      try {
        body = await response.clone().json()
      } catch {
        return response
      }
      if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>
        const isQuote = new URL(url).pathname.endsWith('/quotes')
        const records: unknown[] =
          isQuote && Array.isArray(record.routes) ? record.routes : [record]
        for (const candidate of records) {
          assertActive()
          if (!candidate || typeof candidate !== 'object') continue
          const route = candidate as Record<string, unknown>
          if (isQuote && route.purpose !== 'deployment') continue
          if (
            typeof route.intentId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,160}$/.test(route.intentId)
          )
            continue
          let item = evidence.find((item) => item.intentId === route.intentId)
          if (!item && isQuote) {
            item = {
              intentId: route.intentId,
              quotedAmounts: [],
              submissions: 0,
            }
            evidence.push(item)
          }
          if (!item) continue
          if (isQuote && Array.isArray(route.deploymentCosts)) {
            for (const cost of route.deploymentCosts) {
              const amount = cost?.rent?.amount
              if (typeof amount === 'string' && /^\d{1,30}$/.test(amount))
                item.quotedAmounts.push(amount)
            }
          }
          if (isQuote) {
            await onEvidence?.({
              ...item,
              quotedAmounts: [...item.quotedAmounts],
            })
            assertActive()
          }
        }
      }
    }
    return response
  }) as typeof fetch
}
