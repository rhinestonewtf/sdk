import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { generateApiReport } from './api-report.ts'
import {
  type ContractProvenance,
  createConsumerLayout,
  type PackageManifest,
  readJson,
  runCommand,
  sha256File,
  writeJson,
} from './shared.ts'

interface Calibration {
  baseSha: string
  packageName: string
  packageVersion: string
}

interface PackedSubject {
  tarball: string
  packageDirectory: string
  dependencyRoot: string
  provenance: ContractProvenance
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
const assignabilityFixturePath = join(
  repositoryRoot,
  'test/contract/fixtures/assignability.ts',
)

function validateFullSha(value: string | undefined, variable: string): string {
  if (!value || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${variable} must be a full 40-character lowercase Git SHA`)
  }
  return value
}

function resolveCommit(sha: string): string {
  runCommand('git', ['cat-file', '-e', `${sha}^{commit}`], {
    cwd: repositoryRoot,
    quiet: true,
  })
  return runCommand('git', ['rev-parse', `${sha}^{commit}`], {
    cwd: repositoryRoot,
    quiet: true,
  })
}

function currentTreeDigest(): string {
  const status = runCommand('git', ['status', '--porcelain=v1', '-z'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const diff = runCommand('git', ['diff', '--binary', 'HEAD'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const untracked = runCommand(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: repositoryRoot, quiet: true },
  )
    .split('\0')
    .filter(Boolean)
    .sort()
  const digest = createHash('sha256').update(status).update('\0').update(diff)
  for (const path of untracked) {
    digest.update('\0').update(path).update('\0')
    digest.update(readFileSync(resolve(repositoryRoot, path)))
  }
  return digest.digest('hex')
}

function packPackage(
  checkout: string,
  outputDirectory: string,
  provenance: ContractProvenance,
): string {
  mkdirSync(outputDirectory, { recursive: true })
  const packOutput = runCommand(
    'npm',
    ['pack', '--json', '--pack-destination', outputDirectory],
    { cwd: join(checkout, 'src'), quiet: true },
  )
  const packResult = JSON.parse(packOutput) as { filename: string }[]
  const tarball = join(outputDirectory, packResult[0].filename)
  const stampDirectory = join(outputDirectory, 'stamp')
  mkdirSync(stampDirectory)
  runCommand('tar', ['-xzf', tarball, '-C', stampDirectory], {
    cwd: checkout,
    quiet: true,
  })
  writeJson(
    join(stampDirectory, 'package', '.sdk-contract-provenance.json'),
    provenance,
  )
  rmSync(tarball)
  runCommand('tar', ['-czf', tarball, '-C', stampDirectory, 'package'], {
    cwd: checkout,
    quiet: true,
  })
  rmSync(stampDirectory, { recursive: true, force: true })
  writeFileSync(
    `${tarball}.sha256`,
    `${sha256File(tarball)}  ${basename(tarball)}\n`,
  )
  return tarball
}

function verifyCachedDigest(tarball: string): void {
  const digestPath = `${tarball}.sha256`
  if (!existsSync(digestPath)) {
    throw new Error(
      `SDK_CONTRACT_BASE_PACKAGE requires a matching digest sidecar: ${digestPath}`,
    )
  }
  const expectedDigest = readFileSync(digestPath, 'utf8').trim().split(/\s+/)[0]
  const actualDigest = sha256File(tarball)
  if (
    !/^[0-9a-f]{64}$/.test(expectedDigest) ||
    expectedDigest !== actualDigest
  ) {
    throw new Error(`Cached base package digest does not match: ${tarball}`)
  }
}

function extractAndVerifyPackage(options: {
  tarball: string
  outputDirectory: string
  expectedSha: string
  expectedPackageName: string
  requireClean: boolean
  dependencyRoot: string
}): PackedSubject {
  mkdirSync(options.outputDirectory, { recursive: true })
  runCommand('tar', ['-xzf', options.tarball, '-C', options.outputDirectory], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const packageDirectory = join(options.outputDirectory, 'package')
  const provenancePath = join(packageDirectory, '.sdk-contract-provenance.json')
  if (!existsSync(provenancePath)) {
    throw new Error(
      `Contract tarball has no embedded provenance: ${options.tarball}`,
    )
  }
  const provenance = readJson<ContractProvenance>(provenancePath)
  const manifest = readJson<PackageManifest>(
    join(packageDirectory, 'package.json'),
  )
  if (
    provenance.formatVersion !== 1 ||
    provenance.sourceSha !== options.expectedSha ||
    provenance.packageName !== options.expectedPackageName ||
    provenance.packageName !== manifest.name ||
    provenance.packageVersion !== manifest.version ||
    (options.requireClean && provenance.sourceDirty)
  ) {
    throw new Error(
      `Contract tarball provenance does not match its requested subject: ${options.tarball}`,
    )
  }

  return {
    tarball: options.tarball,
    packageDirectory,
    dependencyRoot: options.dependencyRoot,
    provenance,
    digest: sha256File(options.tarball),
  }
}

function buildBaseSubject(options: {
  baseSha: string
  temporaryDirectory: string
  expectedPackageName: string
}): { subject: PackedSubject; worktree?: string } {
  const suppliedPackage = process.env.SDK_CONTRACT_BASE_PACKAGE
  if (suppliedPackage) {
    const tarball = resolve(suppliedPackage)
    if (!existsSync(tarball)) {
      throw new Error(`SDK_CONTRACT_BASE_PACKAGE does not exist: ${tarball}`)
    }
    verifyCachedDigest(tarball)
    return {
      subject: extractAndVerifyPackage({
        tarball,
        outputDirectory: join(options.temporaryDirectory, 'base-extracted'),
        expectedSha: options.baseSha,
        expectedPackageName: options.expectedPackageName,
        requireClean: true,
        dependencyRoot: join(repositoryRoot, 'node_modules'),
      }),
    }
  }

  const worktree = join(options.temporaryDirectory, 'base-worktree')
  runCommand(
    'git',
    ['worktree', 'add', '--detach', worktree, options.baseSha],
    {
      cwd: repositoryRoot,
      quiet: true,
    },
  )
  try {
    const checkedOutSha = runCommand('git', ['rev-parse', 'HEAD'], {
      cwd: worktree,
      quiet: true,
    })
    const initialStatus = runCommand('git', ['status', '--porcelain=v1'], {
      cwd: worktree,
      quiet: true,
    })
    if (checkedOutSha !== options.baseSha || initialStatus !== '') {
      throw new Error('Base worktree is not the requested clean release commit')
    }

    runCommand('bun', ['install', '--frozen-lockfile'], { cwd: worktree })
    runCommand('bun', ['run', 'build'], { cwd: worktree })
    const manifest = readJson<PackageManifest>(
      join(worktree, 'src/package.json'),
    )
    const provenance: ContractProvenance = {
      formatVersion: 1,
      sourceSha: options.baseSha,
      sourceDirty: false,
      packageName: manifest.name,
      packageVersion: manifest.version,
    }
    const tarball = packPackage(
      worktree,
      join(options.temporaryDirectory, 'base-packed'),
      provenance,
    )
    return {
      worktree,
      subject: extractAndVerifyPackage({
        tarball,
        outputDirectory: join(options.temporaryDirectory, 'base-extracted'),
        expectedSha: options.baseSha,
        expectedPackageName: options.expectedPackageName,
        requireClean: true,
        dependencyRoot: join(worktree, 'node_modules'),
      }),
    }
  } catch (error) {
    runCommand('git', ['worktree', 'remove', '--force', worktree], {
      cwd: repositoryRoot,
      quiet: true,
    })
    throw error
  }
}

function buildCurrentSubject(options: {
  currentSha: string
  currentDirty: boolean
  temporaryDirectory: string
  expectedPackageName: string
}): PackedSubject {
  runCommand('bun', ['run', 'build'], { cwd: repositoryRoot })
  const manifest = readJson<PackageManifest>(
    join(repositoryRoot, 'src/package.json'),
  )
  const provenance: ContractProvenance = {
    formatVersion: 1,
    sourceSha: options.currentSha,
    sourceDirty: options.currentDirty,
    packageName: manifest.name,
    packageVersion: manifest.version,
  }
  const tarball = packPackage(
    repositoryRoot,
    join(options.temporaryDirectory, 'current-packed'),
    provenance,
  )
  return extractAndVerifyPackage({
    tarball,
    outputDirectory: join(options.temporaryDirectory, 'current-extracted'),
    expectedSha: options.currentSha,
    expectedPackageName: options.expectedPackageName,
    requireClean: false,
    dependencyRoot: join(repositoryRoot, 'node_modules'),
  })
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
  runCommand('bunx', ['publint', packageDirectory], {
    cwd: repositoryRoot,
  })
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

async function main(): Promise<void> {
  const calibration = readJson<Calibration>(calibrationPath)
  const baseSha = validateFullSha(
    process.env.SDK_CONTRACT_BASE_SHA,
    'SDK_CONTRACT_BASE_SHA',
  )
  if (baseSha !== calibration.baseSha) {
    throw new Error(
      `SDK_CONTRACT_BASE_SHA must match the calibrated release SHA ${calibration.baseSha}`,
    )
  }
  if (resolveCommit(baseSha) !== baseSha) {
    throw new Error('SDK_CONTRACT_BASE_SHA does not resolve to itself')
  }

  const currentSha = runCommand('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const currentStatus = runCommand('git', ['status', '--porcelain=v1'], {
    cwd: repositoryRoot,
    quiet: true,
  })
  const currentDirty = currentStatus !== ''
  if (currentSha === baseSha && !currentDirty) {
    throw new Error(
      'The current subject is the clean base release; refusing to compare the same tree twice',
    )
  }

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'rhinestone-sdk-contract-'),
  )
  let baseWorktree: string | undefined
  let result: Record<string, unknown> = {
    formatVersion: 1,
    baseSha,
    currentSha,
    currentDirty,
    currentTreeDigest: currentTreeDigest(),
    status: 'failed',
  }

  try {
    const baseBuild = buildBaseSubject({
      baseSha,
      temporaryDirectory,
      expectedPackageName: calibration.packageName,
    })
    baseWorktree = baseBuild.worktree
    const current = buildCurrentSubject({
      currentSha,
      currentDirty,
      temporaryDirectory,
      expectedPackageName: calibration.packageName,
    })

    if (
      baseBuild.subject.tarball === current.tarball ||
      baseBuild.subject.packageDirectory === current.packageDirectory
    ) {
      throw new Error('Base and current contract subjects share a staging path')
    }

    result = {
      ...result,
      basePackage: {
        digest: baseBuild.subject.digest,
        provenance: baseBuild.subject.provenance,
      },
      currentPackage: {
        digest: current.digest,
        provenance: current.provenance,
      },
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

    runCommand('bun', ['run', 'size'], { cwd: repositoryRoot })
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
    if (process.env.SDK_CONTRACT_KEEP_TEMP === '1') {
      process.stdout.write(`Contract staging retained: ${temporaryDirectory}\n`)
    } else {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

await main()
