// Regenerates the sponsorship approval vectors from the checkout this script
// runs in. The calibration provenance is carried over from the existing file:
// re-run the calibration (docs/sponsorship-approval.md) before changing it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeIntentInputDigest } from '../../src/jwt-server/digest'
import { deriveVectors } from '../../test/vectors/sponsorship-approval/derive'
import { refusedVectors } from '../../test/vectors/sponsorship-approval/refused'

const outPath = resolve(
  import.meta.dir,
  '../../test/vectors/sponsorship-approval/vectors.json',
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
).map(({ id, body, field }) => ({ id, body, reason: 'unsupported', field }))

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
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
