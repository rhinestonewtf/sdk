import { createHash } from 'node:crypto'
import {
  type Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js'
import {
  Actions,
  fetchSwig,
  getSwigWalletAddress,
  Secp256k1Authority,
} from '@swig-wallet/classic'
import type { Address, PublicClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { RhinestoneSDKConfig } from '../../../../src/config/account'
import { RhinestoneSDK } from '../../../../src/index'
import { solanaAddress, solanaDevnet } from '../../../../src/solana/index'
import { type DeploymentEvidence, observeDeploymentFetch } from './evidence'
import {
  assertSolanaTestNetworks,
  pollSolana,
  SWIG_PROGRAM,
  waitForSolanaReceipt,
  waitForTerminalIntent,
} from './rpc'

export function deriveCompatibleSwig(
  evmAddress: Address,
  service: 'dev' | 'prod',
) {
  const id = createHash('sha256')
    .update(
      `rhinestone:swig:v1:${service === 'dev' ? 'dev-v1' : 'prod-v1'}:${evmAddress.toLowerCase()}`,
    )
    .digest()
  const [swig] = PublicKey.findProgramAddressSync(
    [Buffer.from('swig'), id],
    SWIG_PROGRAM,
  )
  const [wallet] = PublicKey.findProgramAddressSync(
    [Buffer.from('swig-wallet-address'), swig.toBuffer()],
    SWIG_PROGRAM,
  )
  return { swig, wallet, swigId: `0x${id.toString('hex')}` as const, id }
}

// The client captures its fetch port synchronously during construction. Restore
// the global immediately, before any asynchronous account setup or requests.
function observedSdk(
  config: RhinestoneSDKConfig,
  evidence: DeploymentEvidence[],
  fetcher: typeof fetch,
  onDeploymentEvidence?: (evidence: DeploymentEvidence) => void | Promise<void>,
) {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = observeDeploymentFetch(
      fetcher,
      evidence,
      onDeploymentEvidence,
    )
    return new RhinestoneSDK(config)
  } finally {
    globalThis.fetch = previous
  }
}
export async function createSolanaFixture({
  sdkConfig,
  connection,
  evmClient,
  fetcher = globalThis.fetch,
  onDeploymentEvidence,
}: {
  sdkConfig: RhinestoneSDKConfig
  connection: Connection
  evmClient: Pick<PublicClient, 'getChainId'>
  fetcher?: typeof fetch
  onDeploymentEvidence?: (evidence: DeploymentEvidence) => void | Promise<void>
}) {
  await assertSolanaTestNetworks(connection, evmClient)
  const service = sdkConfig.useDevContracts ? 'dev' : 'prod'
  const expectedEndpoint =
    service === 'dev'
      ? 'https://dev.v1.orchestrator.rhinestone.dev'
      : 'https://v1.orchestrator.rhinestone.dev'
  if (
    sdkConfig.endpointUrl &&
    sdkConfig.endpointUrl.replace(/\/$/, '') !== expectedEndpoint
  )
    throw new Error('Swig environment and endpoint mismatch')
  const deploymentEvidence: DeploymentEvidence[] = []
  const sdk = observedSdk(
    sdkConfig,
    deploymentEvidence,
    fetcher,
    onDeploymentEvidence,
  )
  const owner = privateKeyToAccount(generatePrivateKey())
  const evmConfig = {
    account: { type: 'safe' as const },
    owners: { type: 'ecdsa' as const, accounts: [owner] },
  }
  const evmAccount = await sdk.createAccount({ evm: evmConfig })
  const evmAddress = evmAccount.getAddress('evm')
  const derived = deriveCompatibleSwig(evmAddress, service)
  const account = await sdk.createAccount({
    evm: evmConfig,
    solana: {
      swig: solanaAddress(derived.swig.toBase58()),
      owner: { type: 'ecdsa', account: owner },
    },
  })
  if (
    account.getAddress('evm').toLowerCase() !== evmAddress.toLowerCase() ||
    account.getAddress('solana') !== derived.wallet.toBase58()
  )
    throw new Error('Composite wallet derivation mismatch')
  return {
    sdk,
    account,
    owner,
    recipient: Keypair.generate(),
    evmAddress,
    service,
    connection,
    evmClient,
    deploymentEvidence,
    ...derived,
  }
}
export type SolanaFixture = Awaited<ReturnType<typeof createSolanaFixture>>
const verifiedFixtures = new WeakSet<SolanaFixture>()
export function assertVerifiedSolanaFixture(fixture: SolanaFixture) {
  if (!verifiedFixtures.has(fixture))
    throw new Error('Funding refused: fixture authority/wallet not verified')
}
export async function verifySolanaFixtureAuthority(fixture: SolanaFixture) {
  await assertSolanaTestNetworks(fixture.connection, fixture.evmClient)
  const info = await fixture.connection.getAccountInfo(
    fixture.swig,
    'confirmed',
  )
  if (!info?.owner.equals(SWIG_PROGRAM))
    throw new Error('Swig program ownership mismatch')
  const swig = await fetchSwig(fixture.connection, fixture.swig, {
    commitment: 'confirmed',
  })
  const wallet = await getSwigWalletAddress(swig)
  if (
    !wallet.equals(fixture.wallet) ||
    !Buffer.from(swig.id).equals(fixture.id)
  )
    throw new Error('Onchain Swig identity/wallet mismatch')
  const walletInfo = await fixture.connection.getAccountInfo(
    wallet,
    'confirmed',
  )
  if (walletInfo && !walletInfo.owner.equals(SystemProgram.programId))
    throw new Error('Swig asset wallet ownership mismatch')
  const root = swig.findRoleById(0)
  const all = Actions.set().all().get()
  if (
    swig.roles.length !== 1 ||
    !root ||
    !(root.authority instanceof Secp256k1Authority) ||
    root.authority.secp256k1AddressString.toLowerCase().replace(/^0x/, '') !==
      fixture.owner.address.slice(2).toLowerCase() ||
    root.actions.count !== all.count ||
    !Buffer.from(root.actions.bytes()).equals(Buffer.from(all.bytes()))
  )
    throw new Error('Swig root identity/permissions mismatch')
  verifiedFixtures.add(fixture)
}
export async function deployAndVerifySolanaFixture(fixture: SolanaFixture) {
  await assertSolanaTestNetworks(fixture.connection, fixture.evmClient)
  if (await fixture.connection.getAccountInfo(fixture.swig, 'confirmed'))
    throw new Error('Fresh fixture state already exists')
  await fixture.account.deploy('solana', solanaDevnet)
  const submitted = fixture.deploymentEvidence.filter(
    (item) => item.submissions > 0,
  )
  if (submitted.length !== 1)
    throw new Error('Deployment must expose exactly one submitted intent')
  const evidence = submitted[0]
  if (evidence.submissions !== 1 || evidence.quotedAmounts.length === 0)
    throw new Error('Deployment submission/quoted rent evidence missing')
  const status = await waitForTerminalIntent(
    fixture.sdk,
    evidence.intentId,
    'deployment',
  )
  const references = status.operations.flatMap((group) =>
    group.items.flatMap((item) =>
      'transaction' in item && item.transaction?.vm === 'svm'
        ? [item.transaction]
        : [],
    ),
  )
  if (
    references.length === 0 ||
    references.some((ref) => ref.chainId !== solanaDevnet.caip2)
  )
    throw new Error('Deployment has no Devnet receipt')
  for (const ref of references)
    await waitForSolanaReceipt(fixture.connection, ref.signature)
  await pollSolana(
    () => fixture.connection.getAccountInfo(fixture.swig, 'confirmed'),
    (value) => value !== null,
  )
  await verifySolanaFixtureAuthority(fixture)
  const snapshot = JSON.stringify(fixture.deploymentEvidence)
  const submissions = fixture.deploymentEvidence.reduce(
    (sum, item) => sum + item.submissions,
    0,
  )
  await fixture.account.deploy('solana', solanaDevnet)
  if (
    JSON.stringify(fixture.deploymentEvidence) !== snapshot ||
    fixture.deploymentEvidence.reduce(
      (sum, item) => sum + item.submissions,
      0,
    ) !== submissions
  )
    throw new Error('Idempotent deployment submitted a second intent')
  return { evidence, status }
}
