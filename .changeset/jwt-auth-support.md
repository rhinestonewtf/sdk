---
"@rhinestone/sdk": minor
---

Add JWT authentication support alongside existing API key flow. New `auth` config option accepts `{ mode: 'experimental_jwt', accessToken, getIntentExtensionToken }` for fine-grained token-based access control. Includes `createJwtSigner` helper in `@rhinestone/sdk/jwt-server` subpath for same-host RS256 signing, JCS canonicalization (RFC 8785), and intent input digest computation for sponsored intent extension tokens.
