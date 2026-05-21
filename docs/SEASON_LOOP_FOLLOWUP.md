# Sæson-loop incident — follow-up handoff

> **Formål:** Komplet kontekst + åbne spørgsmål til en plan-mode session der grundigt skal gennemgå om vi har dækket alle vinkler. Denne fil er en bevidst forenklet "single source" — al detalje ligger i de linkede commits/filer.

**Incident:** 2026-05-21 23:15–23:48 CEST
**Fix deployed:** 2026-05-22 00:10 CEST (Railway), DB-constraint 00:18 CEST
**Status pr. 00:28 CEST:** Sæson 1 aktiv, racing-window urørt, 3 cron-ticks i træk verificeret no-op.

---

## 1. Hvad skete

`processSeasonAutoTransitionCron` fyrede 0→1 korrekt kl 23:15. Derefter triggede en cron-loop: 1→2 (23:25), 2→3 (23:35), 3→4 (23:45) — én ekstra sæson hver 10. minut.

**Rod-årsag:** `insertTransferWindowIfMissing` opretter nyt window med `status='closed'` + `closed_at=null` (racing-window — markedet er lukket under racing-fase). 3 crons (`deadlineDay`, `squadEnforcement`, `seasonAutoTransition`) filtrerede kun på `status='closed'` uden at skelne deadline-lukkede vinduer fra racing-windows. De claimede dermed timestamps på det nyfødte vindue, hvilket gjorde det "fully wrapped" og triggede endnu en transition.

**Akut-stop kl 23:48:** Manuel SQL satte sæson 4='completed' + sæson 4-vinduet wrapped → idempotency-check i auto-transition blokerede yderligere transitions.

**Rollback kl 00:01 + 00:09:** Slet sæson 2/3/4 + 144 ghost finance_transactions + refund 7.67M CZ$. Auto-migrate kørte rollback-scriptet idempotent en ekstra gang (ingen yderligere skade).

---

## 2. 3-lags fix der blev deployet

### Lag 1 — Kode-filter ([2eb1f0d](https://github.com/NicolaiDolmer/CyclingZone/commit/2eb1f0d))
- `backend/lib/seasonAutoTransition.js`: `.not("closed_at", "is", null)` tilføjet til window-query
- `backend/lib/squadEnforcement.js`: samme filter
- `backend/lib/deadlineDayReport.js`: early-return guard `if (!window.closes_at && !window.closed_at) return` i processDeadlineDayCron

### Lag 2 — DB-niveau CHECK constraint ([19a42b3](https://github.com/NicolaiDolmer/CyclingZone/commit/19a42b3))
```sql
CHECK (final_whistle_sent_at IS NULL OR closed_at IS NOT NULL);
CHECK (squad_enforcement_completed_at IS NULL OR closed_at IS NOT NULL);
```
PostgreSQL afviser nu enhver UPDATE der prøver at sætte timestamps på racing-window. Verificeret aktiv via fejl-test (`ERROR 23514 check_violation`).

### Lag 3 — Tests
- 3 regressionstests (én pr. cron) der låser racing-window-guard
- Filter-presence-test der verificerer `closed_at IS NOT NULL` faktisk er i query'en
- 696 backend tests passer

### Bonus-fix
- `admin_log.admin_user_id` gjort nullable — cron-handlinger kan nu logges
- `description` tilføjet til admin_log INSERT i seasonTransition.js
- Forrige incident havde 0 audit-entries fordi INSERT'et fejlede silently

---

## 3. Filer der blev ramt

| Fil | Ændring |
|---|---|
| `backend/lib/seasonAutoTransition.js` | closed_at filter |
| `backend/lib/squadEnforcement.js` | closed_at filter |
| `backend/lib/deadlineDayReport.js` | early-return guard |
| `backend/lib/seasonTransition.js` | admin_log description + null adminUserId |
| `backend/lib/seasonAutoTransition.test.js` | 2 regressionstests + filter-presence-test |
| `backend/lib/squadEnforcement.test.js` | 1 regressionstest + mock-not()-handler |
| `backend/lib/deadlineDayReport.test.js` | 1 regressionstest |
| `database/2026-05-21-admin-log-nullable-user.sql` | Schema migration |
| `database/2026-05-21-season-loop-rollback.sql` | Data rollback |
| `database/2026-05-22-transfer-window-racing-guard.sql` | DB constraint |
| `frontend/src/pages/PatchNotesPage.jsx` | v3.86 patch note |
| `docs/NOW.md` | Incident-status |
| `.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md` | Postmortem |

