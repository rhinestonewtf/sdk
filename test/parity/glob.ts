// JSON-pointer globs: `*` matches one segment (or part of one), `**` any
// number of segments, `(a|b)` alternates within a segment.

type Matcher = (segments: string[]) => boolean

const cache = new Map<string, Matcher>()

function segmentRegex(segment: string): RegExp {
  let source = ''
  for (const char of segment) {
    if (char === '*') source += '.*'
    else if (char === '(' || char === ')' || char === '|') source += char
    else source += char.replace(/[.+?^${}[\]\\]/g, '\\$&')
  }
  return new RegExp(`^(?:${source})$`)
}

function compileGlob(pattern: string): Matcher {
  const cached = cache.get(pattern)
  if (cached) return cached
  const parts = pattern.split('/').filter((part) => part !== '')
  const compiled = parts.map((part) =>
    part === '**' ? '**' : segmentRegex(part),
  )

  function match(i: number, segments: string[], j: number): boolean {
    if (i === compiled.length) return j === segments.length
    const part = compiled[i]
    if (part === '**') {
      for (let k = j; k <= segments.length; k++) {
        if (match(i + 1, segments, k)) return true
      }
      return false
    }
    return (
      j < segments.length &&
      part.test(segments[j]) &&
      match(i + 1, segments, j + 1)
    )
  }

  const matcher: Matcher = (segments) => match(0, segments, 0)
  cache.set(pattern, matcher)
  return matcher
}

function matchGlob(pattern: string, path: string | string[]): boolean {
  const segments = Array.isArray(path) ? path : fromPointer(path)
  return compileGlob(pattern)(segments)
}

function toPointer(segments: string[]): string {
  return `/${segments.map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`
}

function fromPointer(pointer: string): string[] {
  return pointer
    .split('/')
    .filter((part) => part !== '')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export { fromPointer, matchGlob, toPointer }
