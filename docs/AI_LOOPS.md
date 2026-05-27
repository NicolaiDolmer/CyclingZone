# AI LOOPS — Selvforbedrende automation

_Beskriver eksekverbare loops der får systemet til at finde fejl, rette fejl og forhindre at samme fejl sker igen. Hver loop kan implementeres som dedikeret slice af en fremtidig session uden ekstra afklaring._

_Token-disciplin: Loops er beskrevet kompakt. Ved implementering: læs slice-doc + relevante filer, ikke hele AI_LOOPS.md._

---

## Loop A · Drift-monitor cron

**Hvorfor:** Salary-buggen ramte os flere gange (v1.46, v1.91-1.93, v2.05, v2.24). Hver gang opdaget af bruger, ikke af system. Drift-monitor fanger samme klasse fejl indenfor 24 timer.

**Trigger:** Cron, dagligt 03:00 UTC.

**Implementation:**
1. Ny `backend/scripts/driftMonitor.js`:
   - Tjek 1 — Salary-konsistens (SHOULD bli redundant efter S-01 GENERATED-column, men beholdes som safety):
     ```sql
     SELECT COUNT(*) FROM riders 
     WHERE salary != ROUND(GREATEST((GREATEST(uci_points, 5) * 4000 + COALESCE(prize_earnings_bonus, 0)) * 0.10), 1);
     ```
   - Tjek 2 — Squad-limit-violation (managers der står ulovligt udenfor transfervindue):
     ```sql
     SELECT t.id, t.name, t.division, COUNT(r.id) AS rider_count, ml.min, ml.max
     FROM teams t LEFT JOIN riders r ON r.team_id = t.id
     ...
     ```
   - Tjek 3 — Board-modifier-bounds (modifier i `board_profiles` skal være mellem 0.7 og 1.3):
     ```sql
     SELECT COUNT(*) FROM board_profiles WHERE budget_modifier < 0.7 OR budget_modifier > 1.3;
     ```
   - Tjek 4 — Finance-transaction-type-konsistens (alle types matcher CHECK constraint):
     ```sql
     SELECT type, COUNT(*) FROM finance_transactions 
     WHERE type NOT IN ('salary', 'sponsor', 'bonus', 'transfer_in', 'transfer_out', 'prize', 'loan', 'loan_interest', 'emergency_loan', 'admin_adjustment', 'auto_squad_purchase', 'auto_squad_sale', 'squad_violation_fine')
     GROUP BY type;
     ```
   - Tjek 5 — Notifications-type-konsistens (type mod CHECK constraint).
   - Tjek 6 — Foreldrelose ryttere (`team_id IS NOT NULL AND team_id NOT IN (SELECT id FROM teams)`).

2. Ved drift fundet:
   - Discord-alarm til `general`-webhook med Markdown-rapport
   - Skriv `docs/drift-reports/<dato>.md` med detaljer
   - GitHub Action opretter automatisk issue på drift hvis CI er konfigureret

3. GitHub Action `.github/workflows/drift-monitor.yml`:
   - Daily cron 03:00 UTC
   - Kør `node backend/scripts/driftMonitor.js`
   - On failure: notify Discord

**Estimat:** 1 session.

**Forudsætninger:** S-01 (salary GENERATED) — uden den vil drift-monitoren rapportere konstant 10/15-mismatch.

---

## Loop B · Pre-push hook for PatchNotes-disciplin

**Hvorfor:** "Patch notes er obligatoriske" er feedback-memory siden v2.05. Stadig kommer vi til at glemme det. En hook gør det fysisk umuligt.

**Trigger:** `git push` lokalt.

**Implementation:**
1. `.husky/pre-push` (eller `.git/hooks/pre-push`):
   ```bash
   #!/bin/bash
   FRONTEND_TOUCHED=$(git diff origin/main..HEAD --name-only | grep -E "^frontend/src/" | grep -v "PatchNotesPage.jsx")
   PATCH_NOTES_TOUCHED=$(git diff origin/main..HEAD --name-only | grep "PatchNotesPage.jsx")
   
   if [ -n "$FRONTEND_TOUCHED" ] && [ -z "$PATCH_NOTES_TOUCHED" ]; then
     echo "❌ Frontend ændret uden PatchNotesPage-update."
     echo "Kør: 'echo \"intentional skip\" >> docs/skip-patchnotes-reason.txt' for at tilsidesætte."
     exit 1
   fi
   exit 0
   ```
