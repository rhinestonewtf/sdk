import { describe, expect, it } from 'vitest'
import { manifest, type Node, type SymbolEntry } from './manifest'
import { createRenderer } from './render'

const renderer = createRenderer({ nameToPage: new Map() })
const ref = (name: string) => ({ type: 'reference', name })
const promise = (type: unknown) => ({
  ...ref('Promise'),
  typeArguments: [type],
})
const parameter = (name: string, optional = false) => ({
  name,
  type: ref('Input'),
  flags: { isOptional: optional },
})
const entry = (
  symbol: string,
  callStyle: SymbolEntry['callStyle'] = 'function',
): SymbolEntry => ({
  kind: 'symbol',
  source: '.',
  symbol,
  callStyle,
})
const comment = (summary: string, example?: string, returns?: string) => ({
  summary: [{ kind: 'text', text: summary }],
  blockTags: [
    ...(example
      ? [
          {
            tag: '@example',
            content: [{ kind: 'code', text: `\`\`\`ts\n${example}\n\`\`\`` }],
          },
        ]
      : []),
    ...(returns
      ? [{ tag: '@returns', content: [{ kind: 'text', text: returns }] }]
      : []),
  ],
})
const leaves = (nodes: Node[]): SymbolEntry[] =>
  nodes.flatMap((node) => (node.kind === 'group' ? leaves(node.items) : [node]))

