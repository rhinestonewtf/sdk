import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { generateApiCompatibilityReport } from './api-compat'
import { generateApiReport } from './api-report'
import { writeJson } from './shared'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createPackage(
  root: string,
  name: string,
  declaration: string,
): string {
  const directory = join(root, name.endsWith('base') ? 'base' : 'current')
  writeJson(join(directory, 'package.json'), {
    name,
    version: '1.0.0',
    type: 'module',
    types: './index.d.ts',
    exports: {
      '.': { types: './index.d.ts', import: './index.js' },
    },
  })
  writeFileSync(join(directory, 'index.d.ts'), declaration)
  writeFileSync(join(directory, 'index.js'), '')
  return directory
}

export function compare(baseDeclaration: string, currentDeclaration: string) {
  const root = mkdtempSync(join(tmpdir(), 'api-compat-test-'))
  temporaryDirectories.push(root)
  const base = createPackage(root, '@rhinestone/sdk-base', baseDeclaration)
  const current = createPackage(root, '@rhinestone/sdk', currentDeclaration)
  const external = join(root, 'node_modules/external')
  writeJson(join(external, 'package.json'), {
    name: 'external',
    version: '1.0.0',
    type: 'module',
    types: './index.d.ts',
    exports: { '.': { types: './index.d.ts', import: './index.js' } },
  })
  writeFileSync(
    join(external, 'index.d.ts'),
    'export interface ExternalOptions { external?: string }',
  )
  writeFileSync(join(external, 'index.js'), '')
  const consumer = join(root, 'consumer')
  mkdirSync(join(consumer, 'node_modules/@rhinestone'), { recursive: true })
  cpSync(base, join(consumer, 'node_modules/@rhinestone/sdk-base'), {
    recursive: true,
  })
  cpSync(current, join(consumer, 'node_modules/@rhinestone/sdk'), {
    recursive: true,
  })
  cpSync(external, join(consumer, 'node_modules/external'), { recursive: true })
  writeJson(join(consumer, 'package.json'), { private: true, type: 'module' })

  return generateApiCompatibilityReport({
    consumerDirectory: consumer,
    baseReport: generateApiReport(base),
    currentReport: generateApiReport(current),
  })
}
