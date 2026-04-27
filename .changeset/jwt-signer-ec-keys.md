---
"@rhinestone/sdk": patch
---

Support EC JWKs in `createJwtSigner`. The JWS algorithm is now derived from the supplied JWK (`P-256` → `ES256`, `P-384` → `ES384`, `P-521` → `ES512`); RSA keys continue to sign as `RS256`. Unsupported `kty`/`crv` combinations throw at signer construction.
