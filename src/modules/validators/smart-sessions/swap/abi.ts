import type { Abi, AbiFunction, AbiParameter } from 'viem'

function isStaticAbiType(type: string): boolean {
  if (type === 'address' || type === 'bool') return true
  if (/^u?int\d*$/.test(type)) return true
  if (/^bytes\d+$/.test(type)) {
    const size = Number.parseInt(type.slice(5), 10)
    return size >= 1 && size <= 32
  }
  return false
}

const ARRAY_SUFFIX = /^(.*)\[(\d*)\]$/

function withType(param: AbiParameter, type: string): AbiParameter {
  return { ...param, type } as AbiParameter
}

function tupleComponents(param: AbiParameter): readonly AbiParameter[] {
  return (param as { components?: readonly AbiParameter[] }).components ?? []
}

function isDynamicAbiParam(param: AbiParameter): boolean {
  if (param.type === 'bytes' || param.type === 'string') return true
  const array = ARRAY_SUFFIX.exec(param.type)
  if (array) {
    const [, elementType, length] = array
    if (length === '') return true
    return isDynamicAbiParam(withType(param, elementType))
  }
  if (param.type === 'tuple') {
    return tupleComponents(param).some(isDynamicAbiParam)
  }
  return false
}

function headSize(param: AbiParameter): number {
  if (isDynamicAbiParam(param)) return 32
  const array = ARRAY_SUFFIX.exec(param.type)
  if (array) {
    const [, elementType, length] = array
    return Number.parseInt(length, 10) * headSize(withType(param, elementType))
  }
  if (param.type === 'tuple') {
    return tupleComponents(param).reduce((sum, item) => sum + headSize(item), 0)
  }
  return 32
}

function headOffset(inputs: readonly AbiParameter[], index: number): bigint {
  let offset = 0
  for (let i = 0; i < index; i++) offset += headSize(inputs[i])
  return BigInt(offset)
}

export function namedParamOffsets(
  abi: Abi,
  functionName: string,
): Record<string, bigint> {
  const entry = abi.find(
    (item): item is AbiFunction =>
      item.type === 'function' && item.name === functionName,
  )
  if (!entry) throw new Error(`Function "${functionName}" not found in ABI`)

  const offsets: Record<string, bigint> = {}
  entry.inputs.forEach((param, index) => {
    if (param.name && isStaticAbiType(param.type)) {
      offsets[param.name] = headOffset(entry.inputs, index)
    }
  })
  return offsets
}
