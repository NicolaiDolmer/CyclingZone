# NOW — Aktuel arbejdsstatus

## Aktiv slice
**Slice 09 — Race-pool katalog LIVE som v2.99 ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242))**. 97 løb er seedet i prod. Admin skal stadig vælge sæson 1-kalenderen via `Race-katalog` på `/admin`; klik ikke `Sæson-cyklus` før sæsonstart omkring 2026-05-15.

## Senest leveret
- 2026-05-12: **Scaling Session 2: AI-Autopilot Fase 2 LIVE** — `ci.yml` opdateret med spec-reportere. `AGENTS.md` og `GUARDRAILS_CORE.md` opdateret med Manus-orkestrerings-regler (Loop D/F). Slice 08 etableret.
- 2026-05-12: **Scaling Session 1: Bulletproof Baseline LIVE** — Loop A (Drift-monitor) implementeret i `backend/scripts/driftMonitor.js`. GitHub Action opsat til daglig kørsel kl. 03:00 UTC. GitHub labels og issues triaged for skalerings-roadmap. `AGENTS.md` opdateret med Verdensklasse AI-Standard.
- 2026-05-12: **#63 /compare opdagelig som v3.24** — `RiderComparePage` accepterer nu deep-link via `?ids=uuid1,uuid2,...`.
- 2026-05-12: **#316 TeamLink-rollout LIVE som v3.23** — `TeamLink`-komponenten rullet ud på alle 8 sider.

## Næste session (prioriteret)
1. **Sæson 1 race-udvælgelse på /admin** ([#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242)) — vælg sæson 1, race-dage 60, generér forslag, gem. **Deadline ~2026-05-15.**
2. **Sæson 1 LIVE-handling ca. 2026-05-15** — efter race-kalender er gemt: `/admin` → `Sæson-cyklus` → `Udfør sæsonskifte`.
3. **[#316](https://github.com/NicolaiDolmer/CyclingZone/issues/316) TeamLink-rollout** — brug `TeamLink`-komponent på 8 sider.
4. **[#127](https://github.com/NicolaiDolmer/CyclingZone/pull/127) dotenv-bump genoptages efter launch** — `post-launch` label, åbnes ~2026-05-14+.
5. **Skalerings-Fase 2: AI-Autopilot** — Automatiserede tests ved hvert push og fjernelse af OneDrive-afhængighed til secrets.

## Skalerings-Roadmap (Mod 100+ brugere)
- [x] **Fase 1: Bulletproof Baseline** — Loop A (Drift-monitor) aktiv. Ingen trial-risici (Vercel/Supabase monitorering).
- [x] **Fase 2: AI-Autopilot** — Automatiserede tests ved hvert push. Manus-orkestreret workflow.
- [ ] **Fase 3: Professional Secret Management** — Flyt fra OneDrive hardlinks til Infisical eller Supabase Vault.
- [ ] **Fase 4: UX-Insight** — Loop I (Clarity) aktiv for at fange 100-bruger feedback.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
