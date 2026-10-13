import { spawn, spawnSync } from 'node:child_process'
import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function parseMemoryBudget(value: string | undefined): number {
  if (value === undefined || value === '') return 2048
  if (!/^[1-9]\d*$/.test(value))
    throw new Error(
      `SDK_REF_MAX_RSS_MIB must be a positive integer, got: ${value}`,
    )
  return Number(value)
}

export interface BoundedOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  label: string
  maxRssMiB: number
  sampleMs?: number
}

export interface BoundedResult {
  peakRssMiB: number
  durationMs: number
}

const activeGroups = new Set<number>()

function killGroup(pgid: number): void {
  try {
    process.kill(-pgid, 'SIGKILL')
  } catch {
    // Group already gone.
  }
}

export function killActiveGroups(): void {
  for (const pgid of activeGroups) killGroup(pgid)
  activeGroups.clear()
}

// Summed RSS of every process in the group, so grandchildren (e.g. tsc under
// `bun run`) count against the budget too.
function groupRssKiB(pgid: number): number {
  const result = spawnSync('ps', ['-A', '-o', 'pgid=,rss='], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return 0
  let total = 0
  for (const row of result.stdout.split('\n')) {
    const [group, rss] = row.trim().split(/\s+/).map(Number)
    if (group === pgid && Number.isFinite(rss)) total += rss
  }
  return total
}

function toMiB(kib: number): number {
  return Math.round(kib / 1024)
}

export function runBounded(
  command: string,
  args: string[],
  options: BoundedOptions,
): Promise<BoundedResult> {
  const started = Date.now()
  const budgetKiB = options.maxRssMiB * 1024
  return new Promise((resolvePromise, reject) => {
    // Detached: the child leads its own process group, so the whole tree can
    // be measured and killed together.
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    const pgid = child.pid
    let peakKiB = 0
    let failure: Error | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    if (pgid !== undefined) {
      activeGroups.add(pgid)
      timer = setInterval(() => {
        const rss = groupRssKiB(pgid)
        peakKiB = Math.max(peakKiB, rss)
        if (rss > budgetKiB && !failure) {
          failure = new Error(
            `${options.label} exceeded the ${options.maxRssMiB} MiB memory budget (peak ${toMiB(peakKiB)} MiB)`,
          )
          killGroup(pgid)
        }
      }, options.sampleMs ?? 250)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      if (pgid !== undefined) {
        // Reap any grandchildren the leader left behind.
        killGroup(pgid)
        activeGroups.delete(pgid)
      }
    }
    child.on('error', (error) => {
      stop()
      reject(error)
    })
    child.on('exit', stop)
    child.on('close', (code, signal) => {
      stop()
      if (failure) return reject(failure)
      if (code !== 0)
        return reject(
          new Error(
            `Command failed (${options.label}: ${command} ${args.join(' ')}) exit ${code ?? signal}`,
          ),
        )
      resolvePromise({
        peakRssMiB: toMiB(peakKiB),
        durationMs: Date.now() - started,
      })
    })
  })
}

export interface HostLockOptions {
  path?: string
  timeoutMs?: number
  pollMs?: number
  log?: (message: string) => void
}

interface LockOwner {
  pid: number
  cwd: string
  startedAt: string
}

const DEFAULT_LOCK_PATH = join(tmpdir(), 'rhinestone-sdk-test-reference.lock')

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function parseOwner(text: string | undefined): LockOwner | undefined {
  try {
    const owner = JSON.parse(text ?? '') as LockOwner
    return Number.isInteger(owner?.pid) && owner.pid > 0 ? owner : undefined
  } catch {
    return undefined
  }
}

// Write a complete temp file and hard-link it into place, so a contender never
// observes a half-written lock and mistakes it for garbage.
function tryCreate(path: string): boolean {
  const staged = `${path}.${process.pid}.tmp`
  writeFileSync(
    staged,
    JSON.stringify({
      pid: process.pid,
      cwd: process.cwd(),
      startedAt: new Date().toISOString(),
    }),
  )
  try {
    linkSync(staged, path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  } finally {
    unlinkQuietly(staged)
  }
}

function unlinkQuietly(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // Already removed.
  }
}

// One gate per host: concurrent compiler graphs are what exhausted the shared
// sandbox.
export async function acquireHostLock(
  options: HostLockOptions = {},
): Promise<() => void> {
  const path = options.path ?? DEFAULT_LOCK_PATH
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  const pollMs = options.pollMs ?? 2000
  const log = options.log ?? ((message: string) => console.info(message))
  const deadline = Date.now() + timeoutMs
  let waiting = false
  while (!tryCreate(path)) {
    const text = readText(path)
    const owner = parseOwner(text)
    if (!owner || !isAlive(owner.pid)) {
      // Only reclaim the exact stale lock we inspected, not a fresh one.
      if (readText(path) === text) unlinkQuietly(path)
      continue
    }
    if (Date.now() >= deadline)
      throw new Error(
        `incomplete: another test:reference run (pid ${owner.pid}, cwd ${owner.cwd}) still holds the lock`,
      )
    if (!waiting) {
      log(
        `Waiting for another test:reference run (pid ${owner.pid}, cwd ${owner.cwd}) to release ${path}`,
      )
      waiting = true
    }
    await new Promise((done) =>
      setTimeout(done, Math.min(pollMs, Math.max(deadline - Date.now(), 0))),
    )
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (parseOwner(readText(path))?.pid === process.pid) unlinkQuietly(path)
  }
}
