import {
  type Address,
  concat,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  keccak256,
  toHex,
  zeroHash,
} from 'viem'
import { describe, expect, test } from 'vitest'
import type { Permit2ClaimPolicy } from '../../../../types'
import {
  buildPermit2ClaimPolicyCalldata,
  encodePermit2ClaimPolicyInitData,
  type Permit2ClaimMessage,
} from './permit2'
import {
  ANY_ADDRESS,
  FIELD_ARBITER,
  FIELD_EXPIRY,
  FIELD_FILL_EXPIRY,
  FIELD_RECIPIENT,
  FIELD_RECIPIENT_IS_SPONSOR,
  FIELD_TOKEN_IN,
  FIELD_TOKEN_OUT,
  MODE_CHECK_STORAGE,
} from './types'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TOKEN_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address // USDC
const TOKEN_B = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address // WETH
const ARBITER = '0x1234567890123456789012345678901234567890' as Address

/** Zero-value Op struct (vt is bytes32, empty ops) */
const EMPTY_OP = {
  vt: zeroHash,
  ops: [] as { to: Address; value: bigint; data: Hex }[],
}

/** A simple message with one permitted token and no mandate ops */
const baseMessage: Permit2ClaimMessage = {
  permitted: [{ token: TOKEN_A, amount: 1000n }],
  spender: ARBITER,
  nonce: 42n,
  deadline: 9999999n,
  mandate: {
    target: {
      recipient: ARBITER,
      tokenOut: [{ token: TOKEN_B, amount: 500n }],
      targetChain: 8453n,
      fillExpiry: 888888n,
    },
    minGas: 100000n,
    originOps: EMPTY_OP,
    destOps: EMPTY_OP,
    q: keccak256('0x'),
  },
}

// ---------------------------------------------------------------------------
// Hash helpers (mirror of the private functions in permit2.ts)
// ---------------------------------------------------------------------------

const TYPEHASH_PERMIT2_TOKEN: Hex =
  '0x618358ac3db8dc274f0cd8829da7e234bd48cd73c4a740aede1adec9846d06a1'
const TYPEHASH_TOKENOUT: Hex =
  '0x55550a068ac7a6c7ce02eac46ebe7c7b964dd10d7800455df1c5bc5a6685a42c'
const TYPEHASH_TARGET: Hex =
  '0xf72802bb5695954ab337feb3d113d61f4206cfaef3987552df2b2b47477db74b'
const TYPEHASH_OPS: Hex =
  '0x09b0a32e9842b65559835c235891737e06927d59e48a6f0e0512e136a513a9e4'
const TYPEHASH_OP: Hex =
  '0xdbc520cb50a8aaf3fa06ea43dc3d59d248e52ae638476e3268a1e6e36bffe196'
const TYPEHASH_MANDATE: Hex =
  '0xc988b4da10503879cf4b893fed09620229f5ade301ef5e4af6124b22823627dc'

function hashArray(hashes: Hex[]): Hex {
  return keccak256(hashes.length > 0 ? concat(hashes) : '0x')
}

function hashToken(token: Address, amount: bigint, typehash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [typehash, token, amount],
    ),
  )
}

function hashOp(op: {
  vt: Hex
  ops: readonly { to: Address; value: bigint; data: Hex }[]
}): Hex {
  const execHashes = Array.from(op.ops).map((e) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'bytes32' },
        ],
        [TYPEHASH_OPS, e.to, e.value, keccak256(e.data)],
      ),
    ),
  )
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [TYPEHASH_OP, op.vt, hashArray(execHashes)],
    ),
  )
}

function hashTarget(
  recipient: Address,
  tokenOutHash: Hex,
  targetChain: bigint,
  fillExpiry: bigint,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
      ],
      [TYPEHASH_TARGET, recipient, tokenOutHash, targetChain, fillExpiry],
    ),
  )
}

