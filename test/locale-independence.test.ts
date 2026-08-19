import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE_ROOT = fileURLToPath(new URL('../src', import.meta.url))
const LOCALE_SENSITIVE =
  /\.localeCompare\(|toLocaleLowerCase|toLocaleUpperCase|Intl\.Collator/

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'dist' ? [] : listSourceFiles(path)
    }
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('Locale Independence', () => {
  test('src never orders or cases by host locale', () => {
    const offenders = listSourceFiles(SOURCE_ROOT)
      .filter((path) => LOCALE_SENSITIVE.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SOURCE_ROOT.length + 1))
    expect(offenders).toEqual([])
  })
})
