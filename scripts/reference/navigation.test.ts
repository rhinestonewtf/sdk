import { describe, expect, it } from 'vitest'
import {
  type NavGroup,
  patchReferenceNavigation,
  syncGeneratedInventories,
} from './navigation'

const generated: NavGroup[] = [
  {
    group: 'Account',
    pages: ['wallets/custom-signer/sdk-reference/account/get-address'],
  },
]

describe('patchReferenceNavigation', () => {
  it('patches nested Wallets navigation without changing unrelated entries', () => {
    const docs = {
      navigation: {
        tabs: [
          { tab: 'Home', pages: ['home/introduction'] },
          {
            tab: 'Wallets',
            menu: [
              { item: 'Overview', pages: ['wallets/overview'] },
              {
                item: 'Custom signer',
                pages: [
                  'wallets/custom-signer/overview',
                  { group: 'SDK reference', pages: ['stale'] },
                  {
                    group: 'Troubleshooting',
                    pages: ['wallets/custom-signer/troubleshooting'],
                  },
                ],
              },
            ],
          },
        ],
      },
    }

    const once = patchReferenceNavigation(structuredClone(docs), generated, {
      tab: 'Wallets',
      menuItem: 'Custom signer',
      section: 'SDK reference',
    })
    const twice = patchReferenceNavigation(structuredClone(once), generated, {
      tab: 'Wallets',
      menuItem: 'Custom signer',
      section: 'SDK reference',
    })

    expect(twice).toEqual(once)
    expect(once.navigation.tabs[0]).toEqual(docs.navigation.tabs[0])
    expect(once.navigation.tabs[1].menu[0]).toEqual({
      item: 'Overview',
      pages: ['wallets/overview'],
    })
    expect(once.navigation.tabs[1].menu[1].pages).toEqual([
      'wallets/custom-signer/overview',
      { group: 'SDK reference', pages: generated },
      {
        group: 'Troubleshooting',
        pages: ['wallets/custom-signer/troubleshooting'],
      },
    ])
  })

  it('supports the explicit legacy tab shape', () => {
    const docs = {
      navigation: {
        tabs: [
          { tab: 'Wallet', pages: ['smart-wallet/introduction'] },
          { tab: 'API Reference', pages: ['api-reference/index'] },
        ],
      },
    }
    const legacyPages = [
      { group: 'Account', pages: ['sdk-reference/account/get-address'] },
    ]

    patchReferenceNavigation(docs, legacyPages, {
      tab: 'Wallet',
      section: 'SDK Reference',
    })

    expect(docs.navigation.tabs).toEqual([
      {
        tab: 'Wallet',
        pages: [
          'smart-wallet/introduction',
          { group: 'SDK Reference', pages: legacyPages },
        ],
      },
      { tab: 'API Reference', pages: ['api-reference/index'] },
    ])
  })

  it('fails when the configured target is missing or duplicated', () => {
    expect(() =>
      patchReferenceNavigation(
        { navigation: { tabs: [{ tab: 'Wallets', menu: [] }] } },
        generated,
        {
          tab: 'Wallets',
          menuItem: 'Custom signer',
          section: 'SDK reference',
        },
      ),
    ).toThrow('navigation menu item "Custom signer" not found')

    expect(() =>
      patchReferenceNavigation(
        {
          navigation: {
            tabs: [
              {
                tab: 'Wallets',
                menu: [
                  {
                    item: 'Custom signer',
                    pages: [
                      { group: 'SDK reference', pages: [] },
                      { group: 'SDK reference', pages: [] },
                    ],
                  },
                ],
              },
            ],
          },
        },
        generated,
        {
          tab: 'Wallets',
          menuItem: 'Custom signer',
          section: 'SDK reference',
        },
      ),
    ).toThrow('duplicate navigation group "SDK reference"')
  })
})

describe('syncGeneratedInventories', () => {
  it('preserves unrelated ownership and existing page metadata', () => {
    const result = syncGeneratedInventories(
      {
        version: 1,
        destinations: [
          {
            path: 'wallets/overview',
            owner: 'RHI-7121',
            collaborators: [],
            content: 'authored',
          },
          {
            path: 'api-reference/generated-operation',
            owner: 'RHI-7000',
            collaborators: [],
            content: 'generated',
          },
          {
            path: 'wallets/custom-signer/sdk-reference/account/get-address',
            owner: 'RHI-7109',
            collaborators: ['RHI-7134'],
            content: 'generated',
          },
          {
            path: 'transactions/overview',
            owner: 'RHI-7121',
            collaborators: [],
            content: 'placeholder',
          },
        ],
      },
      { version: 1, paths: ['stale'] },
      [
        'wallets/custom-signer/sdk-reference/account/get-address',
        'wallets/custom-signer/sdk-reference/account/get-owners',
        'wallets/custom-signer/sdk-reference/chains/solana-address',
      ],
      'wallets/custom-signer/sdk-reference',
      'RHI-7109',
    )

    expect(result.ownership.destinations).toEqual([
      {
        path: 'wallets/overview',
        owner: 'RHI-7121',
        collaborators: [],
        content: 'authored',
      },
      {
        path: 'api-reference/generated-operation',
        owner: 'RHI-7000',
        collaborators: [],
        content: 'generated',
      },
      {
        path: 'wallets/custom-signer/sdk-reference/account/get-address',
        owner: 'RHI-7109',
        collaborators: ['RHI-7134'],
        content: 'generated',
      },
      {
        path: 'wallets/custom-signer/sdk-reference/account/get-owners',
        owner: 'RHI-7109',
        collaborators: [],
        content: 'generated',
      },
      {
        path: 'wallets/custom-signer/sdk-reference/chains/solana-address',
        owner: 'RHI-7109',
        collaborators: [],
        content: 'generated',
      },
      {
        path: 'transactions/overview',
        owner: 'RHI-7121',
        collaborators: [],
        content: 'placeholder',
      },
    ])
    expect(result.fixture.paths).toEqual([
      'account/get-address',
      'account/get-owners',
      'chains/solana-address',
    ])
  })

  it('fails instead of inventing ownership for a new subtree', () => {
    expect(() =>
      syncGeneratedInventories(
        {
          destinations: [
            {
              path: 'wallets/custom-signer/sdk-reference/account/get-address',
              owner: 'RHI-7109',
              collaborators: [],
              content: 'generated',
            },
          ],
        },
        { paths: [] },
        ['wallets/custom-signer/sdk-reference/new-area/new-page'],
        'wallets/custom-signer/sdk-reference',
      ),
    ).toThrow('no ownership metadata can be inferred')
  })
})
