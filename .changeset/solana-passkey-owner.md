---
'@rhinestone/sdk': minor
---

Let a passkey own a managed Solana account: configure `solana: { owner: { type: 'passkey', account } }` with a viem `WebAuthnAccount`, beside the existing ECDSA owner.

- The orchestrator receives the passkey's compressed P-256 public key as the Swig authority.
- `signTransaction` signs the quote's WebAuthn challenge with the passkey and returns a `webauthn` proof, which `submitTransaction` sends. The assertion's challenge, `webauthn.get` type and signature length are checked before it leaves the SDK; the orchestrator verifies the signature itself.
- A Swig role in `SigningAuthority`, and the Swig account in a plan, can now name a `secp256r1` authority. For a passkey owner, `PreparedTransactionData.execution.authority` is the compressed public key.
