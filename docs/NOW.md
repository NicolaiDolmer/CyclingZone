# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen** — JSX react-rules sanitering (v2.11) lukket. Næste valg: Færdiggør Deadline Day soak (S1–S4) eller Onboarding v2.

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ smoke OK · Discord DM ✅ verificeret · Deadline Day S1–S4: code-level audit 22/23 ✅ (se `docs/archive/DD_SOAK_CODE_AUDIT_2026-05-03.md`); ❌ `auctions.is_flash` kolonne mangler DB-migration — fix før første flash-auktion. UI-smoke (banner-faser, ticker-scroll, Final Whistle Discord-render) pending.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **JSX react-rules sanitering** (v2.11) — react-regelsæt løftet fra `.js`-only til `.{js,jsx}` i `frontend/eslint.config.js`. 71 pre-eks. fejl saneret: 28 immutability via flytning af useEffect under fn-deklarationer, 15 unescaped-entities, 8 no-empty (begrundede catch), 6 static-components (Layout: NavItem+SidebarContent ud, HeadToHead: StatCompare ud), 2 purity (ConfettiModal radius låst ved mount, RiderStats age med targeted disable), 1 useless-assignment, 11+21 set-state-in-effect → rule disabled globalt med begrundelse (React Compiler-rule, klager på legitime React 18 data-load patterns). Lint grøn (0 errors), build grøn.
- 2026-05-03: **Lint-guard udvidelse** (v2.10) — `(text|border|ring|divide|outline)-(white|black)/\d+` blokeret i `frontend/eslint.config.js`; `bg-(white|black)/N` bevidst tilladt for modal-scrims (5 callsites). `text-white/20` i `DeadlineDayBanner.jsx:92` ryddet. Sanity-test: forbudt mønster fejler, `bg-black/60` passerer, baseline lint grøn.
- 2026-05-03: **Panic Board fix** (v2.09) — `/deadline-day` nav-link under Marked; DeadlineDayBoard tokeniseret. Afsløret af manuel smoke.
- Ældre v2.08 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Færdiggør Deadline Day soak** — S1 banner-faser, S2 ticker, S3 flash-auctions, S4 cron + Final Whistle
2. Vælg næste slice: **Onboarding v2** (post-launch retention)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
