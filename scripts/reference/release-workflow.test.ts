import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(
  resolve(root, '.github/workflows/release.yaml'),
  'utf8',
)

const syncWorkflow = readFileSync(
  resolve(root, '.github/workflows/sync-sdk-reference.yaml'),
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

describe('independent SDK reference workflow', () => {
  it('runs only for published releases and serializes without cancellation', () => {
    expect(syncWorkflow).toContain('release:\n    types: [published]')
    expect(syncWorkflow).toContain('group: production-sdk-reference')
    expect(syncWorkflow).toContain('cancel-in-progress: false')
    expect(syncWorkflow).not.toContain('workflow_dispatch')
    expect(syncWorkflow).not.toContain('continue-on-error')
    expect(syncWorkflow).toContain(
      "if: steps.release.outputs.eligible == 'true'",
    )
  })

  it('pins the SDK source and fixed docs destination', () => {
    expect(syncWorkflow).toContain('ref: $' + '{{ github.sha }}')
    expect(syncWorkflow).toContain('git fetch origin release --tags')
    expect(syncWorkflow).not.toContain('target_commitish')
    expect(syncWorkflow).toContain('repository: rhinestonewtf/docs')
    expect(syncWorkflow).toContain('ref: main')
    expect(syncWorkflow).toContain("BRANCH='update/sdk-reference'")
    expect(syncWorkflow).toContain("BASE='main'")
  })

  it('generates and stages only the launched reference paths', () => {
    expect(syncWorkflow).toContain(
      'SDK_REF_OUT: $' +
        '{{ github.workspace }}/docs-repo/wallets/custom-signer/sdk-reference',
    )
    expect(syncWorkflow).toContain(
      'SDK_REF_DOCS_JSON: $' + '{{ github.workspace }}/docs-repo/docs.json',
    )
    expect(syncWorkflow).not.toContain('SDK_REF_OWNERSHIP_JSON')
    expect(syncWorkflow).not.toContain('SDK_REF_PATHS_FIXTURE')
    expect(syncWorkflow).not.toContain('unified-docs/ownership.json')
  })

  it('rechecks staleness and safely maintains one rolling PR', () => {
    expect(syncWorkflow.match(/sync\.ts check-registry/g)).toHaveLength(2)
    expect(syncWorkflow).toContain("REGISTRY_ATTEMPTS: '1'")
    expect(syncWorkflow).toContain(
      "steps.final-registry.outputs.eligible == 'true'",
    )
    expect(syncWorkflow).toContain('git push --force-with-lease=')
    expect(syncWorkflow).not.toMatch(/git push --force\s/)
    expect(syncWorkflow).toContain('Rolling PR already represents')
    expect(syncWorkflow).toContain(
      'headRepositoryOwner.login == "rhinestonewtf"',
    )
    expect(syncWorkflow).toContain('.isCrossRepository == false')
    expect(syncWorkflow).toContain('gh pr edit')
    expect(syncWorkflow).toContain('gh pr create')
  })

  it('keeps docs failures independent from npm publishing', () => {
    expect(workflow).not.toContain('Sync SDK reference')
    expect(syncWorkflow).not.toContain('changeset publish')
    expect(syncWorkflow).not.toContain('id-token: write')
  })
})
