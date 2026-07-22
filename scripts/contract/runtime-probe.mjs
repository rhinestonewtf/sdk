import { readFile } from 'node:fs/promises'

const mode = process.argv[2]
const manifest = JSON.parse(
  await readFile(
    new URL('./node_modules/@rhinestone/sdk/package.json', import.meta.url),
  ),
)

const packageSpecifier = (entrypoint) =>
  entrypoint === '.' ? manifest.name : `${manifest.name}${entrypoint.slice(1)}`

if (mode === 'exports') {
  const exports = {}
  for (const entrypoint of Object.keys(manifest.exports)) {
    const module = await import(packageSpecifier(entrypoint))
    exports[entrypoint] = Object.keys(module).sort()
  }
  process.stdout.write(JSON.stringify(exports))
} else if (mode === 'root') {
  const module = await import(manifest.name)
  process.stdout.write(JSON.stringify(Object.keys(module).sort()))
} else if (mode === 'jwt-server') {
  try {
    const module = await import(`${manifest.name}/jwt-server`)
    process.stdout.write(
      JSON.stringify({ ok: true, exports: Object.keys(module).sort() }),
    )
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code: error?.code,
        name: error?.name,
        message: error?.message,
      }),
    )
  }
} else if (mode === 'error-identity') {
  const [{ OwnersFieldRequiredError }, { experimental_getRhinestoneInitData }] =
    await Promise.all([
      import(`${manifest.name}/errors`),
      import(`${manifest.name}/utils`),
    ])

  try {
    experimental_getRhinestoneInitData({ account: { type: 'safe' } })
    process.stdout.write(JSON.stringify({ threw: false }))
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        threw: true,
        strictConstructorIdentity:
          error.constructor === OwnersFieldRequiredError,
        instanceOfPublicConstructor: error instanceof OwnersFieldRequiredError,
        name: error.name,
        message: error.message,
      }),
    )
  }
} else if (mode === 'compatibility-values') {
  const { privateKeyToAccount } = await import('viem/accounts')
  const { experimental_getModuleSetup, experimental_getRhinestoneInitData } =
    await import(`${manifest.name}/utils`)
  const address = '0x0000000000000000000000000000000000000001'
  const addressOnlyInitData = experimental_getRhinestoneInitData({
    account: { type: 'safe' },
    initData: { address },
  })
  const setup = experimental_getModuleSetup({
    account: { type: 'safe' },
    owners: {
      type: 'ecdsa',
      accounts: [privateKeyToAccount(`0x${'11'.repeat(32)}`)],
    },
  })
  process.stdout.write(
    JSON.stringify({
      addressOnlyInitData,
      moduleKeys: Object.keys(setup.validators[0]).sort(),
    }),
  )
} else {
  throw new Error(`Unknown runtime probe mode: ${mode}`)
}
