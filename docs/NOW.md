# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen** — Panic Board synlighed + tema-fix (v2.09) lukket. Næste valg: Onboarding v2 eller anden post-launch slice.

## Soak-gate
**Aktiv: delvis** — Dark mode ✅ smoke OK · Discord DM ✅ verificeret · Deadline Day S1–S4: kun Panic Board smokes til dato (afslørede manglende nav-link + light-mode contrast — fixet i v2.09). S1 banner / S2 ticker / S3 flash-auctions / S4 Final Whistle-cron stadig ikke smokes.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **Panic Board fix** (v2.09) — `/deadline-day` nav-link tilføjet under Marked; DeadlineDayBoard tokeniseret (`text-white/N`, `border-white/N`, hardcoded `#e8c547` → `cz-1/2/3` + `cz-border` + `cz-subtle` + semantiske status-tokens). Afsløret af manuel smoke.
- 2026-05-03: **Dark mode S3 lint-guard** (v2.08) — ESLint mod `(slate|gray)-N` i `frontend/eslint.config.js`. **Hul:** guard fanger ikke `text-white/N` eller `border-white/N` — det slap igennem til Panic Board.
- 2026-05-03: **Discord-privatliv-fix** (v2.07) — DM-only for outbid/won/transfer-offer/response. Smoket: ✅
- Ældre v2.06 og før → `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Færdiggør Deadline Day soak** — S1 banner-faser, S2 ticker, S3 flash-auctions, S4 cron + Final Whistle
2. **Lint-guard udvidelse** — udvid `no-restricted-syntax` til `(white|black)/N` opacity-classes så hardcoded dark-only sider ikke slipper igennem
3. **JSX react-rules sanitering** — 71 pre-eks. react-fejl i .jsx skal saneres så `js,jsx`-scope kan løftes på alle rules
4. Vælg næste slice: **Onboarding v2** (post-launch retention)

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
