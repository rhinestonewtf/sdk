---
'@rhinestone/sdk': minor
---

Default `policyAddresses.oneTimeUseId` to the deployed `OneTimeUseIdPolicy` for the session's chain, so a `oneTimeUse` session does not have to pass it: `0x630CEbCf54C7471154CF659088CC4197872Cf5FD` on production contracts, and `0x86F7cB4E25626d6a07cfED305c38816F30d07224` with `useDevContracts`. A session that uses the default resolves to the same session data, permission id and burn call as one that passes that address explicitly.

On a chain where the policy is not deployed, resolving the session throws an error that names the chain. Pass `policyAddresses.oneTimeUseId` to use another deployment; an explicit address always takes precedence. Sessions without `oneTimeUse` are unchanged.
