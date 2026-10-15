// Generates ERC-7739 differential vectors with viem, an implementation independent of the emissary.
// Usage: node scripts/erc7739-encodedata-vectors.mjs <out.json>
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const VIEM = `${dirname(createRequire(import.meta.url).resolve('viem/package.json'))}/_esm`
const viem = await import(`${VIEM}/index.js`)
const { encodeType } = await import(`${VIEM}/utils/signature/hashTypedData.js`)
const { sign, privateKeyToAccount } = await import(`${VIEM}/accounts/index.js`)
const {
  hashTypedData,
  hashStruct,
  hashDomain,
  keccak256,
  toHex,
  concat,
  encodeAbiParameters,
  serializeSignature,
} = viem

const out = process.argv[2]
if (!out) throw new Error('usage: node scripts/erc7739-encodedata-vectors.mjs <out.json>')

// The account the Solidity test validates against: its `eip712Domain()` as the test reads it.
const ACCOUNT_DOMAIN = {
  name: 'uMSA advanced/withHook',
  version: 'v0.1',
  chainId: 31337n,
  verifyingContract: '0x0d1586c4ea176d9dadB2ca48D025dC4A14291794',
  salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
}
const PRIVATE_KEY = '0x00000000000000000000000000000000000000000000000000000000007739a1'
const signer = privateKeyToAccount(PRIVATE_KEY).address

const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const TYPEHASH_JIT_PERMIT2 = '0x1b355fbc76f14a5aefe5c85df793a0f876f90d66f457273501c13ac311b5f3f8'
const TYPEHASH_COMPACT = '0x558f66062aaa99f9b8229dfe1621b6efcee0513dbc552aa5ffac622f4823dbfc'

const domainFieldTypes = {
  name: 'string',
  version: 'string',
  chainId: 'uint256',
  verifyingContract: 'address',
  salt: 'bytes32',
}
const domainTypes = (domain) =>
  Object.keys(domainFieldTypes)
    .filter((k) => domain[k] !== undefined)
    .map((k) => ({ name: k, type: domainFieldTypes[k] }))

