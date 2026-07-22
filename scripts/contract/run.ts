import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { generateApiReport } from './api-report.ts'
import {
  createConsumerLayout,
  type PackageManifest,
  readJson,
  runCommand,
  sha256File,
  writeJson,
} from './shared.ts'

interface PackedSubject {
  packageDirectory: string
  dependencyRoot: string
  digest: string
}

const repositoryRoot = resolve(import.meta.dir, '../..')
const runtimeProbePath = join(import.meta.dir, 'runtime-probe.mjs')
const consumerFixturePath = join(
  repositoryRoot,
  'test/contract/fixtures/consumer.ts',
)
const assignabilityFixturePath = join(
  repositoryRoot,
  'test/contract/fixtures/assignability.ts',
)

function resolveCommit(reference: string): string {
  return runCommand('git', ['rev-parse', `${reference}^{commit}`], {
    cwd: repositoryRoot,
    quiet: true,
  })
}

function packAndExtract(
  checkout: string,
  outputDirectory: string,
  expectedPackageName: string,
  dependencyRoot: string,
): PackedSubject {
  runCommand('bun', ['run', 'build'], { cwd: checkout })
  mkdirSync(outputDirectory, { recursive: true })
  const packOutput = runCommand(
    'npm',
    ['pack', '--json', '--pack-destination', outputDirectory],
    { cwd: join(checkout, 'src'), quiet: true },
  )
  const packResult = JSON.parse(packOutput) as { filename: string }[]
  const tarball = join(outputDirectory, packResult[0].filename)
  const extracted = join(outputDirectory, 'extracted')
  mkdirSync(extracted, { recursive: true })
  runCommand('tar', ['-xzf', tarball, '-C', extracted], {
    cwd: checkout,
    quiet: true,
  })
  const packageDirectory = join(extracted, 'package')
  const manifest = readJson<PackageManifest>(
    join(packageDirectory, 'package.json'),
  )
  if (manifest.name !== expectedPackageName) {
    throw new Error(
      `Packed package name ${manifest.name} does not match ${expectedPackageName}`,
    )
  }
  return {
    packageDirectory,
    dependencyRoot,
    digest: sha256File(tarball),
  }
}

function buildBaseSubject(options: {
  baseSha: string
  temporaryDirectory: string
  expectedPackageName: string
}): { subject: PackedSubject; worktree: string } {
  const worktree = join(options.temporaryDirectory, 'base-worktree')
  runCommand(
    'git',
    ['worktree', 'add', '--detach', worktree, options.baseSha],
    { cwd: repositoryRoot, quiet: true },
  )
  try {
    const checkedOutSha = runCommand('git', ['rev-parse', 'HEAD'], {
      cwd: worktree,
      quiet: true,
    })
    if (checkedOutSha !== options.baseSha) {
      throw new Error('Base worktree is not the requested release commit')
    }
    const installBaseDependencies =
      process.env.SDK_CONTRACT_INSTALL_BASE_DEPENDENCIES === '1'
    if (installBaseDependencies) {
      runCommand('bun', ['install', '--frozen-lockfile'], { cwd: worktree })
    } else {
      symlinkSync(
        join(repositoryRoot, 'node_modules'),
        join(worktree, 'node_modules'),
      )
    }
    const dependencyRoot = installBaseDependencies
      ? join(worktree, 'node_modules')
      : join(repositoryRoot, 'node_modules')
    return {
      worktree,
      subject: packAndExtract(
        worktree,
        join(options.temporaryDirectory, 'base-packed'),
        options.expectedPackageName,
        dependencyRoot,
      ),
    }
  } catch (error) {
    runCommand('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repositoryRoot,
      quiet: true,
    })
    throw error
  }
}

