---
'@rhinestone/sdk': major
---

Trim the selectable account `version` values to the supported set. Nexus keeps `1.2.0` and `1.2.1` (default `1.2.1`); Kernel keeps `3.3`. Removed Nexus `1.0.2`, `rhinestone-1.0.0-beta`, and `rhinestone-1.0.0`, and Kernel `3.1` and `3.2`. If you pinned a removed version, omit `version` to use the default or pin a supported one.