const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`)
}

// `encodeData` of a struct, written here from the EIP-712 rules and checked against viem's
// `hashStruct`, since viem does not export it.
function encodeField(types, type, value) {
  if (types[type] !== undefined) return ['bytes32', hashStruct({ data: value, primaryType: type, types })]
  if (type === 'bytes') return ['bytes32', keccak256(value)]
  if (type === 'string') return ['bytes32', keccak256(toHex(value))]
  if (type.endsWith(']')) {
    const inner = type.slice(0, type.lastIndexOf('['))
    const parts = value.map((v) => encodeField(types, inner, v))
    return [
      'bytes32',
      keccak256(encodeAbiParameters(parts.map(([t]) => ({ type: t })), parts.map(([, v]) => v))),
    ]
  }
  return [type, value]
}

function encodeData(types, primaryType, data) {
  const parts = types[primaryType].map((f) => encodeField(types, f.type, data[f.name]))
  if (parts.length === 0) return '0x'
  return encodeAbiParameters(parts.map(([t]) => ({ type: t })), parts.map(([, v]) => v))
}

const TDS_FIELDS = [
  { name: 'contents', type: null },
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
]

// The ERC-7739 digest as a wallet computes it: viem's EIP-712 hash of `TypedDataSign`, whose
// `encodeType` sorts the contents types among its dependencies.
function standardDigest(appDomain, types, primaryType, message) {
  return hashTypedData({
    domain: appDomain,
    types: {
      ...types,
      TypedDataSign: TDS_FIELDS.map((f) => ({ name: f.name, type: f.type ?? primaryType })),
    },
    primaryType: 'TypedDataSign',
    message: { contents: message, ...ACCOUNT_DOMAIN },
  })
}

// The ERC-7739 typehash formula: `TypedDataSign(` name ` contents,...)` followed by `contentsType`
// as given, primary type first.
function primaryFirstDigest(appDomainSeparator, contentsType, primaryType, contents) {
  const typehash = keccak256(
    toHex(
      `TypedDataSign(${primaryType} contents,string name,string version,uint256 chainId,` +
        `address verifyingContract,bytes32 salt)${contentsType}`,
    ),
  )
  const typedDataSign = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes32' },
      ],
      [
        typehash,
        contents,
        keccak256(toHex(ACCOUNT_DOMAIN.name)),
        keccak256(toHex(ACCOUNT_DOMAIN.version)),
        ACCOUNT_DOMAIN.chainId,
        ACCOUNT_DOMAIN.verifyingContract,
        ACCOUNT_DOMAIN.salt,
      ],
    ),
  )
  return { typehash, digest: keccak256(concat(['0x1901', appDomainSeparator, typedDataSign])) }
}

const vectors = []

// `digestKind`: "standard" signs viem's `TypedDataSign` hash; "primaryFirst" signs the hash with
// the contents types appended primary type first. They coincide when the primary type sorts
// before its dependencies, and the generator checks that they do.
async function addVector({ label, appDomain, types, primaryType, message, explicit = false, digestKind }) {
  const appDomainSeparator = hashDomain({
    domain: appDomain,
    types: { EIP712Domain: domainTypes(appDomain) },
  })
  const contentsType = encodeType({ primaryType, types })
  const contents = hashStruct({ data: message, primaryType, types })
  const ed = encodeData(types, primaryType, message)
  assert(keccak256(concat([keccak256(toHex(contentsType)), ed])) === contents, `${label}: encodeData`)
  const appHash = hashTypedData({
    domain: appDomain,
    types: { ...types, EIP712Domain: domainTypes(appDomain) },
    primaryType,
    message,
  })
  assert(keccak256(concat(['0x1901', appDomainSeparator, contents])) === appHash, `${label}: appHash`)

  const standard = standardDigest(appDomain, types, primaryType, message)
  const primaryFirst = primaryFirstDigest(appDomainSeparator, contentsType, primaryType, contents)
  const deps = [...contentsType.matchAll(/\)?([A-Za-z0-9_]+)\(/g)].map((m) => m[1])
  const primarySortsFirst = deps.slice(1).every((d) => primaryType < d)
  assert((standard === primaryFirst.digest) === primarySortsFirst, `${label}: digest agreement`)

  const digest = digestKind === 'standard' ? standard : primaryFirst.digest
  const signature = serializeSignature(await sign({ hash: digest, privateKey: PRIVATE_KEY }))
  vectors.push({
    label,
    primaryType,
    contentsType,
    description: explicit ? contentsType + primaryType : contentsType,
    appDomainSeparator,
    encodeData: ed,
    contents,
    appHash,
    typedDataSignTypehash: primaryFirst.typehash,
    digestKind,
    digest,
    signature,
    // The emissary derives `TypedDataSign` from `contentsType` primary type first.
    expectValid: digestKind === 'primaryFirst' || primarySortsFirst,
  })
  return { contentsType, contents, appDomainSeparator }
}

const appDomain = {
  name: 'ExternalApp',
  version: '1',
  chainId: 31337n,
  verifyingContract: '0x0000000000000000000000000000000000C0FFEE',
}

// ---- Single types ----
const permitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
const permitMessage = {
  owner: '0x1111111111111111111111111111111111111111',
  spender: '0x000000000000000000000000000000000000bEEF',
  value: 10n ** 18n,
  nonce: 0n,
  deadline: 1_700_000_000n,
}
await addVector({ label: 'Permit, implicit', appDomain, types: permitTypes, primaryType: 'Permit', message: permitMessage, digestKind: 'standard' })
await addVector({ label: 'Permit, explicit', appDomain, types: permitTypes, primaryType: 'Permit', message: permitMessage, explicit: true, digestKind: 'standard' })
await addVector({
  label: 'Permit, app domain with salt',
  appDomain: { ...appDomain, salt: keccak256(toHex('salt')) },
  types: permitTypes,
  primaryType: 'Permit',
  message: { ...permitMessage, value: 2n ** 255n + 7n },
  digestKind: 'standard',
})
await addVector({
  label: 'Permit, app domain with only chainId and verifyingContract',
  appDomain: { chainId: 1n, verifyingContract: '0x00000000000000000000000000000000DeaDBeef' },
  types: permitTypes,
  primaryType: 'Permit',
  message: { ...permitMessage, value: 0n, nonce: 2n ** 256n - 1n },
  digestKind: 'standard',
})

const flagsTypes = {
  Flags: [
    { name: 'on', type: 'bool' },
    { name: 'delta', type: 'int256' },
    { name: 'selector', type: 'bytes4' },
    { name: 'small', type: 'uint8' },
    { name: 'negative', type: 'int8' },
    { name: 'tag', type: 'bytes32' },
  ],
}
await addVector({
  label: 'Atomic types: bool, int256, bytes4, uint8, int8, bytes32',
  appDomain,
  types: flagsTypes,
  primaryType: 'Flags',
  message: { on: true, delta: -(10n ** 30n), selector: '0xa9059cbb', small: 255, negative: -128, tag: keccak256(toHex('tag')) },
  digestKind: 'standard',
})

// ---- Dynamic fields ----
const messageTypes = {
  Message: [
    { name: 'text', type: 'string' },
    { name: 'payload', type: 'bytes' },
    { name: 'id', type: 'bytes32' },
  ],
}
await addVector({
  label: 'string and bytes fields',
  appDomain,
  types: messageTypes,
  primaryType: 'Message',
  message: { text: 'Hello, Bob!', payload: '0xdeadbeef', id: keccak256(toHex('id')) },
  digestKind: 'standard',
})
await addVector({
  label: 'unicode string and 100-byte bytes',
  appDomain,
  types: messageTypes,
  primaryType: 'Message',
  message: { text: 'Grüße, 世界 🌍', payload: toHex(new Uint8Array(100).map((_, i) => i)), id: '0x' + '00'.repeat(32) },
  explicit: true,
  digestKind: 'standard',
})
await addVector({
  label: 'empty string and empty bytes',
  appDomain,
  types: messageTypes,
  primaryType: 'Message',
  message: { text: '', payload: '0x', id: '0x' + 'ff'.repeat(32) },
  digestKind: 'standard',
})

// ---- Arrays ----
const batchTypes = {
  Batch: [
    { name: 'amounts', type: 'uint256[]' },
    { name: 'recipients', type: 'address[]' },
    { name: 'memos', type: 'string[]' },
    { name: 'grid', type: 'uint256[3]' },
  ],
}
await addVector({
  label: 'atomic, string and fixed-size arrays',
  appDomain,
  types: batchTypes,
  primaryType: 'Batch',
  message: {
    amounts: [1n, 2n, 3n],
    recipients: ['0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'],
    memos: ['a', 'bc'],
    grid: [7n, 8n, 9n],
  },
  digestKind: 'standard',
})
await addVector({
  label: 'empty arrays',
  appDomain,
  types: batchTypes,
  primaryType: 'Batch',
  message: { amounts: [], recipients: [], memos: [], grid: [0n, 0n, 0n] },
  explicit: true,
  digestKind: 'standard',
})

// ---- Nested types, primary type sorts first ----
const mailTypes = {
  Mail: [
    { name: 'from', type: 'Person' },
    { name: 'to', type: 'Person' },
    { name: 'contents', type: 'string' },
  ],
  Person: [
    { name: 'name', type: 'string' },
    { name: 'wallet', type: 'address' },
  ],
}
const mailDomain = {
  name: 'Ether Mail',
  version: '1',
  chainId: 1n,
  verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
}
const mailMessage = {
  from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
  to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
  contents: 'Hello, Bob!',
}
const mail = await addVector({ label: 'EIP-712 Mail example', appDomain: mailDomain, types: mailTypes, primaryType: 'Mail', message: mailMessage, digestKind: 'standard' })
// The EIP-712 specification's values.
assert(mail.appDomainSeparator === '0xf2cee375fa42b42143804025fc449deafd50cc031ca257e0b194a650a912090f', 'Mail domain')
assert(mail.contents === '0xc52c0ee5d84264471806290a3f2c4cecfc5490626bf912d01f240d7a274b371e', 'Mail contents')
await addVector({ label: 'EIP-712 Mail example, explicit', appDomain: mailDomain, types: mailTypes, primaryType: 'Mail', message: mailMessage, explicit: true, digestKind: 'standard' })

const basketTypes = {
  Basket: [
    { name: 'items', type: 'Item[]' },
    { name: 'owner', type: 'address' },
    { name: 'meta', type: 'Meta' },
  ],
  Item: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'tags', type: 'bytes32[]' },
  ],
  Meta: [
    { name: 'note', type: 'string' },
    { name: 'blob', type: 'bytes' },
  ],
}
await addVector({
  label: 'array of structs, three types',
  appDomain,
  types: basketTypes,
  primaryType: 'Basket',
  message: {
    items: [
      { token: '0x4444444444444444444444444444444444444444', amount: 5n, tags: [keccak256(toHex('x'))] },
      { token: '0x5555555555555555555555555555555555555555', amount: 6n, tags: [] },
    ],
    owner: '0x6666666666666666666666666666666666666666',
    meta: { note: 'basket', blob: '0x01' },
  },
  digestKind: 'standard',
})

const deepTypes = {
  A: [
    { name: 'b', type: 'B' },
    { name: 'x', type: 'uint256' },
  ],
  B: [
    { name: 'c', type: 'C[]' },
    { name: 's', type: 'string' },
  ],
  C: [
    { name: 'data', type: 'bytes' },
    { name: 'flag', type: 'bool' },
  ],
}
await addVector({
  label: 'three levels deep',
  appDomain,
  types: deepTypes,
  primaryType: 'A',
  message: { b: { c: [{ data: '0xabcdef', flag: true }, { data: '0x', flag: false }], s: 'deep' }, x: 42n },
  digestKind: 'standard',
})

// ---- Nested types, a dependency sorts before the primary type ----
const outerTypes = {
  Outer: [
    { name: 'a', type: 'Inner' },
    { name: 'b', type: 'uint256' },
  ],
  Inner: [{ name: 'x', type: 'uint256' }],
}
const outerMessage = { a: { x: 7n }, b: 8n }
await addVector({ label: 'Outer, primary first', appDomain, types: outerTypes, primaryType: 'Outer', message: outerMessage, digestKind: 'primaryFirst' })
await addVector({ label: 'Outer, sorted TypedDataSign', appDomain, types: outerTypes, primaryType: 'Outer', message: outerMessage, digestKind: 'standard' })

// ---- Permit2 PermitBatchWitnessTransferFrom with the compact-utils Mandate witness ----
const mandateTypes = {
  Mandate: [
    { name: 'target', type: 'Target' },
    { name: 'minGas', type: 'uint128' },
    { name: 'originOps', type: 'Op' },
    { name: 'destOps', type: 'Op' },
    { name: 'q', type: 'bytes32' },
  ],
  Op: [
    { name: 'vt', type: 'bytes32' },
    { name: 'ops', type: 'Ops[]' },
  ],
  Ops: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  Target: [
    { name: 'recipient', type: 'address' },
    { name: 'tokenOut', type: 'Token[]' },
    { name: 'targetChain', type: 'uint256' },
    { name: 'fillExpiry', type: 'uint256' },
  ],
  Token: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
}
const mandate = {
  target: {
    recipient: '0x7777777777777777777777777777777777777777',
    tokenOut: [{ token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: 999_000n }],
    targetChain: 8453n,
    fillExpiry: 1_700_003_600n,
  },
  minGas: 250_000n,
  originOps: { vt: '0x' + '00'.repeat(32), ops: [] },
  destOps: {
    vt: '0x0001' + '00'.repeat(30),
    ops: [{ to: '0x8888888888888888888888888888888888888888', value: 0n, data: '0xa9059cbb' + '00'.repeat(64) }],
  },
  q: keccak256(toHex('qualifier')),
}
const permit2Types = {
  PermitBatchWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions[]' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'mandate', type: 'Mandate' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  ...mandateTypes,
}
const permit2Domain = { name: 'Permit2', chainId: 1n, verifyingContract: PERMIT2 }
const permit2Message = {
  permitted: [{ token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amount: 1_000_000n }],
  spender: '0x9999999999999999999999999999999999999999',
  nonce: 1337n,
  deadline: 1_700_003_600n,
  mandate,
}
const p2 = {
  appDomain: permit2Domain,
  types: permit2Types,
  primaryType: 'PermitBatchWitnessTransferFrom',
  message: permit2Message,
}
assert(
  keccak256(toHex(encodeType({ primaryType: 'PermitBatchWitnessTransferFrom', types: permit2Types }))) ===
    TYPEHASH_JIT_PERMIT2,
  'Permit2 typehash matches compact-utils',
)
await addVector({ label: 'Permit2 batch witness with Mandate, primary first', ...p2, digestKind: 'primaryFirst' })
await addVector({ label: 'Permit2 batch witness with Mandate, primary first, explicit', ...p2, explicit: true, digestKind: 'primaryFirst' })
await addVector({ label: 'Permit2 batch witness with Mandate, sorted TypedDataSign', ...p2, digestKind: 'standard' })

// ---- The Compact MultichainCompact ----
const compactTypes = {
  MultichainCompact: [
    { name: 'sponsor', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expires', type: 'uint256' },
    { name: 'elements', type: 'Element[]' },
  ],
  Element: [
    { name: 'arbiter', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'commitments', type: 'Lock[]' },
    { name: 'mandate', type: 'Mandate' },
  ],
  Lock: [
    { name: 'lockTag', type: 'bytes12' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  ...mandateTypes,
}
assert(
  keccak256(toHex(encodeType({ primaryType: 'MultichainCompact', types: compactTypes }))) === TYPEHASH_COMPACT,
  'Compact typehash matches compact-utils',
)
const compactVector = {
  appDomain: { name: 'The Compact', version: '1', chainId: 1n, verifyingContract: '0x00000000000000171ede64904551eeDF3C6C9788' },
  types: compactTypes,
  primaryType: 'MultichainCompact',
  message: {
    sponsor: ACCOUNT_DOMAIN.verifyingContract,
    nonce: 1n,
    expires: 1_700_003_600n,
    elements: [
      {
        arbiter: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 1n,
        commitments: [{ lockTag: '0x' + '00'.repeat(12), token: '0x0000000000000000000000000000000000000000', amount: 10n ** 17n }],
        mandate,
      },
      {
        arbiter: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        chainId: 8453n,
        commitments: [],
        mandate: { ...mandate, minGas: 0n, q: '0x' + '00'.repeat(32) },
      },
    ],
  },
}
await addVector({ label: 'Compact MultichainCompact, primary first', ...compactVector, digestKind: 'primaryFirst' })
await addVector({ label: 'Compact MultichainCompact, sorted TypedDataSign', ...compactVector, digestKind: 'standard' })

const json = {
  generator: 'viem ' + (await import(`${VIEM}/errors/version.js`)).version,
  signer,
  accountDomain: { ...ACCOUNT_DOMAIN, chainId: Number(ACCOUNT_DOMAIN.chainId) },
  count: vectors.length,
  vectors,
}
writeFileSync(out, JSON.stringify(json, null, 2) + '\n')
console.log(`${vectors.length} vectors (${vectors.filter((v) => v.expectValid).length} valid) -> ${out}`)
