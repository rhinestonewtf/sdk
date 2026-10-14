import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const declaration = /^const SDK_VERSION = '[^'\r\n]*'$/gm
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function syncVersion(packageJsonPath: string, clientPath: string): void {
  const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const match = typeof version === 'string' ? semver.exec(version) : null
  if (!match || match[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
    throw new Error('Package version must be valid semver')
  }
  const client = readFileSync(clientPath, 'utf8')
  if ([...client.matchAll(declaration)].length !== 1) {
    throw new Error('Expected exactly one SDK_VERSION declaration')
  }
  const updated = client.replace(
    declaration,
    `const SDK_VERSION = '${version}'`,
  )
  if (client !== updated) writeFileSync(clientPath, updated)
}

if (import.meta.main) {
  syncVersion(
    resolve(import.meta.dir, '../src/package.json'),
    resolve(import.meta.dir, '../src/clients/orchestrator/client.ts'),
  )
}
