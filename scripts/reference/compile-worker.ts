// Type-checks the reference fixtures in its own process so the compiler graph
// runs under the parent's memory budget and is freed on exit.
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { compile, type SerializedDiagnostic } from './check-examples'

const [input, output] = process.argv.slice(2)
if (!input || !output)
  throw new Error('Usage: compile-worker.ts <input.json> <output.json>')
const { consumer, files } = JSON.parse(readFileSync(input, 'utf8')) as {
  consumer: string
  files: string[]
}
const diagnostics: SerializedDiagnostic[] = compile(files, consumer).map(
  (diagnostic) => ({
    file: diagnostic.file?.fileName,
    line: diagnostic.file
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
          .line + 1
      : 0,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }),
)
writeFileSync(
  output,
  JSON.stringify({
    diagnostics,
    // Linux reports maxRSS in KiB.
    maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  }),
)
