---
'@rhinestone/sdk': major
---

ESM-only build and trimmed public surface.

- Drop the CommonJS build target.
- `package.json` is now `"type": "module"` with a single `"exports"`
  block resolving to ESM artifacts; `main` and the `require` conditions
  are gone.
- Drop subpackage exports that leaked internal `./dist/src/*` paths.
  Use the curated entry points: `.`, `./actions`, `./actions/*`,
  `./signing/passkeys`, `./errors`, `./utils`, `./smart-sessions`,
  `./jwt-server`.
- Requires a Node / bundler that resolves ESM cleanly. Old CJS
  `require('@rhinestone/sdk')` call sites must move to `import` or use a
  bundler that bridges them.