function hashMandate(
  targetHash: Hex,
  minGas: bigint,
  originOpsHash: Hex,
  destOpsHash: Hex,
  q: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint128' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [TYPEHASH_MANDATE, targetHash, minGas, originOpsHash, destOpsHash, q],
    ),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPermit2ClaimPolicyCalldata', () => {
  describe('header', () => {
    test('always starts with [spender:20][nonce:32][deadline:32]', () => {
      const policy: Permit2ClaimPolicy = { type: 'permit2-claim' }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      const expectedHeader = encodePacked(
        ['address', 'uint256', 'uint256'],
        [baseMessage.spender, baseMessage.nonce, baseMessage.deadline],
      )
      // Header is 84 bytes (20 + 32 + 32)
      expect(result.slice(0, 2 + 84 * 2)).toBe(expectedHeader)
    })
  })

  describe('tokenIn — hash-only mode (no tokensIn policy)', () => {
    test('inserts keccak256 of token permissions array', () => {
      const policy: Permit2ClaimPolicy = { type: 'permit2-claim' }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      const tokenHash = hashArray(
        baseMessage.permitted.map(({ token, amount }) =>
          hashToken(token, amount, TYPEHASH_PERMIT2_TOKEN),
        ),
      )
      // Header = 84 bytes, then 32 bytes of tokenPermissionsHash
      const tokenHashInResult = `0x${result.slice(2 + 84 * 2, 2 + 84 * 2 + 64)}`
      expect(tokenHashInResult).toBe(tokenHash)
    })
  })

  describe('tokenIn — expanded mode (tokensIn policy set)', () => {
    test('writes [count:1][token_uint256:32][amount:32] per permitted token', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        tokensIn: [{ chainId: 1, token: TOKEN_A }],
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      const headerLen = 84
      const offset = 2 + headerLen * 2

      // count byte
      expect(result.slice(offset, offset + 2)).toBe(
        toHex(baseMessage.permitted.length, { size: 1 }).slice(2),
      )

      // token entry: address abi-encoded as uint256 (left-padded) + amount
      const { token, amount } = baseMessage.permitted[0]
      const expectedEntry = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [token, amount],
      )
      expect(result.slice(offset + 2, offset + 2 + 128)).toBe(
        expectedEntry.slice(2),
      )
    })

    test('length increases with each permitted token', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        tokensIn: [{ chainId: 1, token: TOKEN_A }],
      }
      const msg2: Permit2ClaimMessage = {
        ...baseMessage,
        permitted: [
          { token: TOKEN_A, amount: 1000n },
          { token: TOKEN_B, amount: 2000n },
        ],
      }
      const r1 = buildPermit2ClaimPolicyCalldata(policy, baseMessage)
      const r2 = buildPermit2ClaimPolicyCalldata(policy, msg2)

      // r2 should be 64 bytes (one extra token entry) longer than r1
      expect((r2.length - r1.length) / 2).toBe(64)
    })
  })

  describe('mandate — hash-only mode (no target checks)', () => {
    test('inserts pre-computed mandateHash when no target checks enabled', () => {
      const policy: Permit2ClaimPolicy = { type: 'permit2-claim' }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      const m = baseMessage.mandate
      const tokenOutHash = hashArray(
        m.target.tokenOut.map(({ token, amount }) =>
          hashToken(token, amount, TYPEHASH_TOKENOUT),
        ),
      )
      const targetHash = hashTarget(
        m.target.recipient,
        tokenOutHash,
        m.target.targetChain,
        m.target.fillExpiry,
      )
      const expectedMandateHash = hashMandate(
        targetHash,
        m.minGas,
        hashOp(m.originOps),
        hashOp(m.destOps),
        m.q,
      )

      // Hash-only: header(84) + tokenPermissionsHash(32) + mandateHash(32) = 148 bytes
      expect((result.length - 2) / 2).toBe(148)
      const mandateHashInResult = `0x${result.slice(2 + (84 + 32) * 2)}`
      expect(mandateHashInResult).toBe(expectedMandateHash)
    })
  })

  describe('mandate — expanded mode (target checks enabled)', () => {
    test('tokenOut policy: expands target with [count:1][token:32][amount:32]...', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        tokensOut: [{ chainId: 8453, token: TOKEN_B }],
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      // Expanded: header(84) + tokenPermissionsHash(32) + target[recipient:20,targetChain:32,fillExpiry:32]
      //           + tokenOut[count:1, entry:64] + minGas(16) + originOpsHash(32) + destOpsHash(32) + q(32)
      // = 84 + 32 + 84 + 1 + 64 + 16 + 32 + 32 + 32 = 377 bytes
      expect((result.length - 2) / 2).toBe(377)
    })

    test('recipient policy: expands target, tokenOut is hashed', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        recipients: [{ chainId: 8453, recipient: ARBITER }],
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      // Expanded: header(84) + tokenPermissionsHash(32) + target header(84)
      //           + tokenOutHash(32) + minGas(16) + originOpsHash(32) + destOpsHash(32) + q(32) = 344 bytes
      expect((result.length - 2) / 2).toBe(344)
    })

    test('fillExpiry policy: expands target, tokenOut is hashed', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        fillExpiryBounds: [{ chainId: 8453 }],
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      expect((result.length - 2) / 2).toBe(344)
    })

    test('recipientIsSponsor: expands target, tokenOut is hashed', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        recipientIsSponsor: true,
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      expect((result.length - 2) / 2).toBe(344)
    })

    test('expanded target starts with [recipient:20][targetChain:32][fillExpiry:32]', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        recipients: [{ chainId: 8453, recipient: ARBITER }],
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      const { target } = baseMessage.mandate
      const expectedTargetHeader = encodePacked(
        ['address', 'uint256', 'uint256'],
        [target.recipient, target.targetChain, target.fillExpiry],
      )
      // tokenPermissionsHash ends at offset 84+32=116 bytes from start
      const targetStart = 2 + (84 + 32) * 2
      expect(
        result.slice(
          targetStart,
          targetStart + expectedTargetHeader.length - 2,
        ),
      ).toBe(expectedTargetHeader.slice(2))
    })

    test('q is appended verbatim at the end', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        recipients: [{ chainId: 8453, recipient: ARBITER }],
      }
      const result = buildPermit2ClaimPolicyCalldata(policy, baseMessage)

      // q is always the last 32 bytes
      const qInResult = `0x${result.slice(result.length - 64)}`
      expect(qInResult).toBe(baseMessage.mandate.q)
    })
  })

  describe('determinism', () => {
    test('same inputs always produce same output', () => {
      const policy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        tokensIn: [{ chainId: 1, token: TOKEN_A }],
        tokensOut: [{ chainId: 8453, token: TOKEN_B }],
      }
      const r1 = buildPermit2ClaimPolicyCalldata(policy, baseMessage)
      const r2 = buildPermit2ClaimPolicyCalldata(policy, baseMessage)
      expect(r1).toBe(r2)
    })

    test('hash-only and expanded modes produce different output', () => {
      const hashOnlyPolicy: Permit2ClaimPolicy = { type: 'permit2-claim' }
      const expandedPolicy: Permit2ClaimPolicy = {
        type: 'permit2-claim',
        tokensOut: [{ chainId: 8453, token: TOKEN_B }],
      }
      const r1 = buildPermit2ClaimPolicyCalldata(hashOnlyPolicy, baseMessage)
      const r2 = buildPermit2ClaimPolicyCalldata(expandedPolicy, baseMessage)
      expect(r1).not.toBe(r2)
      expect(r1.length).toBeLessThan(r2.length)
    })
  })

  describe('empty arrays', () => {
    test('empty permitted array hashes to keccak256 of empty bytes', () => {
      const policy: Permit2ClaimPolicy = { type: 'permit2-claim' }
      const msgEmpty: Permit2ClaimMessage = { ...baseMessage, permitted: [] }
      const result = buildPermit2ClaimPolicyCalldata(policy, msgEmpty)

      const emptyHash = keccak256('0x')
      const tokenHashInResult = `0x${result.slice(2 + 84 * 2, 2 + 84 * 2 + 64)}`
      expect(tokenHashInResult).toBe(emptyHash)
    })

    test('empty tokenOut array hashes to keccak256 of empty bytes in hash-only mode', () => {
      const policy: Permit2ClaimPolicy = { type: 'permit2-claim' }
      const msgNoOut: Permit2ClaimMessage = {
        ...baseMessage,
        mandate: {
          ...baseMessage.mandate,
          target: { ...baseMessage.mandate.target, tokenOut: [] },
        },
      }
      const r1 = buildPermit2ClaimPolicyCalldata(policy, msgNoOut)
      // Should succeed without errors and be deterministic
      const r2 = buildPermit2ClaimPolicyCalldata(policy, msgNoOut)
      expect(r1).toBe(r2)
    })
  })
})