describe('reference rendering', () => {
  it.each([
    ['single', ref('Call'), '[build(input)]'],
    ['array', { type: 'array', elementType: ref('Call') }, 'build(input)'],
    ['async single', promise(ref('Call')), '[await build(input)]'],
    [
      'async array',
      promise({ type: 'array', elementType: ref('Call') }),
      'await build(input)',
    ],
  ])(
    'wraps %s action results in a sponsored v3 destination',
    (_name, type, calls) => {
      const snippet = renderer.usageSnippet(entry('build', 'action'), {
        type,
        parameters: [parameter('input')],
      })
      expect(snippet).toBe(
        `// Requires sponsorship enabled for your project.\nconst transaction = await account.prepareTransaction({\n  destination: {\n    chain,\n    calls: ${calls},\n  },\n  sponsored: true,\n})`,
      )
    },
  )

  it('preserves all 74 pages and centrally applies action policy to all 23 wrappers, not recovery helpers', () => {
    const pages = leaves(manifest)
    expect(pages).toHaveLength(74)
    const actions = pages.filter((page) => page.callStyle === 'action')
    expect(actions).toHaveLength(23)
    for (const action of actions) {
      expect(renderer.usageSnippet(action, { type: ref('Call') })).toContain(
        'sponsored: true',
      )
    }
    const recovery = pages.filter(
      (page) =>
        page.source.includes('recovery') && page.callStyle === 'function',
    )
    expect(recovery).toHaveLength(2)
    for (const helper of recovery) {
      expect(
        renderer.usageSnippet(helper, { type: promise(ref('Call')) }),
      ).not.toContain('prepareTransaction')
    }
  })

  it('omits defaults and optional tails, preserving positional holes and avoiding shadowing', () => {
    const parameters = [
      { ...parameter('threshold'), defaultValue: '1' },
      parameter('optional', true),
      parameter('result'),
      { ...parameter('tail'), defaultValue: '0' },
    ]
    const sig = { parameters, type: ref('Output') }
    expect(renderer.usageSnippet(entry('read'), sig)).toBe(
      'const output = read(undefined, undefined, result)',
    )
    const page = renderer.renderPage(entry('read'), { signatures: [sig] })
    expect(page).toContain('path="threshold" type="Input">')
    expect(page).toContain('Default: `1`.')
    expect(page).toContain('path="result" type="Input" required>')
    expect(
      renderer.usageSnippet(entry('read'), {
        parameters: parameters.slice(0, 2),
      }),
    ).toBe('read()')
  })

  it('presents ordinary signing first without numeric IDs or merging owner contracts', () => {
    const owner = {
      id: 1,
      parameters: [parameter('preparedTransaction'), parameter('options')],
      type: promise(ref('OwnerSignature')),
      comment: comment('Owner contribution.', undefined, 'Only this owner.'),
    }
    const ordinary = {
      id: 999,
      parameters: [
        parameter('preparedTransaction'),
        parameter('options', true),
      ],
      type: promise(ref('SignedTransactionData')),
      comment: comment('Configured signers.', undefined, 'Ready to submit.'),
    }
    const page = renderer.renderPage(
      entry('signTransaction', 'accountMethod'),
      { signatures: [owner, ordinary] },
    )
    const [first, second] = page.split('### Independent owner signing')
    expect(first).toContain('### Ordinary signing')
    expect(first).toContain('account.signTransaction(preparedTransaction)')
    expect(first).toContain('path="options" type="Input">')
    expect(first).toContain('type="SignedTransactionData"')
    expect(first).not.toContain('OwnerSignature')
    expect(second).toContain(
      'account.signTransaction(preparedTransaction, { owner })',
    )
    expect(second).toContain('path="options" type="Input" required>')
    expect(second).toContain('type="OwnerSignature"')
    expect(second).not.toContain('SignedTransactionData')
    expect(page).toContain('Ready to submit.')
    expect(page).toContain('Only this owner.')
  })

  it('keeps polling inputs and returns correlated even when one signature has no comment', () => {
    const signatures = [
      {
        parameters: [{ name: 'result', type: ref('TransactionResult') }],
        type: promise(ref('TransactionStatus')),
        comment: comment('Wait for an intent.'),
      },
      {
        parameters: [{ name: 'result', type: ref('UserOperationResult') }],
        type: promise(ref('UserOperationReceipt')),
      },
    ]
    const page = renderer.renderPage(
      entry('waitForExecution', 'accountMethod'),
      { signatures },
    )
    const [intent, userOp] = page.split('### UserOperation receipt')
    expect(intent).toContain('### Intent result')
    expect(intent).toContain('type="TransactionStatus"')
    expect(intent).not.toContain('UserOperationReceipt')
    expect(userOp).toContain('type="UserOperationResult" required')
    expect(userOp).toContain('type="UserOperationReceipt"')
    expect(userOp).not.toContain('Wait for an intent.')
    expect(page.match(/account.waitForExecution\(result\)/g)).toHaveLength(2)
    expect(page).toContain('const output = await')
  })

  it('preserves every authored example within its own overload', () => {
    const page = renderer.renderPage(entry('read'), {
      signatures: [
        { type: ref('A'), comment: comment('First.', 'const a = read(1)') },
        {
          type: ref('B'),
          comment: {
            ...comment('Second.', 'const b = read(2)'),
            blockTags: [
              ...comment('', 'const b = read(2)').blockTags,
              ...comment('', 'const c = read(3)').blockTags,
            ],
          },
        },
      ],
    })
    expect(page).toContain('const a = read(1)')
    expect(page).toContain('const b = read(2)')
    expect(page).toContain('const c = read(3)')
    expect(page.match(/```ts/g)).toHaveLength(4) // Import plus three examples.
  })

  it('uses class prose and constructor examples with authenticated fallback', () => {
    const ctor = entry('RhinestoneSDK', 'constructor')
    const render = createRenderer({
      nameToPage: new Map(),
      classComment: () => comment('Class prose.'),
    })
    const page = render.renderPage(ctor, {
      kind: 512,
      signatures: [
        {
          comment: comment(
            'Constructor prose.',
            'const sdk = new RhinestoneSDK(config)',
          ),
        },
      ],
    })
    expect(page).toContain('description: "Class prose."')
    expect(page).toContain('const sdk = new RhinestoneSDK(config)')
    expect(renderer.usageSnippet(ctor, undefined)).toContain(
      "auth: { mode: 'apiKey', apiKey }",
    )
  })

  it('renders native-address conditional branches rather than object', () => {
    const native = { ...ref('NativeAddress'), typeArguments: [ref('Vm')] }
    const conditional = {
      type: 'conditional',
      checkType: ref('C'),
      extendsType: ref('Configured'),
      trueType: native,
      falseType: {
        type: 'union',
        types: [native, { type: 'intrinsic', name: 'undefined' }],
      },
    }
    expect(renderer.typeToString(conditional)).toBe(
      'C extends Configured ? NativeAddress<Vm> : NativeAddress<Vm> | undefined',
    )
    const page = renderer.renderPage(
      {
        ...entry('getAddress', 'accountMethod'),
        container: 'RhinestoneAccountBase',
      },
      { signatures: [{ type: conditional }] },
    )
    expect(page).toContain('NativeAddress<Vm>')
    expect(page).toContain('SolanaAddress')
    expect(page).toContain('widened configurations')
  })

  it.each([
    ['ManagedEvmAccount', 'Requires a managed EVM account'],
    ['ManagedTransactionAccount', 'EVM or managed Solana'],
    ['SolanaStandaloneAccount', 'Requires a standalone Solana account'],
    ['RhinestoneAccountBase', 'VM-neutral'],
  ] as const)('describes the %s capability', (container, expected) => {
    expect(
      renderer.instanceNote({ ...entry('method', 'accountMethod'), container }),
    ).toContain(expected)
  })
})
