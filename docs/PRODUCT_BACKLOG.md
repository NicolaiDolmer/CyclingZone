# PRODUCT BACKLOG — Cycling Zone

_Kanonisk, token-effektiv roadmap. Ingen done-historik her — kun fremadskuende slices og kandidater._
_Færdige detaljer bor i `docs/FEATURE_STATUS.md` og `docs/archive/`._

---

## Pre-launch roadmap (aktiv uge)

Se `docs/NOW.md` for detaljeret rækkefølge. Nedenfor er slice-briefings klar til session-start.

### S5 — Prize-money frontend + baseline
**Manager-værdi:** Economy er kalibreret mod rigtige præmieindtægter.  
**Mål:** Finance-UI viser præmiepenge tydeligt; rerun `npm run economy:baseline` med rigtige tal; let tuning af salary rate / sponsor / debt ceilings baseret på ny baseline.  
**Test:** Frontend build + visual smoke på Finance-siden.

### S6 — Onboarding MVP
**Manager-værdi:** Nye managers i open beta forstår spillet fra dag 1.  
**Scope (minimal):**
- First-login modal (vises én gang, `first_login` flag)
- Tvungen hold-/managernavn-wizard (bygger på S2-fix)
- 3 tooltip-cards: Marked → Auktioner → Bestyrelse
- Fremtrædende link til Hjælp-siden
**Out of scope:** Fuld guided wizard med race-calendar og squad-builder (→ Onboarding v2 post-launch).  
**Test:** Build + manuel gennemgang af new-manager flow.

### S7 — Launch readiness
**Mål:** Open beta go-live.  
**Gate-checks:**
- Beta reset koordineret med alle 17 managers
- Smoke-test: login, auktion, transfer, finance, bestyrelse
- Help + PatchNotes afspejler alle S2-S6 ændringer
- Deploy verify (`pwsh -File scripts/verify-deploy.ps1`)

---

## Post-launch queue

- **Economy tuning iteration** — baseret på live data fra første beta-sæson; salary rate, sponsor, debt ceilings
- **Season countdown + dashboard UX** — synlig sæson-status og dage-til-slut på dashboard
- **Manager cross-season statistik** — fuld historik og vækst over sæsoner fra `board_plan_snapshots` og `season_standings`
- **XLSX security advisory** — evaluer og patch eller erstat `xlsx`-pakken (high-severity advisory)
- **Onboarding v2** — progressiv disclosure af bestyrelses- og økonomi-kompleksitet; guided squad-builder
- **Inbox/activity consolidation v2** — trigger: launch-critical flows er stabile; ingen chat mellem managers

---

## Data Depth Candidates

- **Teams PCM mapping** — trigger: økonomi og season-flow er stabile
- **Cyclists PCM mapping** — trigger: sammen med eller efter team mapping
- **3-sæsoners glidende rangliste** — trigger: kræver mindst 3 sammenlignelige sæsoner med data

---

## Engagement + Polish Candidates

- **Discord-name matching** — trigger: managerprofil/presence poleres
- **Richer notification filters** — trigger: efter inbox IA er låst
- **Dark mode decision** — trigger: design/IA-afklaring før UI-retuning
- **Secret achievement presentation audit** — trigger: hvis runtime viser achievements før unlock

---

## Locked Product Defaults

- `Liga` beholdes som navn indtil videre
- Managers kan ikke sende beskeder til hinanden
- `Min aktivitet` forbliver separat side under `Marked`
- `Indbakke` er kun til systemhændelser og notifikationer
- Garanteret salg: eneste undtagelse til minimum-startpris-reglen (50% af Værdi)
- Første bud på AI-/bank-/fri rytter-auktion = initiatorens implicitte vinderposition; gælder også legacy-auktioner
- Økonomi: **stram men fair** — ikke let beta-start, ikke hardcore sim
- Konkrete økonomi-tal vælges baseret på live data + simulation

---

## Archived Done Proof

- `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`
- `docs/archive/RECENT_DONE_PROOF_2026-04-29.md`
- `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`
- `docs/archive/SEASON_6_REPAIR_VERIFICATION_2026-04-29.md`
- Runtime feature truth: `docs/FEATURE_STATUS.md`
