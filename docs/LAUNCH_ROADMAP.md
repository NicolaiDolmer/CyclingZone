# LAUNCH ROADMAP — Cycling Zone

_Intern master-plan. Opdateret 2026-05-04 efter scope-audit. Launch-dato: åben (ikke låst). Beslutning: kvalitet > deadline._

---

## Status

- **Open beta:** Live, 17 managers tester transfermarked. Ingen løb køres pt.
- **Launch-event:** Full data-reset + sæson 0 (transfer-fase) → sæson 1 (første løbs-sæson).
- **P0-slices: 6 (S-04, S-06 ✅ leveret).** **P1-tasks: ~15** (helst før launch). **P2-spor: 7** (post-launch).
- **Audit-baseret:** Hvert punkt verificeret mod runtime 2026-05-04. Se `.claude/learnings/2026-05-04-noter-fil-stale.md` for hvorfor.

---

## P0 — Launch-blockers (6 slices)

### S-01 · Salary GENERATED column
**Hvorfor P0:** Tilbagevendende værdi/løn-bug i kodebasen siden v1.46. Root cause: dual formula konflikt (`SALARY_RATE 0.10` i [economyEngine.js:44](backend/lib/economyEngine.js:44) vs hardkodet `* 0.15` i [marketUtils.js:47](backend/lib/marketUtils.js:47)). Hver auktion sætter 15%; hver mandags-cron rewriter til 10%. Permanent fix = DB-niveau lockdown.
**Brief:** `docs/slices/01-salary-generated-column.md`
**Estimat:** 1 session.

### S-02 · Bestyrelse-redesign (sekventiel + sæson 0-lås + identity-feedback + auto-accept)
**Hvorfor P0:** Nuværende bestyrelses-system understøtter ikke den nye sæson-rytme (sæson 1 = baseline, planer aktive fra sæson 2). Sekventiel forhandling 5yr→3yr→1yr-leveres skal låses før launch så managers ikke står med uafklarede planer ved sæsonstart.
**Brief:** `docs/slices/02-board-redesign-sequential.md`
**Estimat:** 2-3 sessioner (split mulig: 02a sekventiel-flow + sæson 0-lås, 02b identity-feedback + auto-accept).

### S-03 · Trupstørrelse-håndhævelse ved vinduesluk
**Hvorfor P0:** Uden håndhævelse kan managers gå i sæson med ulovlig trup → blokerer race-flow eller giver urimelig fordel. Skal cron-trigges instant ved vinduesluk.
**Brief:** `docs/slices/03-squad-size-enforcement.md`
**Estimat:** 1 session. Forudsætning: `riders.acquired_at` migration (5 min).

### S-04 · Admin annullér auktion ✅ Leveret v2.26 (2026-05-04)
**Hvorfor P0:** Live-drift kræver et "undo"-tool. Auktioner oprettet ved fejl eller med forkert pris kan ikke håndteres uden DB-manipulation i dag.
**Brief:** `docs/slices/04-admin-cancel-auction.md`
**Estimat:** 0.5 session. **Faktisk:** 1 session.

### S-05 · Indbakke unified content-model
**Hvorfor P0:** Sidebar-IA er allerede på plads (4 grupper: Overblik/Marked/Resultater/Liga). Den manglende del er **indholdsmodellen** — i dag spreder hændelser sig over `notifications`, `activity_feed`, `transfer_offers`, `auctions`, `deadline_day_warnings`. FM-stil unified inbox kræver ÉN forbrugbar liste med kategori-filtre + klik-til-destination. Forudsætning for at indbakke kan blive primær spil-loop.
**Brief:** `docs/slices/05-inbox-unified-model.md`
**Estimat:** 1-2 sessioner.

### S-06 · Webhook smoke-verifikation ✅ Leveret v2.28 (2026-05-04)
**Hvorfor P0:** Noter nævner "webhook fejler ikke længere" uden konkret fejl-symptom. Smoke-værktøj: Test-knap pr. webhook + struktureret status-feedback (✅/❌ + Discord-status + diagnose) inline pr. row. Health-check cron downgradet til P1 "Drift-monitor" (separat session).
**Brief:** `docs/slices/06-webhook-smoke-verification.md`
**Estimat:** 0.5 session. **Faktisk:** 0.5 session.

---

## P1 — Polish & Quality (helst før launch, ellers uge 1)

### Tier 1A — Smoke & verifikation (sker først)

| Task | Estimat | Note |
|---|---|---|
| Onboarding v2 e2e-smoke + bug-rapport | 1 session | Slice 1a-4 leveret v2.12-v2.19, ikke smoke-testet |
| Patch notes / FAQ-audit (jagter udokumenterede features) | 0.5 session | Audit-output → P1/P2-issues |
| Admin-oplevelse audit-rapport | 0.5 session | Producer P1/P2-tasks frem for at gætte |
| Holdvisning eget hold (`TeamPage`) audit | 0.5 session | |
| Holdvisning andre hold (`TeamProfilePage`) audit | 0.5 session | |

### Tier 1B — Konkrete polish

| Task | Estimat | Note |
|---|---|---|
| Evne-farve-konsistens: konvertér inline hex i [RiderStatsPage.jsx:36](frontend/src/pages/RiderStatsPage.jsx:36) til [statBg.js](frontend/src/lib/statBg.js)-tokens | 0.5 session | |
| Logo-klik → /dashboard (PC sidebar + mobile header) | 0.25 session | Q2-beslutning |
| Point→Værdi rename: jagt resterende "Point"-labels på rytter-værdi-felter | 0.25 session | |
| Online-status pr. manager på TeamsPage (matcher ManagerProfilePage-mønstret) | 0.5 session | Skema-felt `last_seen` findes |
| Last-seen-timestamp synlighed på manager-profil (timeAgo) | 0.25 session | OnlineBadge findes; udvid med last_seen |
| Logo-til-dashboard: PC sidebar + mobile header | inkl. ovenfor | |

