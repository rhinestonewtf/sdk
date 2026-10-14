import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(
  resolve(root, '.github/workflows/release.yaml'),
  'utf8',
)

describe('SDK release workflow', () => {
  it('preserves package release branches and gates without docs operations', () => {
    expect(workflow).toContain(
      'branches:\n      - main\n      - solana\n      - release\n      - v1',
    )
    expect(workflow).toContain('Create Release Pull Request or Publish')
    expect(workflow).toContain('needs.build-and-test.result')
    expect(workflow).toContain('needs.integration-tests.result')
    expect(workflow).not.toContain('docs-repo')
    expect(workflow).not.toContain('generate:reference')
    expect(workflow).not.toContain('SDK_REFERENCE_DOCS_')
  })

  it('gates both snapshot branches on build and smoke tests', () => {
    const snapshotRefs =
      "github.ref == 'refs/heads/main' || github.ref == 'refs/heads/solana'"

    expect(workflow).toContain(
      `if: ${snapshotRefs} || needs.release-mode.outputs.has-changesets != 'true'`,
    )
    expect(workflow).toContain(
      `if: needs.build-and-test.result == 'success' && (${snapshotRefs} || github.ref == 'refs/heads/release')`,
    )
    expect(workflow).toContain(
      `- name: Run smoke integration tests\n        if: ${snapshotRefs}\n        run: bun run test:integration:smoke -- --run`,
    )
    expect(workflow).toContain(
      `(${snapshotRefs} || github.ref == 'refs/heads/release') && needs.build-and-test.result == 'success' && needs.integration-tests.result == 'success'`,
    )
    expect(workflow).toContain(
      "((github.ref == 'refs/heads/release' || github.ref == 'refs/heads/v1') && needs.release-mode.outputs.has-changesets == 'true')",
    )
    expect(workflow).not.toContain("github.ref != 'refs/heads/main'")
  })

  it('shares the dev tag without promoting solana to production', () => {
    const snapshotRefs =
      "github.ref == 'refs/heads/main' || github.ref == 'refs/heads/solana'"

    expect(workflow).toContain(
      `- name: Use OIDC-capable npm\n        if: ${snapshotRefs} || needs.release-mode.outputs.has-changesets != 'true'`,
    )
    expect(workflow).toContain(
      `- name: Version snapshot\n        if: ${snapshotRefs}\n        run: |`,
    )
    expect(workflow).toContain(
      `- name: Build and publish snapshot\n        if: ${snapshotRefs}\n        run: bun run build && bunx changeset publish --tag dev`,
    )
    expect(workflow).toContain(
      "- name: Open release promotion PR\n        if: github.ref == 'refs/heads/main' && steps.promotion.outputs.releasable == 'true'",
    )
    expect(workflow).toContain(
      "- name: Create Release Pull Request or Publish\n        if: github.ref == 'refs/heads/release' || github.ref == 'refs/heads/v1'",
    )
  })

  it('versions snapshots without pending changesets and avoids cross-branch collisions', () => {
    expect(workflow).toContain(
      'if [ "$' +
        '{{ needs.release-mode.outputs.has-changesets }}" != "true" ]; then',
    )
    expect(workflow).toContain(
      `'"@rhinestone/sdk": patch' '---' 'Development snapshot.' > .changeset/dev-snapshot.md`,
    )
    expect(workflow).toContain(
      "bunx changeset version --snapshot dev --snapshot-prerelease-template '{tag}-{datetime}-{commit}'",
    )
    expect(workflow).toContain('bun run scripts/sync-version.ts')
  })
})
