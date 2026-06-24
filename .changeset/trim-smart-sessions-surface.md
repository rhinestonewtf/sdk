---
'@rhinestone/sdk': major
---

Trim the `@rhinestone/sdk/smart-sessions` subpath to a curated public surface. It now exports only `toSession`, `SMART_SESSION_EMISSARY_ADDRESS`, the policy address constants (`SPENDING_LIMITS_POLICY_ADDRESS`, `TIME_FRAME_POLICY_ADDRESS`, `SUDO_POLICY_ADDRESS`, `UNIVERSAL_ACTION_POLICY_ADDRESS`, `ARG_POLICY_ADDRESS`, `USAGE_LIMIT_POLICY_ADDRESS`, `VALUE_LIMIT_POLICY_ADDRESS`, `INTENT_EXECUTION_POLICY_ADDRESS`), and the `SessionDetails` and `ChainDigest` types. The remaining low-level helpers, constants, and types that the subpath previously re-exported are now internal. Use the account's `experimental_*` methods and the `@rhinestone/sdk/actions/smart-sessions` actions instead.
