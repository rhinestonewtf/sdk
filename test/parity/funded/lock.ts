import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// One funded run at a time: two runs on the same fixtures would change each
// other's on-chain state mid-comparison. The lock is machine-wide, so it also
// covers other checkouts on this machine; it cannot see other machines.

function lockFile(env: Record<string, string | undefined> = process.env) {
  return env.PARITY_LOCK_FILE || join(tmpdir(), 'sdk-v1-parity-funded.lock')
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface LockHolder {
  pid: number
  startedAt: string
}

function readHolder(file: string): LockHolder | undefined {
  try {
    const holder = JSON.parse(readFileSync(file, 'utf8'))
    return typeof holder?.pid === 'number' ? holder : undefined
  } catch {
    return undefined
  }
}

// Returns a release function; throws when a live process holds the lock.
// A lock left by a dead process is replaced.
function acquireFundedLock(file = lockFile(), pid = process.pid): () => void {
  const content = JSON.stringify({ pid, startedAt: new Date().toISOString() })
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(file, content, { flag: 'wx' })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0)
        throw error
      const holder = readHolder(file)
      if (holder && holder.pid !== pid && isAlive(holder.pid)) {
        throw new Error(
          `Another funded parity run (pid ${holder.pid}, started ${holder.startedAt}) holds ${file}. Wait for it, or set PARITY_FUNDED=0 to run without funded scenarios.`,
        )
      }
      rmSync(file, { force: true })
    }
  }
  return () => {
    if (readHolder(file)?.pid === pid) rmSync(file, { force: true })
  }
}

export { acquireFundedLock, lockFile }
