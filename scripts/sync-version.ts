import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJsonPath = resolve(import.meta.dir, '../src/package.json')
const clientPath = resolve(
  import.meta.dir,
  '../src/clients/orchestrator/client.ts',
)

const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const client = readFileSync(clientPath, 'utf8')

const updated = client.replace(
  /const SDK_VERSION = '.*'/,
  `const SDK_VERSION = '${version}'`,
)

if (client !== updated) {
  writeFileSync(clientPath, updated)
}
