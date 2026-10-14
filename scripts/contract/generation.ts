import type { PackageManifest } from './shared.ts'

export type PackageGeneration = 'v2' | 'v3'

export function detectPackageGeneration(
  manifest: Pick<PackageManifest, 'exports'>,
): PackageGeneration {
  const has = (entry: string) => Object.hasOwn(manifest.exports, entry)
  const utils = has('./utils')
  const evm = has('./evm')
  const solana = has('./solana')
  if (utils && !evm && !solana) return 'v2'
  if (!utils && evm && solana) return 'v3'
  throw new Error('Unknown or ambiguous SDK generation in package exports')
}

export function consumerFixtures(generation: PackageGeneration): string[] {
  return generation === 'v2'
    ? ['legacy-consumer.ts']
    : ['consumer.ts', 'current-consumer.ts']
}

export function assignabilityFixture(
  base: PackageGeneration,
  current: PackageGeneration,
): string {
  if (base !== current) {
    throw new Error(
      'Cross-generation compatibility requires a surface changeset',
    )
  }
  return base === 'v2' ? 'assignability-v2.ts' : 'assignability.ts'
}
