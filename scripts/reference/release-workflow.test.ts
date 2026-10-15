import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const releaseWorkflow = readFileSync(
  resolve(root, '.github/workflows/release.yaml'),
  'utf8',
)
const syncWorkflow = readFileSync(
  resolve(root, '.github/workflows/sync-sdk-reference.yaml'),
  'utf8',
)

describe('SDK v2 maintenance release workflow', () => {
  it('publishes only from v2 after build, unit tests, and package lint', () => {
    expect(releaseWorkflow).toContain('branches:\n      - v2\n')
    expect(releaseWorkflow).toContain("if: github.ref == 'refs/heads/v2'")
    expect(releaseWorkflow).toContain('needs: [build-and-test]')
    expect(releaseWorkflow).toContain('run: bun run test')
    expect(releaseWorkflow).toContain('run: bun run build')
    expect(releaseWorkflow).toContain('run: bunx publint')
    expect(releaseWorkflow).not.toContain('always()')
    expect(releaseWorkflow).not.toContain('refs/heads/main')
    expect(releaseWorkflow).not.toContain('refs/heads/release')
    expect(releaseWorkflow).not.toContain('snapshot')
  })

  it('retains OIDC publishing and release-bot Changesets PRs', () => {
    expect(releaseWorkflow).toContain('id-token: write')
    expect(releaseWorkflow).toContain('actions/create-github-app-token@')
    expect(releaseWorkflow).toContain('sudo npm install -g npm@11')
    expect(releaseWorkflow).toContain('Create Release Pull Request or Publish')
    expect(releaseWorkflow).toContain('publish: bun run changeset:release')
    expect(releaseWorkflow).toContain('version: bun run changeset:version')
    expect(releaseWorkflow).toContain('Label release PR')
  })

  it('isolates the maintenance dist-tag and Changesets base', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    )
    const config = JSON.parse(
      readFileSync(resolve(root, '.changeset/config.json'), 'utf8'),
    )
    expect(manifest.scripts['changeset:release']).toBe(
      'bun run build && changeset publish --tag v2-latest',
    )
    expect(config.baseBranch).toBe('v2')
    expect(releaseWorkflow).toContain('Verify maintenance release version')
    expect(releaseWorkflow).toContain('/^2\\.\\d+\\.\\d+$/')
  })

  it('does not promote releases or update the current SDK reference', () => {
    expect(releaseWorkflow).not.toContain('promotion')
    expect(releaseWorkflow).not.toContain('docs-repo')
    expect(releaseWorkflow).not.toContain('generate:reference')
    expect(releaseWorkflow).not.toContain('SDK_REFERENCE_DOCS_')
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
    expect(releaseWorkflow).not.toContain('Sync SDK reference')
    expect(syncWorkflow).not.toContain('changeset publish')
    expect(syncWorkflow).not.toContain('id-token: write')
  })
})
