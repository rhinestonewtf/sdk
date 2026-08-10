export type Serialized<T> = T extends bigint
  ? string
  : T extends readonly (infer Item)[]
    ? Serialized<Item>[]
    : T extends string | number | boolean | null | undefined
      ? T
      : T extends object
        ? { [Key in keyof T]: Serialized<T[Key]> }
        : T

export function serializeBigInts<T>(value: T): Serialized<T> {
  if (typeof value === 'bigint') return value.toString() as Serialized<T>
  if (Array.isArray(value)) {
    return value.map(serializeBigInts) as Serialized<T>
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    ) as Serialized<T>
  }
  return value as Serialized<T>
}