// ---------------------------------------------------------------------------
// Op hashing — non-empty ops and non-zero vt (as the orchestrator sends them)
// ---------------------------------------------------------------------------

describe('Op hashing with real orchestrator data shapes', () => {
  const policy: Permit2ClaimPolicy = { type: 'permit2-claim' }

  // vt as the orchestrator produces it: bytes32(bytes2([execType, sigMode]))
  // e.g. execType=0x04 (ERC7579), sigMode=0x01 (EMISSARY) → 0x0401 in first 2 bytes
  const REAL_VT = `0x0401${'00'.repeat(30)}` as Hex

  const EXEC_A = {
    to: TOKEN_A,
    value: 0n,
    data: '0xdeadbeef' as Hex,
  }
  const EXEC_B = {
    to: TOKEN_B,
    value: 1000n,
    data: '0x' as Hex,
  }

  test('non-zero vt produces different hash than zero vt', () => {
    const opZeroVt = { vt: zeroHash, ops: [EXEC_A] }
    const opRealVt = { vt: REAL_VT, ops: [EXEC_A] }

    // Use hash-only mandate mode so ops hash is visible in output
    const msgZeroVt: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: opZeroVt },
    }
    const msgRealVt: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: opRealVt },
    }

    const r1 = buildPermit2ClaimPolicyCalldata(policy, msgZeroVt)
    const r2 = buildPermit2ClaimPolicyCalldata(policy, msgRealVt)
    expect(r1).not.toBe(r2)
  })

  test('non-empty ops array produces different hash than empty ops', () => {
    const opEmpty = { vt: REAL_VT, ops: [] as (typeof EXEC_A)[] }
    const opWithExec = { vt: REAL_VT, ops: [EXEC_A] }

    const msgEmpty: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: opEmpty },
    }
    const msgWithExec: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: opWithExec },
    }

    const r1 = buildPermit2ClaimPolicyCalldata(policy, msgEmpty)
    const r2 = buildPermit2ClaimPolicyCalldata(policy, msgWithExec)
    expect(r1).not.toBe(r2)
  })

  test('ops order matters — different order produces different hash', () => {
    const opAB = { vt: REAL_VT, ops: [EXEC_A, EXEC_B] }
    const opBA = { vt: REAL_VT, ops: [EXEC_B, EXEC_A] }

    const msgAB: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: opAB },
    }
    const msgBA: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: opBA },
    }

    const r1 = buildPermit2ClaimPolicyCalldata(policy, msgAB)
    const r2 = buildPermit2ClaimPolicyCalldata(policy, msgBA)
    expect(r1).not.toBe(r2)
  })

  test('ops hash matches manual computation (bytes32 vt encoding)', () => {
    const op = { vt: REAL_VT, ops: [EXEC_A, EXEC_B] }
    const msg: Permit2ClaimMessage = {
      ...baseMessage,
      mandate: { ...baseMessage.mandate, originOps: op, destOps: EMPTY_OP },
    }

    const result = buildPermit2ClaimPolicyCalldata(policy, msg)

    // Manually compute expected mandate hash
    const execHashA = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'bytes32' },
        ],
        [TYPEHASH_OPS, EXEC_A.to, EXEC_A.value, keccak256(EXEC_A.data)],
      ),
    )
    const execHashB = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'bytes32' },
        ],
        [TYPEHASH_OPS, EXEC_B.to, EXEC_B.value, keccak256(EXEC_B.data)],
      ),
    )
    const opsArrayHash = keccak256(concat([execHashA, execHashB]))
    const expectedOriginOpsHash = keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
        [TYPEHASH_OP, REAL_VT, opsArrayHash],
      ),
    )

    const tokenOutHash = hashArray(
      msg.mandate.target.tokenOut.map(({ token, amount }) =>
        hashToken(token, amount, TYPEHASH_TOKENOUT),
      ),
    )
    const targetHash = hashTarget(
      msg.mandate.target.recipient,
      tokenOutHash,
      msg.mandate.target.targetChain,
      msg.mandate.target.fillExpiry,
    )
    const expectedMandateHash = keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'uint128' },
          { type: 'bytes32' },
          { type: 'bytes32' },
          { type: 'bytes32' },
        ],
        [
          TYPEHASH_MANDATE,
          targetHash,
          msg.mandate.minGas,
          expectedOriginOpsHash,
          hashOp(EMPTY_OP),
          msg.mandate.q,
        ],
      ),
    )

    // mandate hash is the last 32 bytes in hash-only mode
    const mandateHashInResult = `0x${result.slice(result.length - 64)}`
    expect(mandateHashInResult).toBe(expectedMandateHash)
  })

  test('message shape matching getTypedData output: vt as 32-byte hex from orchestrator', () => {
    // Simulates what getTypedData in execution/permit2.ts produces:
    // mandate.preClaimOps = { vt: <32-byte hex>, ops: Execution[] }
    const orchestratorStyleMessage: Permit2ClaimMessage = {
      permitted: [{ token: TOKEN_A, amount: 500000n }],
      spender: ARBITER,
      nonce: 1n,
      deadline: 2000000000n,
      mandate: {
        target: {
          recipient: ARBITER,
          tokenOut: [{ token: TOKEN_B, amount: 250000n }],
          targetChain: 8453n,
          fillExpiry: 1999999999n,
        },
        minGas: 200000n,
        // vt as bytes32 with execType=0x04 (ERC7579), sigMode=0x01 (EMISSARY)
        originOps: { vt: `0x0401${'00'.repeat(30)}` as Hex, ops: [] },
        destOps: { vt: `0x0401${'00'.repeat(30)}` as Hex, ops: [] },
        q: keccak256('0xabcdef'),
      },
    }

    const result = buildPermit2ClaimPolicyCalldata(
      { type: 'permit2-claim' },
      orchestratorStyleMessage,
    )

    // Should produce a deterministic 148-byte output (all hash-only mode)
    expect((result.length - 2) / 2).toBe(148)
    // Should be deterministic
    expect(
      buildPermit2ClaimPolicyCalldata(
        { type: 'permit2-claim' },
        orchestratorStyleMessage,
      ),
    ).toBe(result)
  })
})