Commits: [2eb1f0d](https://github.com/NicolaiDolmer/CyclingZone/commit/2eb1f0d), [19a42b3](https://github.com/NicolaiDolmer/CyclingZone/commit/19a42b3), [509a197](https://github.com/NicolaiDolmer/CyclingZone/commit/509a197)

---

## 4. ÅBNE SPØRGSMÅL — gennemgå i plan-mode

### A. Designet er stadig fragilt — bør refactores?

`transfer_windows.status='closed'` har nu 2 implicitte betydninger:
1. **Deadline-lukket** (`status='closed' AND closed_at IS NOT NULL`)
2. **Racing-window** (`status='closed' AND closed_at IS NULL`)

Den oprindelige fælde var at filter assumed kun (1). Vores fix gjorde (1) eksplicit via `closed_at IS NOT NULL`-filter, men selve overload'en består.

**Spørgsmål:**
- Skal vi tilføje en eksplicit status `'racing'` ELLER en bool-kolonne `is_racing_window`?
- Hvis ja: kræver migration på alle eksisterende rows + opdatering af alle queries der bruger status.
- Postmortem foreslår dette som forward-guard, men det er ikke gjort.

### B. Næste rigtige sæson-transition (1→2) er ikke verificeret

Vi rullede sæson 2/3/4 tilbage. Når sæson 1 *faktisk* skal slutte:
1. Admin skal manuelt sætte `closes_at` på sæson 1's vindue (eller via /admin/seasons-UI)
2. Deadline-cron lukker det når `closes_at` er nået
3. Final-whistle cron fyrer
4. Squad-enforcement cron fyrer
5. Auto-transition cron fyrer transition 1→2

**Spørgsmål:**
- Er der en eksisterende admin-UI til at sætte closes_at? (Check `AdminPage.jsx` + relaterede)
- Hvad er den intenderede UX — manuel close-tid eller scheduled?
- Skal vi end-to-end-teste dette flow i staging FØR sæson 1 slutter for rigtig?

### C. Edge cases der ikke er testet

1. **Admin closer vindue manuelt uden deadline:** Cron-filter matcher hvis `closed_at` sættes. Er det intentionel adfærd?
2. **Race: auto_close + final_whistle samme tick:** processDeadlineDayCron håndterer dette OK (sætter `window.status='closed'` lokalt), men hvad hvis to processer kører samtidigt?
3. **Sponsor-payout idempotens:** Sponsor blev fyret 4 gange for sæson 1-4 ghost-transitions. Var dette idempotent via `processSeasonStart`? Verificér at `processSeasonStart` ikke kan double-paye.
4. **closed_at slettes manuelt:** Hvad sker hvis admin sletter `closed_at` på et lukket vindue? CHECK constraint vil afvise UPDATE *hvis* `final_whistle_sent_at` eller `squad_enforcement_completed_at` er sat. Men hvad om de er null? Verificér intentionel.

### D. Andre crons med samme anti-pattern?

Jeg tjekkede: ingen andre crons har lignende filter-mønster på `transfer_windows.status`. Men:
- `boardAutoAccept` cron bruger `boards`-tabel
- `boardMidSeason` cron bruger `boards`-tabel
- `auctionFinalization` cron bruger `auctions`-tabel
- `debtWarnings` cron bruger `teams`-tabel

**Spørgsmål:** Er der lignende "overload" af status-felter andre steder? Plan-mode bør grep'e efter `status` filters i alle crons og verificere ingen bruger compound implicit assumptions.

### E. Cron-trigger architecture

Cron'erne kører som `setInterval` i Railway-hosted backend Express-proces. Hvis Railway-instansen restartes (deployment, OOM, crash), kan crons fyre overlappende:
- Backend deploy = ny proces = ny `startCron()` kald
- Hvis gammel proces ikke afslutter pænt, kører TO cron-loop samtidigt
- Cron'erne har atomic claims på timestamps, så DB-level idempotent ✓
- Men cron-tick'et er ikke distribueret-lock'et

**Spørgsmål:** Er der risiko for at en deploy mid-tick får uventede konsekvenser? Bør cron flyttes til separat worker / Supabase Edge Function?

### F. Monitorering / observability

Vi havde 30 minutter af loop FØR brugeren spotted det. Forbedringer:
- **Sentry alert** ved unexpected season-transition (>1 transition per 24h)
- **Daily snapshot** der counter total_seasons og advarer hvis det øges (uden admin-handling)
- **Discord-notifikation** ved hver season-transition (currently silent når cron-initieret)

### G. Sæson-transition UX

Den nuværende cron auto-fyrer transitions ~5-15 min efter window-lukke. Det betyder admin ikke har "manuel kontrol" over hvornår sæsonen skifter. Postmortem nævner dette som intentionel design.

**Spørgsmål:**
- Skal admin have et "Confirm transition" step før cron'en fyrer? (Sikkerhedshåndsving)
- ELLER: Skal admin kunne *udsætte* transition (sætte `paused`-status på sæson)?

---

## 5. Aktuel prod-state (verifikations-snapshot)

```
Time:                 2026-05-22 00:28 CEST
Total seasons:        2 (0 completed, 1 active)
Total windows:        2
Active season:        1
S1 window timestamps: closes_at=null, closed_at=null, fw=null, sq=null (RACING)
Cron ticks no-op:     3 (00:15, 00:20, 00:25)
Ghost finance:        0 transactions
Negative balances:    0 teams
Frozen teams:         4 (Inuit Cycling + 3 test-hold, alle på 800K, 0 ryttere) ← uændret
```

**Aktive holdes balancer (post-rollback):** Spænd 156K (Groupama-FDJ) → 583K (Swatt Team). Pre-loop forventning fra pc2-rapport var spænd 144K-755K, men det inkluderede sæson 2's finance. Vores post-rollback state er rent post-sæson-1 — som forventet.

---

## 6. Forslag til plan-mode session

**Prioritet 1 — Verificér det fundament er solidt:**
1. Læs postmortem ([.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md](.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md))
2. Læs commit-diffs ([2eb1f0d](https://github.com/NicolaiDolmer/CyclingZone/commit/2eb1f0d), [19a42b3](https://github.com/NicolaiDolmer/CyclingZone/commit/19a42b3))
3. Tjek aktuel prod-state (sektion 5)
4. Verificér 3 cron-ticks i træk er no-ops siden 00:25 (forventes når plan-mode kører)

**Prioritet 2 — Drøft åbne spørgsmål A-G (sektion 4) en for en:**
- Hvilke skal addresseres NU vs senere?
- Hvilke kan parkeres som backlog?
- Tag beslutning på A (status-overload refactor) — det er den største design-skuld.

**Prioritet 3 — Test plan for sæson 1 → 2:**
- Skitser end-to-end test af det fulde flow
- Foreslå om vi laver staging-test før sæson 1 slutter
- Lav checklist for hvad admin skal gøre næste gang

**Prioritet 4 — Monitorering:**
- Foreslå konkret Sentry-alert eller Discord-webhook
- Skitser daglig sæson-count-snapshot

---

## 7. Memory + dokumentation

- HOT memory ikke opdateret (postmortem dækker læringen)
- WARM memory: ingen nye entries
- Postmortem: [`.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md`](.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md)
- NOW.md: header opdateret med incident-status

**Hvad plan-mode bør sikre er reflekteret før session-close:**
- Eventuelle nye beslutninger i postmortem (Follow-up sektion)
- Status-overload-decision i `docs/decisions/` hvis A besluttes
- Test-plan i `docs/TEST_SCENARIOS.md` for sæson-transition flow
- Linkede issues i GitHub for parkeret arbejde
