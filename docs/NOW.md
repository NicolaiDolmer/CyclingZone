# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Ingen** — Dark Mode S3 lint-guard lukket. Næste valg: Onboarding v2 eller anden post-launch slice.

## Soak-gate
**Aktiv: ja** — 8 user-facing slices uden e2e-smoke (Deadline Day S1–S4, Dark Mode S1+S2+S3-fixes, S8 Discord DM). Sprunget over på brugerens anmodning denne session. Næste session skal starte med 30-60 min smoke i light + dark FØR ny kode-slice startes.

## Open beta status
**Alle 7 launch-gates ✅** — soft-launch-klar.

## Senest leveret
- 2026-05-03: **Dark mode S3 lint-guard** (v2.08) — ESLint `no-restricted-syntax` mod `(slate|gray)-N` i `frontend/eslint.config.js` (Literal + TemplateElement); migration-misser ryddet i `PotentialeStars.jsx` + `statBg.js`. Scope `.{js,jsx}` via dedikeret config-block, pre-eksisterende react-rules forbliver `.js`-only.
- 2026-05-03: **Discord-privatliv-fix** (v2.07) — `notifyOutbid`/`notifyAuctionWon`/`notifyTransferOffer`/`notifyTransferResponse` er nu DM-only; ingen længere @mention med privat info i fælleskanal. `getDiscordId` og `buildEmbed.discordId` fjernet som dead code.
- 2026-05-03: **Dark mode S2** (v2.06) — 27 pages + 7 components tokeniseret; ældre historik i `docs/archive/NOW_HISTORIK_2026-05-03.md`

## Næste session — prioriteter
1. **Soak-gate kvittering** — kør 30-60 min e2e smoke i light + dark på top-flows
2. **JSX react-rules sanitering** — 71 pre-eks. react-fejl i .jsx (no-empty, no-unescaped-entities, react-hooks/immutability) skal saneres så `js,jsx`-scope kan løftes på alle rules
3. Vælg næste slice: **Onboarding v2** (post-launch retention)
4. Tjek at de 3 managers med username-format discord_id ser røde warning-badge

## Kritiske invarianter
- Discord DM-fejl må aldrig blokere transaction (best-effort try/catch i `notifyDiscordDM`)
- `users.discord_dm_enabled=false` skipper DM uden at logge fejl; @mention i kanal sker stadig
- Discord-ID validering: 17-19 cifre, kun tal — håndhævet ved save i ProfilePage
- `/profile` → `ProfilePage` (indstillinger) — `ManagerProfilePage` er read-only view
- Economy v1.76: `SALARY_RATE = 0.10`, sponsor 260K, gældsloft D1/D2/D3 = 1200K/900K/600K
- `applyRaceResults` udbetaler IKKE præmier — kun via `prizePayoutEngine.paySeasonPrizesToDate`
- NOW.md: maks 30 linjer — flyt historik til `docs/archive/` i samme session som arbejdet lukkes
