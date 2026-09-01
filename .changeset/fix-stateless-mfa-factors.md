---
"@rhinestone/sdk": patch
---

Fix passkey and ENS validators nested under multi-factor owners by using their stateless configuration and signature formats. Counterfactual addresses change for multi-factor accounts containing passkey or ENS factors; direct passkey and ENS owners and ECDSA-only multi-factor accounts remain unchanged. Deployed accounts can replace affected factors with `mfa.setSubValidator`; ENS expiration is not enforced for nested factors.
