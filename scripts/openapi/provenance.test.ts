import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { resolveSpec, resolveVendoredSpec } from '../generate-wire-types'

const MANIFEST = fileURLToPath(new URL('./provenance.json', import.meta.url))
const ARTIFACT = fileURLToPath(new URL('./caucasus.json', import.meta.url))

const originalManifest = readFileSync(MANIFEST, 'utf8')
const originalArtifact = readFileSync(ARTIFACT)

afterEach(() => {
  writeFileSync(MANIFEST, originalManifest)
  writeFileSync(ARTIFACT, originalArtifact)
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

  test('resolves to the vendored artifact', () => {
    expect(resolveVendoredSpec().pathname).toContain(
      'scripts/openapi/caucasus.json',
    )
  })

  // A swapped or truncated artifact must fail loudly rather than generate
  // plausible types against a document nobody reviewed.
  test('refuses a snapshot whose bytes do not match the manifest hash', () => {
    writeFileSync(ARTIFACT, `${originalArtifact.toString('utf8')} `)
    expect(() => resolveVendoredSpec()).toThrow(/hash mismatch/)
  })

  test('refuses a snapshot declaring a different API version', () => {
    const document = JSON.parse(originalArtifact.toString('utf8'))
    document.info.version = '2026-04.blanc'
    const bytes = `${JSON.stringify(document, null, 2)}\n`
    writeFileSync(ARTIFACT, bytes)
    writeFileSync(
      MANIFEST,
      JSON.stringify(
        {
          ...JSON.parse(originalManifest),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
        null,
        2,
      ),
    )
    expect(() => resolveVendoredSpec()).toThrow(/version mismatch/)
  })
})

describe('spec source override', () => {
  test('takes a URL verbatim', () => {
    expect(resolveSpec('https://example.test/orchestrator/caucasus.json').href).toBe(
      'https://example.test/orchestrator/caucasus.json',
    )
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
