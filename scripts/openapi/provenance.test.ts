import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { resolveSpec, resolveVendoredSpec } from '../generate-wire-types'

const MANIFEST = fileURLToPath(new URL('./provenance.json', import.meta.url))
const ARTIFACT = fileURLToPath(new URL('./caucasus.json', import.meta.url))

const originalManifest = readFileSync(MANIFEST, 'utf8')
const originalArtifact = readFileSync(ARTIFACT)

const temporaryDirectories: string[] = []

/**
 * A copy of the snapshot the failure tests can corrupt. The tracked artifact is
 * never written to: a killed worker would otherwise leave it dirty, and
 * `generate:wire` then refuses to run.
 */
function snapshotCopy(overrides?: {
  readonly artifact?: string | Buffer
  readonly manifest?: string
}): URL {
  const directory = mkdtempSync(join(tmpdir(), 'openapi-provenance-'))
  temporaryDirectories.push(directory)
  writeFileSync(
    join(directory, 'caucasus.json'),
    overrides?.artifact ?? originalArtifact,
  )
  writeFileSync(
    join(directory, 'provenance.json'),
    overrides?.manifest ?? originalManifest,
  )
  return pathToFileURL(`${directory}/`)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('vendored OpenAPI provenance', () => {
  test('the checked-in snapshot matches its manifest', () => {
    const manifest = JSON.parse(originalManifest)
    expect(createHash('sha256').update(originalArtifact).digest('hex')).toBe(
      manifest.sha256,
    )
    expect(JSON.parse(originalArtifact.toString('utf8')).info.version).toBe(
      manifest.apiVersion,
    )
    expect(manifest.upstream.commit).toMatch(/^[0-9a-f]{40}$/u)
  })

  test('keeps read authority optional and signing authorization required', () => {
    const document = JSON.parse(originalArtifact.toString('utf8'))
    const objects: Record<string, unknown>[] = []
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry)
        return
      }
      if (typeof value !== 'object' || value === null) return
      objects.push(value as Record<string, unknown>)
      for (const entry of Object.values(value)) visit(entry)
    }
    visit(document)

    const summaries = objects.filter(
      ({ description }) =>
        description === 'A Solana Swig account resolved on one chain',
    )
    expect(summaries).toHaveLength(8)
    for (const summary of summaries) {
      expect(summary.required).toEqual(['wallet', 'swigAccount'])
      const authority = (
        summary.properties as Record<string, Record<string, unknown>>
      ).authority
      expect(
        (authority.oneOf as { properties: { kind: { enum: string[] } } }[]).map(
          (variant) => variant.properties.kind.enum[0],
        ),
      ).toEqual(['secp256k1', 'secp256r1'])
    }

    const signingRole = objects.find(
      ({ description }) =>
        description ===
        'A selected Swig role, plus the authority it carries. Reports the role this quote used; it does not claim to be the only role that could authorize the spend.',
    )
    expect(signingRole?.required).toContain('authority')

    const callerAccount = objects.find(
      ({ description }) => description === 'An existing Swig account',
    )
    expect(callerAccount?.required).toContain('authorization')
  })

  test('resolves to the vendored artifact', () => {
    expect(resolveVendoredSpec().pathname).toContain(
      'scripts/openapi/caucasus.json',
    )
  })

  // A swapped or truncated artifact must fail loudly rather than generate
  // plausible types against a document nobody reviewed.
  test('refuses a snapshot whose bytes do not match the manifest hash', () => {
    const directory = snapshotCopy({
      artifact: `${originalArtifact.toString('utf8')} `,
    })
    expect(() => resolveVendoredSpec(directory)).toThrow(/hash mismatch/)
  })

  test('refuses a snapshot declaring a different API version', () => {
    const document = JSON.parse(originalArtifact.toString('utf8'))
    document.info.version = '2026-04.blanc'
    const bytes = `${JSON.stringify(document, null, 2)}\n`
    const directory = snapshotCopy({
      artifact: bytes,
      manifest: JSON.stringify(
        {
          ...JSON.parse(originalManifest),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
        null,
        2,
      ),
    })
    expect(() => resolveVendoredSpec(directory)).toThrow(/version mismatch/)
  })
})

describe('spec source override', () => {
  test('takes a URL verbatim', () => {
    expect(
      resolveSpec('https://example.test/orchestrator/caucasus.json').href,
    ).toBe('https://example.test/orchestrator/caucasus.json')
  })

  // Only a caller-supplied override resolves against the working directory;
  // the default is module-relative so generation does not depend on where it
  // was run from.
  test('resolves a relative path against the working directory', () => {
    expect(resolveSpec('./local.json').pathname).toBe(
      `${process.cwd()}/local.json`,
    )
  })
})
