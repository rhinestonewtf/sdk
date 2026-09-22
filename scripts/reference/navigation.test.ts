import { describe, expect, it } from 'vitest'
import { type NavGroup, patchReferenceNavigation } from './navigation'

const generated: NavGroup[] = [
  {
    group: 'Account',
    pages: ['wallets/custom-signer/sdk-reference/account/get-address'],
  },
]

function launchedDocs(
  pages: unknown[] = ['wallets/custom-signer/overview'],
): any {
  return {
    $schema: 'https://mintlify.com/docs.json',
    redirects: [{ source: '/old', destination: '/new' }],
    navigation: {
      tabs: [
        { tab: 'Home', pages: ['home/introduction'] },
        {
          tab: 'Wallets',
          menu: [
            { item: 'Overview', pages: ['wallets/overview'] },
            { item: 'Custom signer', pages },
            { item: 'Other wallets', pages: ['wallets/other'] },
          ],
        },
        { tab: 'API reference', pages: ['api-reference/index'] },
      ],
    },
  }
}

describe('patchReferenceNavigation', () => {
  it('replaces the nested section idempotently and preserves unrelated navigation', () => {
    const docs = launchedDocs([
      'wallets/custom-signer/overview',
      { group: 'SDK reference', pages: ['stale'] },
      {
        group: 'Troubleshooting',
        pages: ['wallets/custom-signer/troubleshooting'],
      },
    ])

    const once = patchReferenceNavigation(structuredClone(docs), generated)
    const twice = patchReferenceNavigation(structuredClone(once), generated)

    expect(twice).toEqual(once)
    expect(once.$schema).toBe(docs.$schema)
    expect(once.redirects).toEqual(docs.redirects)
    expect(once.navigation.tabs[0]).toEqual(docs.navigation.tabs[0])
    expect(once.navigation.tabs[2]).toEqual(docs.navigation.tabs[2])
    expect(once.navigation.tabs[1].menu[0]).toEqual(
      docs.navigation.tabs[1].menu[0],
    )
    expect(once.navigation.tabs[1].menu[2]).toEqual(
      docs.navigation.tabs[1].menu[2],
    )
    expect(once.navigation.tabs[1].menu[1].pages).toEqual([
      'wallets/custom-signer/overview',
      { group: 'SDK reference', pages: generated },
      {
        group: 'Troubleshooting',
        pages: ['wallets/custom-signer/troubleshooting'],
      },
    ])
  })

  it('appends one nested section when it is absent', () => {
    const docs = launchedDocs()

    patchReferenceNavigation(docs, generated)
    patchReferenceNavigation(docs, generated)

    expect(docs.navigation.tabs[1].menu[1].pages).toEqual([
      'wallets/custom-signer/overview',
      { group: 'SDK reference', pages: generated },
    ])
  })

  it.each([
    ['missing tabs array', {}, 'docs.json has no navigation.tabs array'],
    [
      'missing Wallets tab',
      { navigation: { tabs: [{ tab: 'Home', pages: [] }] } },
      'navigation tab "Wallets" not found',
    ],
    [
      'duplicate Wallets tabs',
      {
        navigation: {
          tabs: [
            { tab: 'Wallets', menu: [] },
            { tab: 'Wallets', menu: [] },
          ],
        },
      },
      'duplicate navigation tab "Wallets"',
    ],
    [
      'legacy tab-level navigation',
      { navigation: { tabs: [{ tab: 'Wallets', pages: [] }] } },
      'navigation tab "Wallets" has no menu array',
    ],
    [
      'missing Custom signer item',
      { navigation: { tabs: [{ tab: 'Wallets', menu: [] }] } },
      'navigation menu item "Custom signer" not found',
    ],
    [
      'duplicate Custom signer items',
      {
        navigation: {
          tabs: [
            {
              tab: 'Wallets',
              menu: [
                { item: 'Custom signer', pages: [] },
                { item: 'Custom signer', pages: [] },
              ],
            },
          ],
        },
      },
      'duplicate navigation menu item "Custom signer"',
    ],
    [
      'missing Custom signer pages',
      {
        navigation: {
          tabs: [{ tab: 'Wallets', menu: [{ item: 'Custom signer' }] }],
        },
      },
      'navigation menu item "Custom signer" in tab "Wallets" has no pages array',
    ],
  ])('rejects %s', (_, docs, error) => {
    expect(() => patchReferenceNavigation(docs, generated)).toThrow(error)
  })

  it('rejects a malformed SDK reference group', () => {
    const docs = launchedDocs([{ group: 'SDK reference' }])

    expect(() => patchReferenceNavigation(docs, generated)).toThrow(
      'navigation group "SDK reference" has no pages array',
    )
  })

  it('rejects duplicate SDK reference groups', () => {
    const docs = launchedDocs([
      { group: 'SDK reference', pages: [] },
      { group: 'SDK reference', pages: [] },
    ])

    expect(() => patchReferenceNavigation(docs, generated)).toThrow(
      'duplicate navigation group "SDK reference"',
    )
  })
})
