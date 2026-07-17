import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const entrypoint = resolve(import.meta.dir, '../src/api/compose.ts')
const result = await Bun.build({
  entrypoints: [entrypoint],
  format: 'esm',
  minify: true,
  splitting: false,
  target: 'browser',
  write: false,
})

if (!result.success) {
  for (const log of result.logs) process.stderr.write(`${log}\n`)
  process.exit(1)
}

let rawBytes = 0
let gzipBytes = 0
const outputs: { readonly path: string; readonly rawBytes: number }[] = []
for (const output of result.outputs) {
  const bytes = new Uint8Array(await output.arrayBuffer())
  rawBytes += bytes.byteLength
  gzipBytes += gzipSync(bytes).byteLength
  outputs.push({ path: output.path, rawBytes: bytes.byteLength })
}

process.stdout.write(
  `${JSON.stringify(
    {
      kind: 'provisional-rewrite-import-graph',
      entrypoint: 'src/api/compose.ts',
      target: 'browser',
      minified: true,
      rawBytes,
      gzipBytes,
      outputs,
      note: 'This measures the internal rewrite composition, not the published package.',
    },
    null,
    2,
  )}\n`,
)
