import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packageJsonPath = resolve(import.meta.dir, '../src/package.json')
const constsPath = resolve(import.meta.dir, '../src/orchestrator/consts.ts')

const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const consts = readFileSync(constsPath, 'utf8')

const updated = consts.replace(
  /const SDK_VERSION = '.*'/,
  `const SDK_VERSION = '${version}'`,
)

if (consts !== updated) {
  writeFileSync(constsPath, updated)
}