2. Setup-script `scripts/install-hooks.sh` der symlinker hooken — kør én gang ved repo-clone.

**Estimat:** 0.25 session.

---

## Loop C · Postmortem-loop

**Hvorfor:** Bug-fix gemmes i commit, men "WHY" og "HOW VI FORHINDRER det igen" går tabt. Postmortem-mappen samler disse som søgbart erfarings-arkiv.

**Trigger:** Manuel — efter hver bug-fix-session.

**Implementation:**
1. `.claude/learnings/`-mappe oprettes
2. Skabelon `.claude/learnings/_TEMPLATE.md`:
   ```markdown
   # Postmortem · YYYY-MM-DD · <kort titel>
   
   ## Hvad skete der?
   <2-3 sætninger>
   
   ## Root cause
   <konkret kode-/data-fejl>
   
   ## Fix
   <hvad blev ændret, fil:linje>
   
   ## Forhindret-fremover
   <test, drift-monitor, dokumentation, hook?>
   
   ## Læring
   <generaliserbar takeaway>
   ```
3. Slice close-out-tjekliste i `docs/GUARDRAILS_CORE.md` opdateres med "Tilføj postmortem-entry hvis sliсen fixede en bug".
4. **Loop:** Hver mandag genlæses sidste 7 dages entries → hvis 2+ entries har samme læring → spawn task til at automatisere/dokumentere det permanent.

**Estimat:** 0.25 session for skabelon. Recurring 5-15 min/bug.

---

## Loop D · Auto-PR-review-skill

**Hvorfor:** Solo-developer + AI-assistent → ingen anden-pulse på changes. `/review`-skill kan agere som anden anmelder.

**Trigger:** Efter slice close-out, før push til main.

**Implementation:**
1. Genbrug existing `/review`-skill (allerede tilgængeligt — listet som user-invokable)
2. Kør med stikket "Review changes on current branch against docs/GUARDRAILS_CORE.md and docs/slices/<aktuel-slice>.md. Flag: contract violations, secret-leaks, missing tests, drift fra slice-doc."
3. Output → ny session-besked til hovedagenten der enten godkender eller iterates
4. Lav lille wrapper-skill `/pre-merge-review` der gør dette automatisk efter slice-close

**Estimat:** 0.5 session for wrapper-skill.

---

## Loop E · AGENTS.md som live koordinerings-fil

**Hvorfor:** Claude (mig), Codex (parallel AI) og evt. fremtidige AI-værktøjer skal koordinere uden konflikter. AGENTS.md er en single-source-of-truth for "hvem ejer hvad".

**Trigger:** Opdatering ved hver session-end hvis arbejdsdeling ændres.

**Implementation:** Se `docs/AGENTS.md` (opdateret separat).

**Estimat:** Allerede skrevet — vedligeholdes inkrementelt.

---

## Loop F · Subagent-orkestrering

**Hvorfor:** Store features → parallel research = hurtigere afklaring + mindre context-pollution af hovedagent.

**Trigger:** Manuelt når en slice rammer >3 underemner.

**Implementation (mønster, ikke kode):**
1. Ved slice-start: hovedagent identificerer 2-3 uafhængige research-spørgsmål
2. Spawn `Explore`-agents parallelt med specifikke prompts (eks. session 2026-05-04 audit)
3. Modtag kompakte rapporter, syntetiser, fortsæt
4. Aldrig: lade subagent skrive kode hvor ejerskab er uklart

**Reference:** Session 2026-05-04 brugte denne pattern til audit af 30 punkter — ~75% reduktion i tokens vs sekventiel.

**Estimat:** Ingen ny implementering — disciplin-pattern.

---

## Loop G · Visuel regression med Playwright

**Hvorfor:** Tailwind-token-ændringer (Dark mode, color system) har historisk produceret usynlige bryd (v2.20 cz-bg0 aliases, v2.21 opacity-fix). Visuel regression fanger disse på pre-merge.

