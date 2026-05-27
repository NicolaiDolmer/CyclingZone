# P1 Smoke & Strategy Session — CyclingZone

**Dato:** 2026-05-27
**Udarbejdet af:** Manus AI
**Indsat af:** Codex, efter runtime/GitHub-sammenligning 2026-05-27
**Kontekst:** Audit af `LAUNCH_ROADMAP.md`, nylige commits og åbne issues #701, #702 og #705 for at prioritere næste skridt mod stabil launch.

## Status & Audit Af Nylige Ændringer

Loop A/B/C er implementeret og runtime-verificeret mod repo-filer:

- **Loop A · Drift-monitor cron:** `backend/scripts/driftMonitor.js` og `.github/workflows/drift-monitor.yml` findes. Workflow kører dagligt kl. 03:00 UTC og kan dispatches manuelt.
- **Loop B · Pre-push hook:** `scripts/pre-push-hook.ps1` findes, og lokal `.git/hooks/pre-push` kalder scriptet.
- **Loop C · Postmortem-loop:** `.claude/learnings/_TEMPLATE.md` findes, og `.claude/learnings/2026-05-27-uci-scraper-decimal-points-bug.md` viser loopet i aktiv brug.

P0-slices S-01 til S-06 er fortsat markeret leveret i `docs/LAUNCH_ROADMAP.md`.

## Kritiske Åbne Issues

### #705 · SUPABASE_SERVICE_KEY "Legacy API keys are disabled"

Topprioritet. Hvis Railway/Vercel prod-backend bruger en legacy JWT service key, kan service-role backend-flows fejle bredt.

**Næste handling:** Verificer Railway/Vercel prod-env. Hvis prod bruger legacy key og er ramt, roter via Supabase dashboard og synkroniser Infisical/Railway/Vercel/GitHub Actions.

### #702 · UCI Safety-Gate For Matched-With-Zero

Root-cause follow-up fra UCI scraper decimal-points buggen: high-value-gaten beskyttede `not_found`, men ikke ryttere der blev matchet til `0` point.

**Næste handling:** Opdater `scripts/uci_scraper.py` i `sync_supabase`, så `matched-with-zero` eller `<= MIN_UCI_POINTS` for high-value ryttere behandles som protected not-found. Issue #702 har allerede konkret patch-retning og testnavn.

### #701 · UCI Backup-Trigger Og Stale-Data Monitoring

GitHub Actions schedule har været upålidelig for UCI sync. Vi skal opdage stale data før spillere gør det.

**Næste handling:** Implementer backup-trigger og monitor på `MAX(synced_at)` fra `rider_uci_history`, med alert hvis data er mere end 8 dage gammel.

## Prioriteret Sessionsrækkefølge

1. **Akut infra & data-safety:** #705 → #702 → #701.
2. **P1 Smoke & verifikation / Tier 1A:** Onboarding v2 e2e-smoke, patch notes/FAQ-audit, admin-audit, TeamPage-audit og TeamProfilePage-audit.
3. **P1 polish / Tier 1B:** stat color consistency, online/last-seen visibility og Point→Værdi label sweep.
4. **P1 transferhistorik / Tier 1C:** dedikeret `/transfer-history`, team-historik og rytterhistorik.

## Konklusion

Loop A/B/C løfter robustheden, men UCI scraper incidenten viser, at de næste launch-risici er data-safety og prod-secret-verifikation. Før næste brede P1 smoke-session bør #705, #702 og #701 håndteres i den rækkefølge.
