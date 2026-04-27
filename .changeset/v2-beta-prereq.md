---
'@rhinestone/sdk': major
---

ESM-only build and trimmed public surface.

The SDK no longer ships a CommonJS build. `package.json` is now
`"type": "module"` with a single `"exports"` block that resolves to ESM
artifacts; `main` and the `require` conditions have been removed.

Subpackage exports that leaked internal `./dist/src/*` paths have been
dropped. Consumers should import from the curated entry points (`.`,
`./actions`, `./actions/*`, `./signing/passkeys`, `./errors`, `./utils`,
`./smart-sessions`, `./jwt-server`).

Tooling implications: requires a Node / bundler that resolves ESM cleanly.
Old CJS `require('@rhinestone/sdk')` call sites must move to `import` or
use a bundler that bridges them.
