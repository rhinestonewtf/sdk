import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { aggregateRun } from '../../test/characterization/aggregate'
import {
  characterizationScenarios,
  isExecutableCharacterizationScenario,
} from '../../test/characterization/catalog'
import { parseCharacterizationEnvironment } from '../../test/characterization/selection'
import { serializeArtifact } from '../../test/characterization/serialization'

const SHARD_COUNT = 8
const environment = parseCharacterizationEnvironment('aggregate')
if (environment.command !== 'aggregate') {
  throw new Error('The aggregate script requires aggregate mode')
}
if (!environment.runId) {
  throw new Error('SDK_ITEST_RUN_ID is required for aggregation')
}
if (!environment.baseSha) {
  throw new Error('SDK_ITEST_BASE_SHA is required for aggregation')
}
const subjects = environment.subjects ?? (['legacy', 'public'] as const)
const result = await aggregateRun({
  resultsDir: environment.resultsDir,
  runId: environment.runId,
  baseSha: environment.baseSha,
  subjects,
  shardCount: SHARD_COUNT,
  catalog: characterizationScenarios.filter(
    isExecutableCharacterizationScenario,
  ),
})
const output = path.join(
  environment.resultsDir,
  environment.runId,
  'aggregate.json',
)
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, serializeArtifact(result), {
  encoding: 'utf8',
  flag: 'wx',
})
