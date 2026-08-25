export function encodeErc7739ContentType(input: {
  readonly primaryType: string
  readonly types: Readonly<
    Record<string, readonly { readonly name: string; readonly type: string }[]>
  >
}): string {
  const { primaryType, types } = input
  const dependencies = new Set<string>()
  const collect = (type: string): void => {
    const typeName = type.match(/^\w*/)?.[0]
    if (!typeName || dependencies.has(typeName) || !types[typeName]) return
    dependencies.add(typeName)
    for (const field of types[typeName]) collect(field.type)
  }
  collect(primaryType)
  dependencies.delete(primaryType)
  return [primaryType, ...[...dependencies].sort()]
    .map(
      (type) =>
        `${type}(${types[type].map((field) => `${field.type} ${field.name}`).join(',')})`,
    )
    .join('')
}
