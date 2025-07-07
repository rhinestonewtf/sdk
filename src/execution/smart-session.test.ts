import { describe, expect, test, vi } from 'vitest'
import { getMultichainDigest } from './smart-session'

describe('Smart Session', () => {
  describe('Multichain Digest', () => {
    test('Single', () => {
      const digest = getMultichainDigest([
        {
          chainId: 421614n,
          sessionDigest:
            '0x971daa09e9deb42457fb008fce5a63987379b31fd67ec6c16ff8b52517bfb373',
        },
      ])

      expect(digest).toEqual(
        '0xc0f5a263b2af5a01bc221835faf49b77459a5696f881c25fea9f8144c43f2326',
      )
    })

    test('Multiple', () => {
      const digest = getMultichainDigest([
        {
          chainId: 84532n,
          sessionDigest:
            '0xad3139c2b3ca57ba02e86ba3ad86dd18a05ba53650e3088ebd4fed71166d4bdd',
        },
        {
          chainId: 84532n,
          sessionDigest:
            '0x1e6cc59dee4aca4a0d9b1fccd6fde197c831d5bd51163746f1947b352732f3db',
        },
        {
          chainId: 11155420n,
          sessionDigest:
            '0x9b14ad37022e97faf4d9824c8d7e85b97f304839d24a3cd582575753df7d9239',
        },
      ])

      expect(digest).toEqual(
        '0x02f738c7e916839b958b21cbf8bf3697ca06fcb7d5fd5eba85ad49c8f2756adb',
      )
    })
  })
})