### Tier 1C — Udvidet historik

| Task | Estimat | Note |
|---|---|---|
| Dedikeret `/transfer-history`-side med filtre (sæson/hold/beløb) | 1 session | Mangler helt |
| Transfer-historik-tab på `TeamProfilePage` | 0.5 session | I dag kun pending vises |
| Transfer-historik på `RiderStatsPage` (rytter-rejse) | 0.5 session | Nyt tab eller sektion |

### Tier 1D — Automation & data

| Task | Estimat | Note |
|---|---|---|
| dyn_cyclist write-back ved rytter team-skifte | 1 session | Google Sheets API-write; eliminerer manuelt DB-arbejde |
| Drift-monitor cron (loop A) | 1 session | Forhindrer salary-bug i at vende tilbage |
| Pre-push hook: blokér push uden PatchNotes-update (loop B) | 0.25 session | |
| Postmortem-skabelon (loop C) | 0.25 session | `.claude/learnings/`-mappe + skabelon |

---

## P2 — Post-launch (multi-session features, kræver AskUserQuestion-spec-sessions først)

| Spor | Note |
|---|---|
| **Fans-funktioner** | AskUserQuestion-session — definer mekanik (kapacitet, indtægt, krav-mønstre) |
| **Merchandise** | AskUserQuestion-session — kobler til fans + omdømme |
| **Omdømme på løb** | Påvirker præmiepuljer + sponsor — kræver formel-design |
| **Omdømme på ryttere** | Adskiller "stjerner" fra arbejdsheste — kobler til transfer-værdi |
| **Lande-størrelse/omdømme** | Påvirker sponsor for hold med stærk national identitet |
| **Ryttertyper som first-class citizen** | Allerede i backlog — 1 session, kan tages tidligt i P2 |
| **Press/narrative-engine + rivalry-system** | Stort — kobler til vision J3 (PCM/FM/VMan-inspireret karriere) |
| **Manager XP/historie-arcs udvidet** | XP findes; legend-tier + decision-arcs mangler |
| **Mid-season-join-flow for nye managers** | Kun nødvendigt når faktiske mid-season-joiners forekommer |
| **Liga-omdøb-beslutning** | "Sæson", "Konkurrence", "Tour", "Mesterskab" — beslut når P0+P1 lander |

---

## Foreslået session-rækkefølge

```
Session 1 (anbefalet at starte med): S-01 Salary GENERATED column
  → Lukker den mest tilbagevendende bug; risikofri ved senere arbejde

Session 2: S-04 Admin cancel + S-06 Webhook smoke-verifikation
  → Korte P0'er; ryd småt før det store

Session 3: S-03 Trupstørrelse-håndhævelse (incl. acquired_at-migration)

Session 4: Onboarding smoke + Tier 1B polish-cluster (evne-farver, logo-klik, point→værdi)

Session 5-7: S-02 Bestyrelse-redesign (split i 2-3 underslices)

Session 8: S-05 Indbakke unified content-model

Session 9: P1 Tier 1C transfer-historik (3 placeringer)

Session 10: Drift-monitor + pre-push hook + postmortem-skabelon (loops A+B+C)

Session 11: Final smoke + roadmap-post til Discord + launch-readiness-rapport

== LAUNCH ==

Post-launch session 12+: Clarity setup → ugentlig review-loop
Post-launch sessions 13+: P2-spor i prioriteret rækkefølge (afhænger af manager-feedback)
```

**Total:** ~11 pre-launch sessioner. Tempo: 2-3 sessioner/uge → 4-5 ugers arbejde i kvalitets-tempo. Brugeren vælger launch-dato når P0 er grønt.

---

## Hvor scope blev IKKE inkluderet (eksplicit)

Disse stod på Noter-listen eller session-listen men er DROPPET / DOWNGRADET:

- **IA-restrukturering Tema 6 (sidebar-grupper, sektion-omrokering):** allerede live ([Layout.jsx:16-59](frontend/src/components/Layout.jsx)). Bekræftet via runtime-audit 2026-05-04.
- **Hemmelige achievements vises før unlock:** lukket i commit 6e293bb (2026-04-23).
- **Notifikations-tæller i header:** allerede live ([Layout.jsx:309-314](frontend/src/components/Layout.jsx:309)).
- **Head-to-head default = eget hold:** allerede live ([HeadToHeadPage.jsx:93-98](frontend/src/pages/HeadToHeadPage.jsx:93)).
- **Auktion-badge på rytter-liste + detail:** begge live.
- **Direkte tilbud-pris ubegrænset:** allerede live (kun budget-tjek).
- **Rytter-rangliste med 7 filtre + manager/AI-toggle:** allerede live ([RiderRankingsPage.jsx](frontend/src/pages/RiderRankingsPage.jsx)).
- **S9a Løb-hub (Tour de France-historik på tværs af sæsoner):** leveret v2.22.

---

## Forudsætninger / blockers

- **Beslutning afventer:** Liga-rename — udskudt til P2 (efter launch). Default forbliver "Liga" indtil videre.
- **Bruger-TODO:** sende Google Sheet-eksempel på løbsresultater til parser-validering (lav prioritet).
- **Ekstern afhængighed:** Microsoft Clarity-projekt skal oprettes før P1 Tier 1D-loops kan ramme manager-data.

---

## Reference

- Slice-briefs i `docs/slices/`
- AI-workflow-loops i `docs/AI_LOOPS.md`
- AI-koordinering i `docs/AGENTS.md`
- Public roadmap i `docs/PUBLIC_ROADMAP.md`
- Postmortem-mappe `.claude/learnings/`
