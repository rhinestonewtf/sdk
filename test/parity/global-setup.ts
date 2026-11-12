import type { TestProject } from 'vitest/node'
import { createRunDir } from './report'

declare module 'vitest' {
  export interface ProvidedContext {
    parityRunDir: string
  }
}

export default function setup(project: TestProject) {
  const dir = createRunDir(process.env.PARITY_REPORT_DIR || '.parity/reports')
  project.provide('parityRunDir', dir)
  return () => {
    console.info(`Parity reports: ${dir}`)
  }
}
