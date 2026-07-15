export type SecretFindingKind =
  | 'api-key'
  | 'auth-header'
  | 'credential'
  | 'credential-url'
  | 'jwt'
  | 'private-key'
  | 'wallet-payload'

export interface SecretFinding {
  kind: SecretFindingKind
  path: string
  message: string
}

const SENSITIVE_FIELD_KINDS: Readonly<Record<string, SecretFindingKind>> = {
  apikey: 'api-key',
  bearertoken: 'jwt',
  clientsecret: 'api-key',
  idtoken: 'jwt',
  jwt: 'jwt',
  mnemonic: 'private-key',
  password: 'credential',
  privatekey: 'private-key',
  recoveryphrase: 'private-key',
  refreshtoken: 'jwt',
  secretkey: 'private-key',
  seedphrase: 'private-key',
  xapikey: 'api-key',
  accesstoken: 'jwt',
}

function sensitiveFieldKind(
  key: string,
  parentPath: string,
): SecretFindingKind | undefined {
  const normalizedKey = normalizeFieldName(key)
  if (
    ['authorization', 'proxyauthorization'].includes(normalizedKey) &&
    parentPath
      .split('/')
      .some((segment) => normalizeFieldName(segment) === 'headers')
  ) {
    return 'auth-header'
  }
  return SENSITIVE_FIELD_KINDS[normalizedKey]
}

const VALUE_PATTERNS: ReadonlyArray<{
  kind: SecretFindingKind
  pattern: RegExp
  message: string
}> = [
  {
    kind: 'auth-header',
    pattern: /\b(?:basic|bearer)\s+[a-z0-9._~+/=-]+/i,
    message: 'authentication credential value',
  },
  {
    kind: 'jwt',
    pattern: /\beyJ[a-z0-9_-]+\.eyJ[a-z0-9_-]+\.[a-z0-9_-]+\b/i,
    message: 'JWT-shaped value',
  },
  {
    kind: 'private-key',
    pattern: /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/,
    message: 'PEM private key',
  },
  {
    kind: 'api-key',
    pattern:
      /\b(?:sk-(?:proj-)?[a-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[a-z0-9]{12,}|ghp_[a-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/i,
    message: 'provider API key-shaped value',
  },
  {
    kind: 'private-key',
    pattern: /\bprivate[ _-]?key\s*[:=]\s*0x[a-f0-9]{64}\b/i,
    message: 'private key-shaped value',
  },
]

function normalizeFieldName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(path: string, segment: string | number): string {
  return `${path}/${escapePointerSegment(String(segment))}`
}

function hasCredentialUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.username.length > 0 || url.password.length > 0
  } catch {
    return false
  }
}

function hasWalletKeystoreShape(value: object): boolean {
  const keys = new Set(Object.keys(value).map((key) => normalizeFieldName(key)))
  return (
    keys.has('ciphertext') &&
    keys.has('kdf') &&
    (keys.has('crypto') || keys.has('mac'))
  )
}

function hasSensitiveValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  return true
}

export function scanForSecrets(value: unknown): SecretFinding[] {
  const findings: SecretFinding[] = []
  const visited = new WeakSet<object>()

  function visit(current: unknown, path: string): void {
    if (typeof current === 'string') {
      for (const candidate of VALUE_PATTERNS) {
        if (candidate.pattern.test(current)) {
          findings.push({
            kind: candidate.kind,
            path: path || '/',
            message: candidate.message,
          })
        }
      }
      if (hasCredentialUrl(current)) {
        findings.push({
          kind: 'credential-url',
          path: path || '/',
          message: 'URL contains embedded credentials',
        })
      }
      return
    }

    if (typeof current !== 'object' || current === null) return
    if (visited.has(current)) return
    visited.add(current)

    if (hasWalletKeystoreShape(current)) {
      findings.push({
        kind: 'wallet-payload',
        path: path || '/',
        message: 'encrypted wallet keystore payload',
      })
    }

    if (current instanceof Map) {
      let index = 0
      for (const [key, mapValue] of current.entries()) {
        visit(key, childPath(childPath(path, index), 'key'))
        visit(mapValue, childPath(childPath(path, index), 'value'))
        index += 1
      }
      return
    }

    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        visit(current[index], childPath(path, index))
      }
      return
    }

    for (const [key, child] of Object.entries(current)) {
      const childLocation = childPath(path, key)
      const kind = sensitiveFieldKind(key, path)
      if (kind && hasSensitiveValue(child)) {
        findings.push({
          kind,
          path: childLocation,
          message: `sensitive field ${JSON.stringify(key)}`,
        })
      }
      visit(child, childLocation)
    }
  }

  visit(value, '')
  return findings.sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1
    if (left.kind === right.kind) return 0
    return left.kind < right.kind ? -1 : 1
  })
}

export class SecretScanError extends Error {
  readonly findings: SecretFinding[]

  constructor(findings: SecretFinding[]) {
    super(
      `Refusing to write characterization artifact with possible secrets: ${findings
        .map((finding) => `${finding.kind} at ${finding.path}`)
        .join(', ')}`,
    )
    this.name = 'SecretScanError'
    this.findings = findings
  }
}

export function assertNoSecrets(value: unknown): void {
  const findings = scanForSecrets(value)
  if (findings.length > 0) throw new SecretScanError(findings)
}
