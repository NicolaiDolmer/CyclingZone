# NOW — Aktuel arbejdsstatus

## Aktiv slice
**AI/Ops audit follow-up er dokumenteret.** Claude-feedbacken er omsat til konkrete ADR-/ops-leverancer i stedet for en ny bred audit.

## Senest leveret
- 2026-05-14: **Audit-feedback follow-up** — `docs/decisions/cache-adr.md` vælger Upstash Redis som første shared cache/rate-limit store for #334; `docs/AI_OPS_COST_MODEL.md` giver 5k/10k cost baseline for #332; `docs/AI_OPS_BLIND_SPOTS.md` samler restore-cadence, P95-SLO, fail-open/fail-closed og cache/realtime-risici; `docs/decisions/secret-management-adr.md` er verificeret mod #327/#339 og præciserer at Infisical allerede er valgt.
- 2026-05-14: Live-kvalitetsaudit bekræftede PR #350 Speed Insights og PR #351 GSC verification; CI/CodeQL/gitleaks/deploy-verify grønne på main, prod smoke OK, `agent-doctor.ps1 -Json` viste `0 fail`, og #353 blev oprettet for manuel Speed Insights aktivering + vitals/consent verifikation.
- 2026-05-13: **Zero-known-error hardening LIVE** — PR #345 merged; Drift Monitor, Quality Inbox, CI, CodeQL, Secret Scan og Deploy verify er grønne på main efter hotfix commits `03cd64f`, `3456c79`, `2b43a07`.

## Næste session (prioriteret)
1. Vælg cold-start: **#334 implementering** (`cache-adr.md` Phase 0–1: P95 baseline + Redis-backed rate-limit store bag env flags) eller **#332 ops-hardening** (`AI_OPS_BLIND_SPOTS.md`: restore-drill runbook + første restore-test plan).
2. Rotér lokal `backend/.env` service-key til `sb_secret_*` ([#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337)) og aktivér Sentry secrets/test-events ([#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348)).
3. **[#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) Infisical Phase 1 manuel** — Nicolai opretter dashboard + indtaster secrets når der er tid.
4. Ryd quality-net follow-ups: Deploy verify runner/provider-status ([#347](https://github.com/NicolaiDolmer/CyclingZone/issues/347)), Quality Inbox warning calibration ([#346](https://github.com/NicolaiDolmer/CyclingZone/issues/346)), gitleaks Node 20 deprecation ([#349](https://github.com/NicolaiDolmer/CyclingZone/issues/349)) og Speed Insights follow-up ([#353](https://github.com/NicolaiDolmer/CyclingZone/issues/353)).

## Skalerings-roadmap mod 100+ brugere
- [x] **Fase 1: Bulletproof Baseline** — Loop A aktiv, zero-known-error hardening live.
- [x] **Fase 2: AI-Autopilot** — automatiserede tests ved hvert push; audit-feedback nu omsat til ADR/cost/blind-spots.
- [ ] **Fase 3: Professional Secret Management + Cache/Realtime scaling** — #339 manuel Infisical setup, #334 cache-ADR godkendelse/implementering, #333 Realtime primær kanal.
- [ ] **Fase 4: Ops maturity** — #332 restore-drills, incident playbook, backups og cost-review cadence.

## Kritiske invarianter
- Verificér runtime før claims; runtime > docs.
- Economy: DEFAULT_BETA_BALANCE=800000, sponsor=240000, SALARY_RATE=0.10, gældsloft D1/D2/D3=1.2M/900K/600K.
- Auction finalization har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js`.
- AI/bank/frozen får aldrig board-state; manager-only.
- Admin-resultatupload: `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.
