# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Roadmap & docs-leverance (planlægnings-session, ingen kode-ændringer).** Leveret komplet pre-launch master-plan: 6 P0-slices + ~15 P1-tasks + 9 AI-loops + opdateret AGENTS-koordinering. Audit fundet at ~10 antagede TODO'er allerede er live (hele IA-restruktureringen, achievement-fix, head-to-head default, notif-tæller, rytter-rangliste). Scope reduceret med ~30% efter runtime-verifikation.

## Soak-gate
**Aktiv: nej** — kvitteret 2026-05-04.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar. **Launch-dato: åben** (kvalitet > deadline besluttet 2026-05-04).

## Senest leveret
- 2026-05-04: **Roadmap & docs-leverance** — `LAUNCH_ROADMAP.md`, `PUBLIC_ROADMAP.md`, 6 slice-briefs i `docs/slices/`, `AI_LOOPS.md`, opdateret `AGENTS.md`, postmortem-skabelon + første læring i `.claude/learnings/`. Ingen kode rørt.
- 2026-05-04: **Lint-baseline ryddet** (v2.24.1) — 24 unused-vars fjernet på tværs af 14 filer
- 2026-05-04: **S8.5 Import-feedback UI** (v2.24) + **v2.23.1 polish** + **S9b Sæson-snapshot** (v2.23) + **S9a Løb-hub** (v2.22)
- Ældre → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **S-01 Salary GENERATED column** (P0, ~1 session) — eliminer 10/15-konflikten permanent. Se `docs/slices/01-salary-generated-column.md`.
2. Derefter S-04 Admin-cancel + S-06 Webhook-smoke (korte P0'er, ryd småt)
3. Se `docs/LAUNCH_ROADMAP.md` for fuld session-rækkefølge

## Kritiske invarianter
- **Verificér runtime FØR claim** (etableret 2026-05-04) — grep koden før du listet noget som TODO/bug
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- **`marketUtils.js:47` har 15%-konflikt** — fixes i S-01 (GENERATED column eliminerer dual-formula permanent)
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- Squad limits: D1 20-30, D2 14-20, D3 8-10 — håndhæves S-03
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
