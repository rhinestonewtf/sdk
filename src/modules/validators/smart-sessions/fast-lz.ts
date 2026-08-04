/*
 * Adapted from Solady's LibZip FastLZ implementation:
 * https://github.com/Vectorized/solady/blob/main/js/solady.js
 * Copyright (c) 2022-2025 Solady.
 *
 * MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { bytesToHex, type Hex, hexToBytes } from 'viem'

const HASH_TABLE_SIZE = 8192
const MAX_DISTANCE = 8192
const MAX_LITERAL_LENGTH = 32
const MAX_MATCH_EXTENSION = 262

function readUint24(bytes: Uint8Array, index: number): number {
  return bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16)
}

function hashUint24(value: number): number {
  // Keep Solady's number multiplication and signed shift semantics. Math.imul
  // changes buckets for some inputs and therefore changes compressed bytes.
  return ((2654435769 * value) >> 19) & (HASH_TABLE_SIZE - 1)
}

function writeLiterals(
  output: number[],
  input: Uint8Array,
  start: number,
  length: number,
): void {
  let cursor = start
  let remaining = length
  while (remaining >= MAX_LITERAL_LENGTH) {
    output.push(MAX_LITERAL_LENGTH - 1)
    for (let index = 0; index < MAX_LITERAL_LENGTH; index++) {
      output.push(input[cursor++])
    }
    remaining -= MAX_LITERAL_LENGTH
  }
  if (remaining === 0) return

  output.push(remaining - 1)
  while (remaining-- > 0) output.push(input[cursor++])
}

function writeMatch(
  output: number[],
  distance: number,
  extensionLength: number,
): void {
  const encodedDistance = distance - 1
  let remaining = extensionLength

  while (remaining > MAX_MATCH_EXTENSION) {
    output.push(0xe0 + (encodedDistance >> 8), 253, encodedDistance & 0xff)
    remaining -= MAX_MATCH_EXTENSION
  }
  if (remaining < 7) {
    output.push(
      (remaining << 5) + (encodedDistance >> 8),
      encodedDistance & 0xff,
    )
    return
  }
  output.push(
    0xe0 + (encodedDistance >> 8),
    remaining - 7,
    encodedDistance & 0xff,
  )
}

export function fastLzCompress(data: Hex): Hex {
  const input = hexToBytes(data)
  const inputBoundary = input.length - 4
  const hashTable = new Uint32Array(HASH_TABLE_SIZE)
  const output: number[] = []
  let anchor = 0
  let cursor = 2

  while (cursor < inputBoundary - 9) {
    let reference = 0
    let distance = 0
    let matched = false

    while (cursor < inputBoundary - 9) {
      const sequence = readUint24(input, cursor)
      const hash = hashUint24(sequence)
      reference = hashTable[hash] || 0
      hashTable[hash] = cursor
      distance = cursor - reference
      const candidate =
        distance < MAX_DISTANCE ? readUint24(input, reference) : 0x1000000
      cursor++
      if (sequence === candidate) {
        matched = true
        break
      }
    }

    if (!matched || cursor >= inputBoundary - 9) break
    cursor--
    if (cursor > anchor) {
      writeLiterals(output, input, anchor, cursor - anchor)
    }

    const referenceStart = reference + 3
    const matchStart = cursor + 3
    const comparisonLength = inputBoundary - matchStart
    let extensionLength = 0
    while (extensionLength < comparisonLength) {
      const matches =
        input[referenceStart + extensionLength] ===
        input[matchStart + extensionLength]
      extensionLength++
      if (!matches) break
    }

    cursor += extensionLength
    writeMatch(output, distance, extensionLength)

    hashTable[hashUint24(readUint24(input, cursor))] = cursor++
    hashTable[hashUint24(readUint24(input, cursor))] = cursor++
    anchor = cursor
  }

  writeLiterals(output, input, anchor, input.length - anchor)
  return bytesToHex(Uint8Array.from(output))
}

export function fastLzDecompress(data: Hex): Hex {
  const input = hexToBytes(data)
  const output: number[] = []
  let cursor = 0

  while (cursor < input.length) {
    const control = input[cursor]
    const matchType = control >> 5
    if (matchType === 0) {
      let literalLength = control + 1
      cursor++
      while (literalLength-- > 0) output.push(input[cursor++])
      continue
    }

    const shortMatch = matchType < 7
    const distance = 256 * (control & 31) + input[cursor + (shortMatch ? 1 : 2)]
    let matchLength: number
    if (shortMatch) {
      matchLength = matchType + 2
      cursor += 2
    } else {
      matchLength = input[cursor + 1] + 9
      cursor += 3
    }

    let reference = output.length - distance - 1
    while (matchLength-- > 0) output.push(output[reference++])
  }

  return bytesToHex(Uint8Array.from(output))
}
