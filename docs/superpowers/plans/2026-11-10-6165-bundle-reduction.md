# #6165 — measured invisible bundle reduction

Mandate: owner [9 November](https://github.com/NicolaiDolmer/CyclingZone/issues/6165#issuecomment-6741975713), [night queue](https://github.com/NicolaiDolmer/CyclingZone/issues/7911#issuecomment-6748409421), and the dispatched 10 November lane brief. Only invisible import/chunk changes; preserve chart rendering, interactions, languages and dependencies. Parent owns review, commit, push, full verification and release. Refs #6165.

## Baseline and constraints

- Source: `6c52c88f258c7a997157a6477e3be2ff0280700d`; clean assigned worktree.
- Frontend lock SHA-256: `31d4730c51eb6b429aeedb598a4c1709cc0eccfbdda8de2ef464666d1762b966`, matching the cache junction. No dependency installation or lock changes.
- SSOT: `docs/ARCHITECTURE.md` (frontend stack); `docs/AI_OPS_REFERENCE.md` (existing total perf gate). `frontend/middleware.ts` routes anonymous `/` to the separate marketing project. SPA graph measurements are not marketing network evidence.
- Keep the existing total gate and margin. Do not invent route thresholds or raise any budget.
- Build through `scripts/verify-lock.ps1 -Max 2 -Runtime codex`; clear process-local `SENTRY_*` and `CZ_SENTRY_TRANSFORM`; invoke Vite client build directly with `--manifest`. Do not invoke the composite build/upload script.

## Sequential technical experiments

1. Build unchanged source into the lane scratch directory and retain its manifest/assets. Measure gzip level 9, total under the existing locale rule, static entry/Layout/Dashboard/admin/finance closures, and chart modules.
2. Inspect actual emitted module attribution. Test direct ESM imports only if they eliminate emitted code. Alternatively test grouping chart code already common to the same consumers, comparing both total and route closures. Reject changes that merely rename/move bytes or worsen initial loading.
3. Keep only measured reductions that preserve the same installed implementations. Compare chart visuals and interactions using synthetic, fixed-clock fixtures in a targeted browser test. Survey charts remain part of parity coverage even though their implementation is already SVG/CSS.
4. Record exact before/after commands, source and lock identity, byte deltas, causal evidence, limitations and marketing status in `docs/investigations/2026-11-10-6165-before-after.md`.
5. Run targeted validation only; hand off stable files without commit/push/PR. No player text, feature registry, NOW or MASTERPLAN changes. No patch note for an invisible implementation change.

If no safe reduction is found, retain the measured investigation rather than changing a threshold or removing behavior. Marketing dependencies are absent in this worktree; installation is forbidden by the brief, so local marketing build measurements require parent follow-up with an existing matching cache.

## Worker result

Completed a small import-only slice: 709 fewer gzip9 client bytes, with budget
unchanged. Direct ESM imports require `ssr.noExternal: ["recharts"]`; the Node
failure was reproduced and the SSR counterpart verified. Stable chart parity
passed 24 desktop/mobile cases; targeted units, lint, compiler gates, client
builds and SSR smoke passed. Anonymous marketing network was sampled separately
in a fresh read-only browser session. Historical old-lock attribution and the
issue's new budget model remain unfulfilled. Full measurements, caveats and
parent handoff are in `docs/investigations/2026-11-10-6165-before-after.md`.
No commit, push or PR: parent review remains the next gate.
