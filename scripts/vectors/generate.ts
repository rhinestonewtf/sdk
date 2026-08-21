// Regenerates the account deployment baseline from the checkout this script
// runs in. Copy `test/vectors/accounts/{matrix,derive}.ts`, `test/consts.ts` and
// this file into a worktree of another ref and point `SDK_VECTORS_OUT` at the
// main checkout to calibrate the baseline against that ref.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deriveVectorRecords } from '../../test/vectors/accounts/derive'

const outPath =
  process.env.SDK_VECTORS_OUT ??
  resolve(
    import.meta.dir,
    '../../test/vectors/accounts/account-deployment.json',
  )

interface BaselineCase {
  id: string
  address: string
  factory?: string
  factoryDataHash?: string
  deliberateChange?: unknown
}

interface Baseline {
  schemaVersion: number
  source: unknown
  cases: BaselineCase[]
}

const previous: Baseline | undefined = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf8'))
  : undefined

const records = await deriveVectorRecords()

const baseline: Baseline = {
  schemaVersion: 2,
  source: previous?.source ?? { kind: 'worktree' },
  cases: records.map((record) => {
    const carried = previous?.cases.find((entry) => entry.id === record.id)
    return {
      ...record,
      ...(carried?.deliberateChange
        ? { deliberateChange: carried.deliberateChange }
        : {}),
    }
  }),
}

writeFileSync(outPath, `${JSON.stringify(baseline, null, 2)}\n`)

const changed = records.filter((record) => {
  const carried = previous?.cases.find((entry) => entry.id === record.id)
  if (!carried) return false
  return (
    carried.address !== record.address ||
    carried.factory !== record.factory ||
    carried.factoryDataHash !== record.factoryDataHash
  )
})
const added = records
  .filter((record) => !previous?.cases.some((entry) => entry.id === record.id))
  .map((record) => record.id)
const removed = (previous?.cases ?? [])
  .filter((entry) => !records.some((record) => record.id === entry.id))
  .map((entry) => entry.id)

process.stdout.write(`Wrote ${records.length} cases to ${outPath}\n`)
if (added.length) process.stdout.write(`Added: ${added.join(', ')}\n`)
if (removed.length) process.stdout.write(`Removed: ${removed.join(', ')}\n`)
if (changed.length) {
  process.stdout.write(
    `Changed (needs a changeset and a deliberateChange note): ${changed
      .map((record) => record.id)
      .join(', ')}\n`,
  )
}
