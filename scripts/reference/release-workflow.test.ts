import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(
  resolve(root, '.github/workflows/release.yaml'),
  'utf8',
)

describe('release SDK reference workflow', () => {
  it('keeps publishing and reference generation on supported SDK refs', () => {
    expect(workflow).toContain(
      'branches:\n      - main\n      - release\n      - v1',
    )
    expect(workflow).toContain(
      "steps.changesets.outputs.published == 'true' && github.ref == 'refs/heads/release'",
    )
    expect(workflow).not.toContain('- integration/unified-wallet-docs\n')
  })

  it('checks out and opens the docs PR against the configured non-default base', () => {
    expect(workflow).toMatch(
      /SDK_REFERENCE_DOCS_BASE_BRANCH: \$\{\{ vars\.SDK_REFERENCE_DOCS_BASE_BRANCH \|\| 'integration\/unified-wallet-docs' }}/,
    )
    expect(workflow).toMatch(
      /ref: \$\{\{ env\.SDK_REFERENCE_DOCS_BASE_BRANCH }}/,
    )
    expect(workflow).toMatch(
      /gh pr list --repo "\$\{GITHUB_REPOSITORY_OWNER}\/docs" --base "\$SDK_REFERENCE_DOCS_BASE_BRANCH"/,
    )
    expect(workflow).toContain('--base "$SDK_REFERENCE_DOCS_BASE_BRANCH"')
    expect(workflow).toMatch(
      /SDK_REFERENCE_DOCS_UPDATE_BRANCH: \$\{\{ vars\.SDK_REFERENCE_DOCS_UPDATE_BRANCH \|\| 'update\/sdk-reference-unified' }}/,
    )
  })

  it('writes only the canonical reference subtree and its inventories', () => {
    expect(workflow).toContain(
      'SDK_REF_OUT: $' +
        '{{ github.workspace }}/docs-repo/wallets/custom-signer/sdk-reference',
    )
    expect(workflow).toContain('unified-docs/ownership.json')
    expect(workflow).toContain('scripts/fixtures/sdk-reference-paths.json')
    expect(workflow).not.toContain('git add sdk-reference docs.json')
  })
})
