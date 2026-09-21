---
'@rhinestone/sdk': minor
---

Let a passkey own a development managed Solana account: configure `solana: { owner: { type: 'passkey', account } }` with a viem `WebAuthnAccount`, beside the existing ECDSA owner.

- The Swig is still the one derived from the managed EVM account; the orchestrator is told its authority is the passkey's compressed P-256 public key.
- `signTransaction` signs the quote's WebAuthn challenge with the passkey and returns a `webauthn` proof, which `submitTransaction` sends. The assertion's challenge, `webauthn.get` type and P-256 signature are checked locally before it leaves the SDK.
- A Swig role in `SigningAuthority`, and the Swig account in a plan, can now name a `secp256r1` authority. For a passkey owner, `PreparedTransactionData.execution.authority` is the compressed public key.
