import ts from 'typescript'

// `types: []` opts out of ambient `@types/*` auto-inclusion: without it every
// program picks up every type package reachable from the working directory
// (~120 extra declaration files), so reports would also depend on what the host
// repository happens to have installed.
const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
}

// Standard library files carry no module imports and every program here uses
// the options above, so their parsed form is shared for the process lifetime.
// Keyed by file name only — valid while `compilerOptions` is the sole option set.
const standardLibrary = new Map<string, ts.SourceFile | undefined>()

export function createContractProgram(rootNames: string[]): ts.Program {
  const host = ts.createCompilerHost(compilerOptions)
  const defaultLibraryDirectory = host.getDefaultLibLocation?.()
  const readSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const cacheable =
      defaultLibraryDirectory !== undefined &&
      fileName.startsWith(defaultLibraryDirectory)
    if (cacheable && standardLibrary.has(fileName)) {
      return standardLibrary.get(fileName)
    }
    const sourceFile = readSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreate,
    )
    if (cacheable) {
      standardLibrary.set(fileName, sourceFile)
    }
    return sourceFile
  }

  const program = ts.createProgram(rootNames, compilerOptions, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    )
  }
  return program
}