**Trigger:** GitHub Actions PR-check.

**Implementation:**
1. Setup `frontend/tests/visual/`:
   - Playwright-config med base-URL = preview-deploy
   - Test-suite der tager screenshots af 8 kerne-sider:
     - `/dashboard`, `/riders`, `/auctions`, `/team`, `/finance`, `/board`, `/seasons`, `/inbox`
   - Begge temaer (lyst + mørkt)
   - Begge viewports (desktop + mobile)
2. Baseline screenshots committes til `frontend/tests/visual/__snapshots__/`
3. PR-check kører Playwright + sammenligner — fejler hvis pixel-diff > 0.1%
4. Manual godkendelse via "update snapshots" hvis intentional ændring

**Estimat:** 1 session.

---

## Loop H · SQL drift detection

**Hvorfor:** `database/schema.sql` er kanonisk, men ad-hoc migrations ruller live mod Supabase. Drift mellem doc og runtime er en kendt risiko.

**Trigger:** Ugentlig cron eller manuel.

**Implementation:**
1. `backend/scripts/schemaDriftCheck.js`:
   - `pg_dump --schema-only` mod live Supabase
   - Sammenlign mod `database/schema.sql`
   - Diff → markdown-rapport
2. Discord-alarm hvis tabel/kolonne/constraint mangler i `schema.sql`
3. Auto-PR mod docs hvis kun additive ændringer

**Estimat:** 1 session.

---

## Loop I · Microsoft Clarity weekly insight loop

**Hvorfor:** Vi gætter på UX-problemer i dag. Clarity FORTÆLLER os via dead-clicks, rage-clicks, scroll-rage. Loop konverterer Clarity-data til actionable slices.

**Trigger:** Mandag morgen, manuelt eller automatiseret.

**Implementation:**
1. Setup-session (separat slice):
   - Opret Clarity-projekt
   - Indsæt tracking-snippet i `frontend/index.html` (production-only via env-flag)
   - Tilføj samtykke-toggle i ProfilePage's "Privatliv"-sektion
   - Mask følsomme felter: `data-clarity-mask` på password-input + evt. økonomi-tal
   - Custom-tags: `manager_id`, `division`, `season_number`
2. Weekly review (manuel ELLER scripted):
   - **Hvis Clarity-API tilgængeligt:** `scripts/clarityWeeklyReport.js` puls top-N dead-clicks/rage-clicks → markdown-rapport til `docs/clarity/weekly-<dato>.md`
   - **Hvis manuel:** Bruger åbner Clarity-dashboard, kopierer top-3 problemer ind i en Claude-session med prompt "Forslå minimal fix"
3. Hver weekly-rapport → 1-3 nye P1/P2-issues på GitHub (`gh issue create --label "claude:todo,priority:med,type:feature"`)

**Estimat:** 1 session for setup + 30 min/uge recurring.

---

## Loop-orkestrerings-rytme

| Loop | Frekvens | Hvem starter |
|---|---|---|
| A · Drift-monitor | Dagligt 03:00 UTC | GitHub Actions |
| B · Pre-push hook | Hvert push | Lokal git |
| C · Postmortem | Per bug-fix | Hovedagent (Claude/Codex) |
| D · Auto-PR-review | Per slice-close | Hovedagent |
| E · AGENTS.md update | Ved arbejdsdelings-skift | Hovedagent |
| F · Subagent-orkestrering | Per stor feature | Hovedagent (disciplin) |
| G · Visuel regression | Per PR | GitHub Actions |
| H · SQL drift | Ugentlig | GitHub Actions |
| I · Clarity review | Mandag | Bruger eller scripted |

---

## Implementation-rækkefølge (anbefalet)

**Pre-launch:** A (drift-monitor) + B (pre-push hook) + C (postmortem-skabelon)  
→ Disse beskytter mod regression mens vi bygger P0-slices.

**Uge 1 post-launch:** D (auto-PR-review) + E (AGENTS.md cementering) + I (Clarity setup)  
→ Drift fra produktion-data informer iteration.

**Uge 2-4 post-launch:** F (subagent-disciplin) + G (visuel regression) + H (SQL-drift)  
→ Kvalitets-gates der modnes med kode-basen.
