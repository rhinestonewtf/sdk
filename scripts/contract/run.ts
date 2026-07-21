import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  createConsumerLayout,
  type PackageManifest,
  readJson,
  runCommand,
  sha256File,
  writeJson,
} from './shared.ts'

interface Calibration {
  packageName: string
}

interface PackedSubject {
  packageDirectory: string
  dependencyRoot: string
  digest: string
}

const repositoryRoot = resolve(import.meta.dir, '../..')
const calibrationPath = join(
  repositoryRoot,
  'test/contract/snapshots/release-package.json',
)
const runtimeProbePath = join(import.meta.dir, 'runtime-probe.mjs')
const consumerFixturePath = join(
  repositoryRoot,
  'test/contract/fixtures/consumer.ts',
)

function buildAndExtract(
  outputDirectory: string,
  expectedPackageName: string,
): PackedSubject {
  runCommand('bun', ['run', 'build'], { cwd: repositoryRoot })
  mkdirSync(outputDirectory, { recursive: true })
  const packOutput = runCommand(
    'npm',
    ['pack', '--json', '--pack-destination', outputDirectory],
    { cwd: join(repositoryRoot, 'src'), quiet: true },
  )
  const packResult = JSON.parse(packOutput) as { filename: string }[]
  const tarball = join(outputDirectory, packResult[0].filename)
  const extracted = join(outputDirectory, 'extracted')
  mkdirSync(extracted, { recursive: true })
  runCommand('tar', ['-xzf', tarball, '-C', extracted], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const packageDirectory = join(extracted, 'package')
  const manifest = readJson<PackageManifest>(
    join(packageDirectory, 'package.json'),
  )
  if (manifest.name !== expectedPackageName) {
    throw new Error(
      `Packed package name ${manifest.name} does not match the calibrated ${expectedPackageName}`,
    )
  }
  return {
    packageDirectory,
    dependencyRoot: join(repositoryRoot, 'node_modules'),
    digest: sha256File(tarball),
  }
}

function stageConsumerSet(
  subject: PackedSubject,
  temporaryDirectory: string,
): {
  full: string
  withoutOptionalPeers: string
  withoutExpress: string
} {
  const full = join(temporaryDirectory, 'consumer-full')
  const withoutOptionalPeers = join(temporaryDirectory, 'consumer-no-optional')
  const withoutExpress = join(temporaryDirectory, 'consumer-no-express')
  createConsumerLayout({
    packageDirectory: subject.packageDirectory,
    consumerDirectory: full,
    dependencyRoot: subject.dependencyRoot,
    runtimeProbePath,
    includeOptionalPeers: true,
  })
  createConsumerLayout({
    packageDirectory: subject.packageDirectory,
    consumerDirectory: withoutOptionalPeers,
    dependencyRoot: subject.dependencyRoot,
    runtimeProbePath,
    includeOptionalPeers: false,
  })
  createConsumerLayout({
    packageDirectory: subject.packageDirectory,
    consumerDirectory: withoutExpress,
    dependencyRoot: subject.dependencyRoot,
    runtimeProbePath,
    includeOptionalPeers: true,
  })
  rmSync(join(withoutExpress, 'node_modules', 'express'), {
    recursive: true,
    force: true,
  })
  return { full, withoutOptionalPeers, withoutExpress }
}

function compileConsumer(consumerDirectory: string): void {
  const fixtureName = basename(consumerFixturePath)
  cpSync(consumerFixturePath, join(consumerDirectory, fixtureName))
  writeJson(join(consumerDirectory, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: [fixtureName],
  })
  runCommand(
    join(repositoryRoot, 'node_modules/.bin/tsc'),
    ['--project', 'tsconfig.json'],
    { cwd: consumerDirectory },
  )
}

function validateMetadata(packageDirectory: string): void {
  runCommand('bunx', ['publint', packageDirectory], {
    cwd: repositoryRoot,
  })
}

async function main(): Promise<void> {
  const calibration = readJson<Calibration>(calibrationPath)
  const currentSha = runCommand('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const currentStatus = runCommand('git', ['status', '--porcelain=v1'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const currentDirty = currentStatus !== ''

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'rhinestone-sdk-contract-'),
  )
  let sizeStagingDirectory: string | undefined
  let result: Record<string, unknown> = {
    formatVersion: 2,
    currentSha,
    currentDirty,
    status: 'failed',
  }

  try {
    const current = buildAndExtract(
      join(temporaryDirectory, 'current-packed'),
      calibration.packageName,
    )
    result = { ...result, currentPackage: { digest: current.digest } }

    const consumers = stageConsumerSet(current, temporaryDirectory)
    const artifactsDirectory = join(repositoryRoot, '.artifacts')
    mkdirSync(artifactsDirectory, { recursive: true })
    sizeStagingDirectory = mkdtempSync(
      join(artifactsDirectory, 'contract-size-'),
    )
    const sizePackage = createConsumerLayout({
      packageDirectory: current.packageDirectory,
      consumerDirectory: join(sizeStagingDirectory, 'current'),
      dependencyRoot: current.dependencyRoot,
      runtimeProbePath,
      includeOptionalPeers: true,
    })

    compileConsumer(consumers.full)
    validateMetadata(current.packageDirectory)

    process.stdout.write('Checking current package sizes\n')
    runCommand('bun', ['run', 'size'], {
      cwd: repositoryRoot,
      env: {
        SDK_SIZE_PACKAGE_ROOT: join(sizePackage, 'dist/src'),
      },
    })
    runCommand(
      'bunx',
      ['vitest', '--config', 'vitest.config.contract.ts', '--run'],
      {
        cwd: repositoryRoot,
        env: {
          SDK_CONTRACT_CURRENT_PACKAGE_DIR: current.packageDirectory,
          SDK_CONTRACT_CURRENT_CONSUMER_DIR: consumers.full,
          SDK_CONTRACT_CURRENT_NO_OPTIONAL_DIR: consumers.withoutOptionalPeers,
          SDK_CONTRACT_CURRENT_NO_EXPRESS_DIR: consumers.withoutExpress,
        },
      },
    )

    result = { ...result, status: 'passed' }
  } finally {
    const resultDirectory = process.env.SDK_CONTRACT_RESULTS_DIR
    if (resultDirectory) {
      const output = resolve(resultDirectory, 'contract-result.json')
      writeJson(output, result)
      process.stdout.write(`Contract result: ${output}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    }

    if (sizeStagingDirectory) {
      rmSync(sizeStagingDirectory, { recursive: true, force: true })
    }
    if (process.env.SDK_CONTRACT_KEEP_TEMP === '1') {
      process.stdout.write(`Contract staging retained: ${temporaryDirectory}\n`)
    } else {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

await main()