function stageConsumerSet(
  subject: PackedSubject,
  temporaryDirectory: string,
  name: string,
): {
  full: string
  withoutOptionalPeers: string
  withoutExpress: string
  packageDirectory: string
} {
  const full = join(temporaryDirectory, `${name}-consumer-full`)
  const withoutOptionalPeers = join(
    temporaryDirectory,
    `${name}-consumer-no-optional`,
  )
  const withoutExpress = join(temporaryDirectory, `${name}-consumer-no-express`)
  const packageDirectory = createConsumerLayout({
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
  return { full, withoutOptionalPeers, withoutExpress, packageDirectory }
}

function compileConsumer(
  consumerDirectory: string,
  fixturePath = consumerFixturePath,
): void {
  const fixtureName = basename(fixturePath)
  cpSync(fixturePath, join(consumerDirectory, fixtureName))
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
  runCommand('bunx', ['publint', packageDirectory], { cwd: repositoryRoot })
}

async function main(): Promise<void> {
  const sourceManifest = readJson<PackageManifest>(
    join(repositoryRoot, 'src/package.json'),
  )
  const baseReference =
    process.env.SDK_CONTRACT_BASE_SHA ??
    process.env.SDK_CONTRACT_BASE_REF ??
    'origin/release'
  const baseSha = resolveCommit(baseReference)
  const currentSha = resolveCommit('HEAD')
  const currentStatus = runCommand('git', ['status', '--porcelain=v1'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  if (baseSha === currentSha && currentStatus === '') {
    throw new Error(
      'The current subject is the clean base release; refusing to compare the same tree twice',
    )
  }

  runCommand('git', ['merge-base', '--is-ancestor', baseSha, currentSha], {
    cwd: repositoryRoot,
    quiet: true,
  })

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'rhinestone-sdk-contract-'),
  )
  let baseWorktree: string | undefined
  let sizeStagingDirectory: string | undefined
  let result: Record<string, unknown> = {
    formatVersion: 3,
    baseSha,
    currentSha,
    currentDirty: currentStatus !== '',
    status: 'failed',
  }

  try {
    const baseBuild = buildBaseSubject({
      baseSha,
      temporaryDirectory,
      expectedPackageName: sourceManifest.name,
    })
    baseWorktree = baseBuild.worktree
    const current = packAndExtract(
      repositoryRoot,
      join(temporaryDirectory, 'current-packed'),
      sourceManifest.name,
      join(repositoryRoot, 'node_modules'),
    )
    result = {
      ...result,
      basePackage: { digest: baseBuild.subject.digest },
      currentPackage: { digest: current.digest },
    }

    const baseConsumers = stageConsumerSet(
      baseBuild.subject,
      temporaryDirectory,
      'base',
    )
    const currentConsumers = stageConsumerSet(
      current,
      temporaryDirectory,
      'current',
    )
    const artifactsDirectory = join(repositoryRoot, '.artifacts')
    mkdirSync(artifactsDirectory, { recursive: true })
    sizeStagingDirectory = mkdtempSync(
      join(artifactsDirectory, 'contract-size-'),
    )
    const currentSizePackage = createConsumerLayout({
      packageDirectory: current.packageDirectory,
      consumerDirectory: join(sizeStagingDirectory, 'current'),
      dependencyRoot: current.dependencyRoot,
      runtimeProbePath,
      includeOptionalPeers: true,
    })
    const assignabilityConsumer = join(
      temporaryDirectory,
      'assignability-consumer',
    )
    createConsumerLayout({
      packageDirectory: current.packageDirectory,
      consumerDirectory: assignabilityConsumer,
      dependencyRoot: current.dependencyRoot,
      runtimeProbePath,
      includeOptionalPeers: true,
    })
    cpSync(
      baseBuild.subject.packageDirectory,
      join(assignabilityConsumer, 'node_modules/@rhinestone/sdk-base'),
      { recursive: true },
    )

    compileConsumer(baseConsumers.full)
    compileConsumer(currentConsumers.full)
    compileConsumer(assignabilityConsumer, assignabilityFixturePath)
    validateMetadata(baseBuild.subject.packageDirectory)
    validateMetadata(current.packageDirectory)

    const baseApiReportPath = join(temporaryDirectory, 'base-api-report.json')
    const currentApiReportPath = join(
      temporaryDirectory,
      'current-api-report.json',
    )
    writeJson(
      baseApiReportPath,
      generateApiReport(baseConsumers.packageDirectory),
    )
    writeJson(
      currentApiReportPath,
      generateApiReport(currentConsumers.packageDirectory),
    )

    runCommand(
      'bunx',
      ['vitest', '--config', 'vitest.config.contract.ts', '--run'],
      {
        cwd: repositoryRoot,
        env: {
          SDK_CONTRACT_BASE_SHA: baseSha,
          SDK_CONTRACT_BASE_PACKAGE_DIR: baseBuild.subject.packageDirectory,
          SDK_CONTRACT_CURRENT_PACKAGE_DIR: current.packageDirectory,
          SDK_CONTRACT_BASE_CONSUMER_DIR: baseConsumers.full,
          SDK_CONTRACT_CURRENT_CONSUMER_DIR: currentConsumers.full,
          SDK_CONTRACT_BASE_NO_OPTIONAL_DIR: baseConsumers.withoutOptionalPeers,
          SDK_CONTRACT_CURRENT_NO_OPTIONAL_DIR:
            currentConsumers.withoutOptionalPeers,
          SDK_CONTRACT_BASE_NO_EXPRESS_DIR: baseConsumers.withoutExpress,
          SDK_CONTRACT_CURRENT_NO_EXPRESS_DIR: currentConsumers.withoutExpress,
          SDK_CONTRACT_BASE_API_REPORT: baseApiReportPath,
          SDK_CONTRACT_CURRENT_API_REPORT: currentApiReportPath,
        },
      },
    )
    process.stdout.write('Checking current package sizes\n')
    runCommand('bun', ['run', 'size'], {
      cwd: repositoryRoot,
      env: { SDK_SIZE_PACKAGE_ROOT: join(currentSizePackage, 'dist/src') },
    })

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

    if (baseWorktree) {
      runCommand('git', ['worktree', 'remove', '--force', baseWorktree], {
        cwd: repositoryRoot,
        quiet: true,
      })
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
