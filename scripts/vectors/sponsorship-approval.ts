// Regenerates the singular sponsorship approval vectors
// (test/vectors/sponsorship-approval-singular/vectors.json) from the checkout
// this script runs in. The provenance block is carried over from the existing
// file: update it when the orchestrator cross-check is re-run.
//
// The legacy vectors in test/vectors/sponsorship-approval are frozen and never
// regenerated; nothing here writes them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SPONSORSHIP_APPROVAL_CONTRACT } from '../../src/clients/orchestrator/sponsorship-approval'
import { computeIntentInputDigest } from '../../src/jwt-server/digest'
import { deriveVectors } from '../../test/vectors/sponsorship-approval-singular/derive'
import { refusedVectors } from '../../test/vectors/sponsorship-approval-singular/refused'

const outPath = resolve(
  import.meta.dir,
  '../../test/vectors/sponsorship-approval-singular/vectors.json',
)

const previous = existsSync(outPath)
  ? (JSON.parse(readFileSync(outPath, 'utf8')) as { provenance?: unknown })
  : undefined

const derived = await deriveVectors()
const cases = await Promise.all(
  derived.map(async ({ id, body, intentInput }) => ({
    id,
    body,
    intentInput,
    digest: await computeIntentInputDigest(intentInput),
  })),
)
const refused = refusedVectors(
  Object.fromEntries(derived.map(({ id, body }) => [id, body])),
).map(({ id, body, field }) => ({ id, body, field }))

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      contractVersion: SPONSORSHIP_APPROVAL_CONTRACT,
      digest: 'sha256(RFC 8785 JCS(intentInput)), lowercase hex',
      provenance: previous?.provenance ?? null,
      cases,
      refused,
    },
    null,
    2,
  )}\n`,
)

// Leave the file exactly as `bun run check` wants it, so a regeneration with no
// real change produces no diff.
Bun.spawnSync(['bunx', 'biome', 'format', '--write', outPath])
