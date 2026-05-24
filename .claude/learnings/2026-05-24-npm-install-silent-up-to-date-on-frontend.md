# `npm install` lyver med "up to date" — kun `npm ci` er pålidelig efter git pull

**Dato:** 2026-05-24
**Issues:** [#616](https://github.com/NicolaiDolmer/CyclingZone/issues/616), [#618](https://github.com/NicolaiDolmer/CyclingZone/issues/618)
**Berørte sessions:** 2026-05-24-G (cron-audit follow-up opdagede #616 på PC1), 2026-05-24-H (PC2 dep-sync), 2026-05-24-I (PC1 forward-guard)

## Hvad skete der

PR #579 (`fix(api): IPv6-safe rate-limit keyGenerator`) merged 2026-05-24 og bumpede `express-rate-limit` fra 7.5.1 → 8.5.2 (kræver `ipKeyGenerator` named export).

På 2 af 2 lokale dev-PCs (PC1 og PC2) fejlede `backend/lib/rateLimiters.test.js` efter pull:

```
SyntaxError: The requested module 'express-rate-limit' does not provide an export named 'ipKeyGenerator'
```

CI bestod fordi CI gør fresh `npm install` per run.

### PC2 audit (Session H)

`npm install --prefix backend` fixed rateLimiters. Men bredere audit afslørede:
- Root `node_modules` aldrig installeret på PC2 (39 pakker manglede: `@supabase/*`, `dotenv`, `lint-staged`)
- Frontend havde 4 direkte deps 1-3 patches bagud lockfile (`eslint`, `postcss`, `vite`, `@supabase/supabase-js`)
- **`npm install --prefix frontend` rapporterede misvisende `up to date, audited 405 packages in 2s`** mens disse 4 var bagud
- Kun `npm ci --prefix frontend` fixede det

### PC1 audit (Session I)

Da install-parity check blev bygget, opdagede den at PC1 også havde drift:
- Root: 11 missing direct deps (samme som PC2 — root aldrig installeret) + `lint-staged 17.0.2` vs lock `17.0.5`
- **`frontend/node_modules/` eksisterede som tomt directory** (`test -d` passerede, men 0 filer i den)
- `npm ci --dry-run --prefix frontend` rapporterede success med pakke-count men opdagede ikke tom-dir-tilstanden

## Root cause

Tre kombinerede problemer:

1. **`npm install` har ingen verifikation efter pull.** Hvis dependabot bumper både `package.json` og lockfile på remote, men brugeren ikke kører `npm install` lokalt, så fortsætter dev-PC med stale `node_modules`. Tests der bruger nye exports bryder.
2. **`npm install` (uden `ci`) opdaterer ikke deps der allerede har en kompatibel installeret version.** En direct dep pinnet til `^10.0.0` med installeret `10.0.1` vil ikke bumpes til lockfile-pinnede `10.4.0` — npm anser begge for "fine" inden for spec, og `package.json`'s range vinder over lockfile. Eneste pålidelige sync: `npm ci` (som sletter `node_modules` og re-installerer fra lockfile).
3. **`test -d node_modules` er ikke tilstrækkelig som health-check.** Et tomt directory beståede check'et men havde 0 pakker. Drift-detection skal verificere package-by-package mod `node_modules/<name>/package.json`.

## Forward-guards (implementeret i #618)

1. **`npm run sync-deps`** — root script der kører `npm ci` på alle 3 workspaces. Eneste pålidelige sync efter pull der rør ved lockfiles.
2. **`scripts/agent-doctor.ps1` install-parity check** — sammenligner lockfile vs installed direct deps på tværs af root/backend/frontend. Skipper platform-mismatched optional deps (linux/darwin binaries på win32). Foreslår `npm run sync-deps` i WARN-detail.
3. **CLAUDE.md startup-rutine** opdateret med eksplicit pre-flight: "Efter `git pull` der rør ved en `*package-lock.json` → kør `npm run sync-deps`".
4. **Per-PC snapshots** i `docs/metrics/install-snapshot-{NicolaiPC,EmmaPC}.json` med lockfile_sha256 + direct_deps_installed. Re-genereres efter dep-bumps og diff'es ved cross-PC pickup.

## Hvorfor ikke auto-install post-merge hook (Niveau 3)?

`npm ci --prefix frontend` tager ~22 sek på PC2. Pre-pull/post-merge auto-install ville overraske brugeren ved hvert pull (især pull der ikke rør deps). Eksplicit `npm run sync-deps` + doctor-WARN er bedre UX.

## Anti-pattern at undgå

- **`npm install` efter pull** når lockfile har ændret sig — bruger næsten altid eksisterende `node_modules` og lyver om "up to date". Use `npm ci`.
- **`test -d node_modules`** som health-check — passerer tomme dir'er. Use pakke-by-pakke compare.
- **`npm ci --dry-run`** som drift-detection — opdager ikke alle scenarier (tom-dir false-positive på PC1).
- **Stole på CI alene** for dep-sync — CI roder ikke med lokale env'er hvor dev sker.

## Beslægtede
- [`2026-05-23-supabase-status-must-match-check.md`](2026-05-23-supabase-status-must-match-check.md) — "status er ikke lig faktisk tilstand" pattern (samme klasse)
- [`2026-05-22-pc2-residual-state.md`](2026-05-22-pc2-residual-state.md) — cross-PC handoff er ikke envejs (samme klasse)
