import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(
  resolve(root, '.github/workflows/release.yaml'),
  'utf8',
)

const mainRef = "github.ref == 'refs/heads/main'"
const releaseRef = "github.ref == 'refs/heads/release'"
const v1Ref = "github.ref == 'refs/heads/v1'"
const hasChangesets = "needs.release-mode.outputs.has-changesets == 'true'"
const noChangesets = "needs.release-mode.outputs.has-changesets != 'true'"

describe('SDK release workflow', () => {
  it('has one active snapshot publisher and no docs operations', () => {
    expect(workflow).toContain(
      'branches:\n      - main\n      - release\n      - v1',
    )
    expect(workflow).not.toContain('solana')
    expect(workflow).not.toContain('docs-repo')
    expect(workflow).not.toContain('generate:reference')
    expect(workflow).not.toContain('SDK_REFERENCE_DOCS_')
  })

  it('gates main snapshots with build and smoke tests', () => {
    expect(workflow).toContain(`if: ${mainRef} || ${noChangesets}`)
    expect(workflow).toContain(
      `if: needs.build-and-test.result == 'success' && (${mainRef} || ${releaseRef})`,
    )
    expect(workflow).toContain(
      `- name: Run smoke integration tests\n        if: ${mainRef}\n        run: bun run test:integration:smoke -- --run`,
    )
    expect(workflow).toContain(
      `- name: Version snapshot\n        if: ${mainRef}\n        run: |`,
    )
    expect(workflow).toContain(
      `- name: Build and publish snapshot\n        if: ${mainRef}\n        run: bun run build && bunx changeset publish --tag dev`,
    )
    expect(workflow).toContain(
      "bunx changeset version --snapshot dev --snapshot-prerelease-template '{tag}-{datetime}-{commit}'",
    )
    expect(workflow).toContain(
      `if [ "\${{ needs.release-mode.outputs.has-changesets }}" != "true" ]; then`,
    )
    expect(workflow).toContain(
      `"@rhinestone/sdk": patch' '---' 'Development snapshot.' > .changeset/dev-snapshot.md`,
    )
  })

  it('opens a release PR for release changesets without publishing', () => {
    expect(workflow).toContain(
      `((${releaseRef} || ${v1Ref}) && ${hasChangesets})`,
    )
    expect(workflow).toContain(
      `- name: Create Release Pull Request or Publish\n        if: ${releaseRef} || ${v1Ref}`,
    )
  })

  it('requires full release gates before publishing and preserves v1 behavior', () => {
    expect(workflow).toContain(
      `- name: Run all integration tests\n        if: ${releaseRef}\n        run: bun run test:integration -- --run`,
    )
    expect(workflow).toContain(
      `((${mainRef} || ${releaseRef}) && needs.build-and-test.result == 'success' && needs.integration-tests.result == 'success')`,
    )
    expect(workflow).toContain(
      `(${v1Ref} && ${noChangesets} && needs.build-and-test.result == 'success')`,
    )
    expect(workflow).toContain(
      `- name: Use OIDC-capable npm\n        if: ${mainRef} || ${noChangesets}`,
    )
    expect(workflow).toContain('id-token: write')
  })
})
