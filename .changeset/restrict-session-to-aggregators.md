---
'@rhinestone/sdk': major
---

Restrict a smart session to swapping one token for another through named venues. `SessionDefinition` gains `swap`, which compiles to a scoped approve plus one scoped action per venue and drops the wildcard intent-execution fallback, so the session key can only run those calls.

- Name venues, not addresses: `swap: { sell, buy, to, via: [zeroEx({ settler })] }`. Router addresses, selectors and calldata offsets stay inside the SDK. `via` is narrowed by the session's chain, so naming a venue that isn't deployed there is a compile error.
- Naming a venue authorises every call shape it can arrive in — for `zeroEx()` that is the direct `AllowanceHolder.exec` call and the Rhinestone-Swapper-wrapped one, and for `fynd()` the Tycho router call and its wrapped form. Which one the orchestrator emits depends on the swap's direction and the winning quoter, decided after the session is signed, so there is no option to narrow it. `rhinestoneSwap()` is the default and leaves the aggregator unpinned.
- `resolveZeroExSettler(client)` reads 0x's current Settler from its on-chain registry. 0x redeploys the Settler regularly, so there is no bundled default; resolve once and pin at session-enable time.
- `SessionDefinition` also gains `restrictToActions` (the general-purpose primitive `swap` is built on) and `actions` (raw scoped actions for calls the ABI-name `permissions` sugar can't address). A restricted session defaults its ERC-1271 signing surface to disabled, so a session key limited to swap/approve cannot sign approvals off-chain.

Fixes three defects in the ABI-driven `permissions` sugar, each of which produced silently-wrong on-chain policies rather than errors:

- Calldata offsets assumed every parameter occupies one head word, so any parameter following a static tuple or fixed-size array was scoped against unrelated bytes. Offsets are now the sum of ABI head sizes.
- Array parameters (`uint256[]`, `bytes4[]`) typed as constrainable, compiled, then failed at runtime. They are now rejected at the type level.
- `inRange` was offered but could not express two bounds. Replaced with `{ min, max }`, which compiles to `AND(>=, <=)`.
