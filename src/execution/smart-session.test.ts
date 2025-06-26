import { createPublicClient, keccak256, ReadContractParameters } from 'viem'
import { baseSepolia } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import {
  getMultichainDigest,
  getSessionSignature,
  hashErc7739,
} from './smart-session'

const hash = keccak256('0xabcd')

describe('Smart Session', () => {
  describe('Session Signature', () => {
    test('default', () => {
      const signature = getSessionSignature(
        '0x81d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1b',
        '0xf5f6dfa751763cc5278cba45d03ea9797c1660b2cb7f5ffd188fa3e8523abdca',
        hash,
        'MultichainCompact(address sponsor,uint256 nonce,uint256 expires,Segment[] segments)Segment(address arbiter,uint256 chainId,uint256[2][] idsAndAmounts,Witness witness)Witness(address recipient,uint256[2][] tokenOut,uint256 depositId,uint256 targetChain,uint32 fillDeadline,XchainExec[] execs,bytes32 userOpHash,uint32 maxFeeBps)XchainExec(address to,uint256 value,bytes data)',
        {
          owners: {
            type: 'ecdsa',
            accounts: [accountA],
          },
        },
      )

      expect(signature).toEqual(
        '0xccebde8bf6e5be4357e71b316fb7f8ceb5f6046f3b941157ae8fca3458ec4b8881d4b4981670cb18f99f0b4a66446df1bf5b204d24cfcb659bf38ba27a4359b5711649ec2423c5e1247245eba2964679b6a1dbb85c992ae40b9b00c6935b02ff1bf5f6dfa751763cc5278cba45d03ea9797c1660b2cb7f5ffd188fa3e8523abdcadbe576b4818846aa77e82f4ed5fa78f92766b141f282d36703886d196df393224d756c7469636861696e436f6d7061637428616464726573732073706f6e736f722c75696e74323536206e6f6e63652c75696e7432353620657870697265732c5365676d656e745b5d207365676d656e7473295365676d656e74286164647265737320617262697465722c75696e7432353620636861696e49642c75696e743235365b325d5b5d20696473416e64416d6f756e74732c5769746e657373207769746e657373295769746e657373286164647265737320726563697069656e742c75696e743235365b325d5b5d20746f6b656e4f75742c75696e74323536206465706f73697449642c75696e7432353620746172676574436861696e2c75696e7433322066696c6c446561646c696e652c58636861696e457865635b5d2065786563732c6279746573333220757365724f70486173682c75696e743332206d61784665654270732958636861696e45786563286164647265737320746f2c75696e743235362076616c75652c62797465732064617461290176',
      )
    })
  })

  describe('ERC-7739 Hash', () => {
    vi.mock('viem', async (importOriginal) => {
      const actual = await importOriginal()

      return {
        // @ts-ignore
        ...actual,
        createPublicClient: vi.fn().mockReturnValue({
          readContract: vi.fn(),
        }),
      }
    })
    const client = createPublicClient as any
    client.mockImplementation((_: any) => {
      return {
        readContract: (params: ReadContractParameters) => {
          if (params.functionName === 'DOMAIN_SEPARATOR') {
            return '0xf5f6dfa751763cc5278cba45d03ea9797c1660b2cb7f5ffd188fa3e8523abdca'
          }
          if (params.functionName === 'eip712Domain') {
            return [
              '0x0f',
              'Nexus',
              '1.2.0',
              84532n,
              '0x6eCBF67Ec3C83F69793f47a6d285205211Cce6B8',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              [],
            ]
          }
          throw new Error('Unknown function call')
        },
      }
    })

    test('default', async () => {
      const { hash, appDomainSeparator, contentsType, structHash } =
        await hashErc7739(
          baseSepolia,
          [
            {
              orderBundle: {
                sponsor: '0x306651f0849c673fdd047e02b12876c3f3a0ea7f',
                nonce:
                  9485744147263218405930911645136653780776457667745611332784875666970100155394n,
                expires: 1779186360n,
                segments: [
                  {
                    arbiter: '0x0000000000AFc904aE9860D9c4B96D7c529c58b8',
                    chainId: 84532n,
                    idsAndAmounts: [
                      [
                        21847980266613871481014731415167448634647776251198795536684055616834884337664n,
                        27972738278553n,
                      ],
                    ],
                    witness: {
                      recipient: '0x306651f0849c673fdd047e02b12876c3f3a0ea7f',
                      tokenOut: [
                        [
                          21847980266613871481014731415714625498819945639464912901926990218956488388823n,
                          1n,
                        ],
                      ],
                      depositId:
                        9485744147263218405930911645136653780776457667745611332784875666970100155394n,
                      targetChain: 11155420n,
                      fillDeadline: 1747650660,
                      execs: [],
                      userOpHash:
                        '0x77de857754318bd623d5fcfe907f521b5702e66f7620497a1240b00c3cf687d4',
                      maxFeeBps: 0,
                    },
                  },
                ],
                tokenPrices: {},
                gasPrices: {},
                opGasParams: {},
              },
              injectedExecutions: [
                {
                  to: '0x000000000060f6e853447881951574CDd0663530',
                  value: 0n,
                  data: '0xa2418864dfa33131e10fc5a4e964266d3b723c3fdf6d8820a98b45fe72bc4c832bcfc958b65a2e3c262d6aa13e67774994610c7865b1cdddff9f09652afc066a69dde63614f8bdad59484b94317dabddf28f017b76319442ad57376abb19de5acb1cc40200000000000000000000000000000000000000000000000000000000682b0864',
                },
                {
                  to: '0x0000000000f6Ed8Be424d673c63eeFF8b9267420',
                  value: 0n,
                  data: '0x27c777a9000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000c0510a9471ae4610d769e9f0075021f0c90470857f353a70908c692324def23262000000000000000000000000000000000000000000000000000000006a0c3ab8304d84c3d9a7be3b28c945315fd84259d66cd46123540766be93dfe6d43130d70000000000000000000000000000000000000000000000000000000000000001000000000000000000000000306651f0849c673fdd047e02b12876c3f3a0ea7f00000000000000000000000000000000000000000000000000000000000000417f521211e594e88797bf4c53f49c2afbd56219384a175209be50509c03a94eea1a2ce4a2ea0d57084f820ab7527f3661f5c394f6c53ff05425407b990f50d0d91c00000000000000000000000000000000000000000000000000000000000000',
                },
              ],
              intentCost: {
                hasFulfilledAll: true,
                tokensSpent: {
                  '84532': {
                    '0x0000000000000000000000000000000000000000':
                      27972738278553n,
                  },
                },
                tokensReceived: [
                  {
                    tokenAddress: '0x5fd84259d66cd46123540766be93dfe6d43130d7',
                    hasFulfilled: true,
                    amountSpent: 66715n,
                    targetAmount: 1n,
                    fee: 66714n,
                  },
                  {
                    tokenAddress: '0x0000000000000000000000000000000000000000',
                    hasFulfilled: true,
                    amountSpent: 0n,
                    targetAmount: 0n,
                    fee: 0n,
                  },
                ],
              },
            },
          ],
          '0x306651f0849c673fdd047e02b12876c3f3a0ea7f',
        )

      expect(hash).toEqual(
        '0x8b5043375be2b2c81bffc55e91991c91f9b4daec94999cc934071e32e0c2bc83',
      )
      expect(appDomainSeparator).toEqual(
        '0xf5f6dfa751763cc5278cba45d03ea9797c1660b2cb7f5ffd188fa3e8523abdca',
      )
      expect(contentsType).toEqual(
        'MultichainCompact(address sponsor,uint256 nonce,uint256 expires,Segment[] segments)Segment(address arbiter,uint256 chainId,uint256[2][] idsAndAmounts,Witness witness)Witness(address recipient,uint256[2][] tokenOut,uint256 depositId,uint256 targetChain,uint32 fillDeadline,XchainExec[] execs,bytes32 userOpHash,uint32 maxFeeBps)XchainExec(address to,uint256 value,bytes data)',
      )
      expect(structHash).toEqual(
        '0x6622d2a44c958ffed7b7b3746f4fc9c2e39543858f6f176cc58ccf7741c65b4a',
      )
    })
  })

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