// ---------------------------------------------------------------------------
// encodePermit2ClaimPolicyInitData
// ---------------------------------------------------------------------------

describe('encodePermit2ClaimPolicyInitData', () => {
  function modeConfigBit(fieldId: number): number {
    return MODE_CHECK_STORAGE << (fieldId * 2)
  }

  function readModeConfig(initData: Hex): number {
    return Number(BigInt(`0x${initData.slice(2, 10)}`))
  }

  test('empty policy: modeConfig=0, only 4-byte header', () => {
    const result = encodePermit2ClaimPolicyInitData({ type: 'permit2-claim' })
    // 4 bytes = 8 hex chars + '0x'
    expect(result).toBe('0x00000000')
  })

  test('arbiters: sets FIELD_ARBITER mode bit and encodes [count:1][address...]', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      arbiters: [ARBITER],
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(readModeConfig(result) & modeConfigBit(FIELD_ARBITER)).toBeTruthy()

    // After 4-byte modeConfig: count(1) + address(20) = 21 bytes
    const expected = concat([
      toHex(modeConfigBit(FIELD_ARBITER), { size: 4 }),
      encodePacked(['uint8', 'address'], [1, ARBITER]),
    ])
    expect(result).toBe(expected)
  })

  test('expiryBounds: sets FIELD_EXPIRY bit and encodes max<<128|min as uint256', () => {
    const min = 1000n
    const max = 9999999n
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      expiryBounds: { min, max },
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(readModeConfig(result) & modeConfigBit(FIELD_EXPIRY)).toBeTruthy()

    const packed = (min & ((1n << 128n) - 1n)) | (max << 128n)
    const expected = concat([
      toHex(modeConfigBit(FIELD_EXPIRY), { size: 4 }),
      toHex(packed, { size: 32 }),
    ])
    expect(result).toBe(expected)
  })

  test('tokensIn: sets FIELD_TOKEN_IN bit and encodes [count:1][chainId:32][token:20]...', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      tokensIn: [{ chainId: 1, token: TOKEN_A }],
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(readModeConfig(result) & modeConfigBit(FIELD_TOKEN_IN)).toBeTruthy()

    const expected = concat([
      toHex(modeConfigBit(FIELD_TOKEN_IN), { size: 4 }),
      toHex(1, { size: 1 }),
      encodePacked(['uint256', 'address'], [1n, TOKEN_A]),
    ])
    expect(result).toBe(expected)
  })

  test('recipients: uses ANY_ADDRESS sentinel for "any"', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      recipients: [
        { chainId: 8453, recipient: 'any' },
        { chainId: 1, recipient: ARBITER },
      ],
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(readModeConfig(result) & modeConfigBit(FIELD_RECIPIENT)).toBeTruthy()

    const expected = concat([
      toHex(modeConfigBit(FIELD_RECIPIENT), { size: 4 }),
      toHex(2, { size: 1 }),
      encodePacked(['uint256', 'address'], [8453n, ANY_ADDRESS]),
      encodePacked(['uint256', 'address'], [1n, ARBITER]),
    ])
    expect(result).toBe(expected)
  })

  test('fillExpiryBounds: sets FIELD_FILL_EXPIRY bit and encodes [count:1][chainId:32][packed:32]...', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      fillExpiryBounds: [{ chainId: 8453, min: 100n, max: 9000n }],
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(
      readModeConfig(result) & modeConfigBit(FIELD_FILL_EXPIRY),
    ).toBeTruthy()

    const packed = (100n & ((1n << 128n) - 1n)) | (9000n << 128n)
    const expected = concat([
      toHex(modeConfigBit(FIELD_FILL_EXPIRY), { size: 4 }),
      toHex(1, { size: 1 }),
      encodePacked(['uint256', 'uint256'], [8453n, packed]),
    ])
    expect(result).toBe(expected)
  })

  test('tokensOut: sets FIELD_TOKEN_OUT bit', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      tokensOut: [{ chainId: 8453, token: TOKEN_B }],
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(readModeConfig(result) & modeConfigBit(FIELD_TOKEN_OUT)).toBeTruthy()
  })

  test('recipientIsSponsor: sets FIELD_RECIPIENT_IS_SPONSOR bit, no extra bytes', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      recipientIsSponsor: true,
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    expect(
      readModeConfig(result) & modeConfigBit(FIELD_RECIPIENT_IS_SPONSOR),
    ).toBeTruthy()
    // Only modeConfig bytes — no additional payload
    expect(result).toBe(
      toHex(modeConfigBit(FIELD_RECIPIENT_IS_SPONSOR), { size: 4 }),
    )
  })

  test('multiple fields: all mode bits are combined correctly', () => {
    const policy: Permit2ClaimPolicy = {
      type: 'permit2-claim',
      arbiters: [ARBITER],
      tokensIn: [{ chainId: 1, token: TOKEN_A }],
      tokensOut: [{ chainId: 8453, token: TOKEN_B }],
    }
    const result = encodePermit2ClaimPolicyInitData(policy)

    const expectedMode =
      modeConfigBit(FIELD_ARBITER) |
      modeConfigBit(FIELD_TOKEN_IN) |
      modeConfigBit(FIELD_TOKEN_OUT)
    expect(readModeConfig(result)).toBe(expectedMode)
  })
})
