---
"@rhinestone/sdk": minor
---

Add JWT authentication support alongside existing API key flow.

- New `auth` config option with `{ mode: 'experimental_jwt', accessToken, getIntentExtensionToken }`
- `createJwtSigner` helper in `@rhinestone/sdk/jwt-server` for same-host RS256 signing
- JCS canonicalization (RFC 8785) and intent input digest computation
- `shouldSponsor` config-based filtering (chain, account, calls predicates) built into `createJwtSigner`
- Framework handler wrappers for Web Standard (`Request`/`Response`) and Express
- `SponsorshipDeniedError` custom error class for typed denial handling
