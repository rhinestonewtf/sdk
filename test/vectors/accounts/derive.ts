import { type Address, type Hex, keccak256 } from 'viem'
import { type RhinestoneAccountConfig, RhinestoneSDK } from '../../../src/index'
import { experimental_getV0InitData } from '../../../src/utils/index'
import { type VectorCase, vectorCaseById, vectorCases } from './matrix'

export interface VectorRecord {
  readonly id: string
  readonly address: Address
  readonly factory?: Address
  readonly factoryDataHash?: Hex
}

interface DerivedPlan {
  readonly address: Address
  readonly factory?: Address
  readonly factoryData?: Hex
}

const sdk = new RhinestoneSDK({ apiKey: 'vector-only' })

async function resolveConfig(
  vectorCase: VectorCase,
): Promise<RhinestoneAccountConfig> {
  if (!vectorCase.pinnedFrom) return vectorCase.config
  const base = await derivePlan(vectorCaseById(vectorCase.pinnedFrom))
  if (!base.factory || !base.factoryData) {
    throw new Error(
      `Vector case ${vectorCase.pinnedFrom} has no factory args to pin`,
    )
  }
  return {
    ...vectorCase.config,
    initData: {
      address: base.address,
      factory: base.factory,
      factoryData: base.factoryData,
      intentExecutorInstalled: true,
    },
  }
}

async function derivePlan(vectorCase: VectorCase): Promise<DerivedPlan> {
  const config = await resolveConfig(vectorCase)
  if (vectorCase.profile === 'v0') {
    const initData = experimental_getV0InitData(config)
    return {
      address: initData.address,
      factory: initData.factory,
      factoryData: initData.factoryData,
    }
  }
  const account = await sdk.createAccount(config)
  const address = account.getAddress()
  if (vectorCase.pins === 'address') return { address }
  const initData = account.getInitData()
  return {
    address,
    factory: initData.factory,
    factoryData: initData.factoryData,
  }
}

export async function deriveVectorRecord(
  vectorCase: VectorCase,
): Promise<VectorRecord> {
  const plan = await derivePlan(vectorCase)
  if (vectorCase.pins === 'address') {
    return { id: vectorCase.id, address: plan.address }
  }
  if (!plan.factory || !plan.factoryData) {
    throw new Error(`Vector case ${vectorCase.id} derived no factory args`)
  }
  return {
    id: vectorCase.id,
    address: plan.address,
    factory: plan.factory,
    factoryDataHash: keccak256(plan.factoryData),
  }
}

export async function deriveVectorRecords(
  cases: readonly VectorCase[] = vectorCases,
): Promise<VectorRecord[]> {
  const records: VectorRecord[] = []
  for (const vectorCase of cases) {
    records.push(await deriveVectorRecord(vectorCase))
  }
  return records
}
