# Bestyrelsesfunktionen — komplet audit (2026-06-05)

> **Scope:** Full-circle audit af `/board` + alt det berører (økonomi, transfers/auktioner, dashboard, indbakke, onboarding, admin) — mod kode, S-02-planerne, alle 24 board-issues, #481-brand/UI-reglerne og genre-benchmark (FM/PCM/OOTP/MM).
> **Metode:** 4 parallelle analyse-spor (backend-eval, i18n, frontend-brand, benchmark) + issue-reconciliation mod live `main` + live-render-verifikation via Playwright-mock. Alle tekniske fund er kode-verificeret (fil:linje); intet er taget fra labels alene.
> **Nordstjerne (S-02):** "Verdens bedste bestyrelses-funktion til et cykelmanager-spil — FM-immersion, men simpelt at læse på overfladen."
> **Status-dato:** Auditeret mod `main` @ `b93b301b` (efter #1070/#1069 merge).

---

## 1. Executive summary

Board er **funktionelt komplet** (10/10 S-02-slices leveret) og har et **genre-førende fundament** — men bærer tre lag gæld:

1. **Korrekthed:** mål-evalueringen har reelle bugs der får UI til at vise forkerte resultater (eval-paritet, cumulative-tælling, bonus-offer-matematik).
2. **Brand:** board blev bygget *før* #481 Phase 1-4 og er aldrig holdt op mod de nye regler — 34 non-token-farver, ingen `font-data` på tal, intet `gold = leader`, manglende micro-interactions, og 4 modaler der fejler a11y.
3. **Forståelighed + EN:** spillere kan ikke se hvad bestyrelsen konkret gør (Discord-feedback), og ~280 hardcodede danske strenge lækker i EN-mode.

**Tilstandsscore pr. dimension** (1-5, 5 = verdensklasse):

| Dim | Område | Score | Hovedårsag |
|-----|--------|:----:|-----------|
| A | UI/UX & brand-compliance | **2 / 5** | Bygget før brand-reglerne; 34 non-token-farver, ingen font-data/gold=leader, 4 modaler uden a11y |
| B | Game-design & mekanik | **4 / 5** | Genre-førende fundament; mangler læsbarhed + gennemsigtighed |
| C | Korrekthed & teknik | **3 / 5** | #979 nu fixet; eval-paritet + countGoalsMet + schema-drift udestår |
| D | i18n & copy | **2.5 / 5** | Perfekt nøgle-paritet, men ~280 hardcodede DA-strenge = stor EN-leak |
| E | Tilstødende systemer | **3.5 / 5** | Overvejende sundt; `is_bank`/`is_frozen`-guard-huller |

**Vej til "verdensbedste":** Fundamentet (B) er der allerede og slår genren på det vigtigste (aldrig fyring, 3 parallelle horisonter, baseline-sæson). Gabet er **eksekvering på overfladen** — gør resultaterne korrekte (C), gør board brand-kompatibelt (A), og gør mekanikken *læsbar og gennemsigtig* (B-løft + D). Det er overkommeligt før launch.

---

## 2. Dimension A — UI/UX & brand-compliance

Board bruger korrekte `cz-*`-tokens mange steder (fx `text-cz-accent-t`, `bg-cz-accent text-cz-on-accent`), men er aldrig kørt gennem #481 Phase 4's raffinement. Affordance-pakken (#1030/#1066) **er landet og verificeret** — mål-headers, "+N mål mere", medlems-kort, DNA-badge og satisfaction-tal er ægte `<button>`s.

### 🔴 Kritiske
- **A11y — 4 modaler uden semantik.** `BoardMemberDialog` (`BoardPage.jsx:185`), `ClubDnaDialog` (`:313`), `GoalMiniDialog` (`:545`), Wizard-modal (`:2155`): ingen `role="dialog"`, `aria-modal`, `aria-labelledby`, focus-trap, Escape-handler eller focus-restore. Den mest komplekse (wizard, 3 trin) er fuldt utilgængelig for tastatur/skærmlæser.
- **SatisfactionMeter raw-hex via inline `style`.** `:367` `const color = value>=70 ? "#4ade80" : value>=40 ? "#e8c547" : "#f87171"` injiceres via `style={{ color }}` (`:374`) + `style={{ backgroundColor: color }}` (`:378`). Bright gold som **tekst** på Chalk = ~1.6:1 = **WCAG-fail i light-mode**. Skal bruge `cz-success`/`cz-accent-t`/`cz-danger`.

### 🟠 Høje
- **34 non-token-farver** (PR-4 raw-hex→token-sweep gælder board): 5 raw/arbitrære hex (`:367` ×3, `:640/643` `border-[#e8c547]`, `:764` `text-[#7dd3fc]`, `:914`) + 29 core-Tailwind (`text-red-300/400/600`, `text-green-300`, `text-blue-300`, `border-blue-500/*`, `border-green-500/50`, `border-red-500/30`). Filen blander semantiske tokens og core-farver for *samme* betydning, ofte i samme blok.
- **~15 tal-sites uden `font-data`.** Hele `SeasonSnapshotGrid` (`:690-734`: rank `#`, stage/gc-wins, goals_met/total, satisfaction_delta%) + `SatisfactionMeter`-modifier (`:382`), `CumulativeStatsRow`-nævner (`:677`), countdown (`:1120`), plan-modifier (`:1210`). KPI-tabellen er det største hul — tabular-nums giver ikke kolonne-stabilitet uden `font-data`.
- **`gold = leader` honoreres ingen steder.** `SeasonSnapshotGrid` rank-`#` (`:711`) er neutral `text-cz-2` uanset placering; `relative_rank`/`top_n_finish`-mål (`:453-465`, `:574-581`) viser rang uden maillot-treatment. En manager der ER #1 i divisionen er visuelt udød. Dette er den klareste manglende brug af brand-guld.

### 🟡 Medium
- **Micro-interactions mangler.** Sidebar-signaturen (gold-bullet + hover-accent-dash, jf. `project_brand_sidebar_hover_microinteraction`) er ikke replikeret. Aktiv plan markeres kun med statisk `border-cz-accent/40` (`:1190`); top-3-mål-knapper har `hover:bg` men ingen accent-dash. Board er brand-stille ift. resten af UI'et.
- **Responsivt.** `SeasonSnapshotGrid` (`:696`) er en 6-kolonne `<table>` i `text-xs` uden `overflow-x-auto` → kan overflowe på smalle skærme. Flere tap-targets (×-knapper `:206/327/560`, "+N mål" `:1264`) er under 44×44px. Dialoger stacker dog korrekt (`items-end sm:items-center`) ✓.
- **0 focus-styling** i hele filen (ingen `focus:`/`focus-visible:`). Tastatur-fokus er usynligt ud over browser-default.

### Live-render-note
Det non-baseline board (aktiv plan, members, DNA, konsekvenser, bonus-offer) blev renderet live via Playwright-mock i light + dark — **0 page-errors med en realistisk `/board/status`-payload**, hvilket bekræfter at UI'et er strukturelt sundt. Screenshots gik tabt da arbejds-worktreen blev fjernet eksternt midt i kørslen (se §7); alle brand-fund ovenfor er derfor kode-verificerede (fil:linje), ikke skøn. Den eksisterende core-smoke `/board`-fixture er `is_baseline_phase:true` og viser kun observations-banneret — det interaktive board er **ikke E2E-dækket** (test-hul, se Dim C).

---

## 3. Dimension B — Game-design & mekanik (vejen til verdensbedste)

### 🟢 Styrker at bevare (benchmark mod FM/PCM/OOTP/Motorsport Manager)
Disse er reelle differentiatorer — nedprioritér dem ikke:
1. **"Aldrig fyring" + 6-lags gradueret konsekvens-tier** løser genrens #1-frustration. FM-spillere fyres efter A+-sæsoner; OOTP-spillere slår owner-goals fra; MM giver brutale ultimatum-races. Jeres tier er *løsningen* på den klage — en headline-feature, ikke et kompromis.
2. **3 parallelle horisonter (1/3/5-år)** er rigere end FM's enkelte rullende 5-års-plan.
3. **Baseline-observations-sæson** (sæson 1) er pædagogisk overlegen — alle benchmark-spil kaster mål på spilleren fra dag ét.
4. **270 reaktions-templates + 9 arketyper** er på FM-niveau for tekstuel immersion, over PCM/MM's rent numeriske tilgang.
5. **Forhandling med eksplicit tradeoff-pris** er mere gennemsigtig end OOTP's (som folk slår fra fordi den er uigennemskuelig).

### 🟡 Forståeligheds-huller (Discord-feedback — kerne-issues)
- **#101** — spillere kan ikke se hvad tilfredshed konkret påvirker (sponsor m.m.). `.sredna` måtte gætte. Mangler: effekt-visning ved barometeret + "hvis opfyldt: X / hvis ikke: Y"-tooltips pr. mål.
- **#102** — de 9 personlighedstyper er kodet men ikke visuelt synlige som *mekanik* (kun navn + emoji). Gør arketyperne mekanisk meningsfulde.
- **#818** — forhandlingsrækkefølgen (5→3→1 år) forklares ikke ved første møde.
- **#989** — uklart hvordan 3-årsplanens "top X i division" evalueres (slutplacering vs. gennemsnit).
- **#816** (lukket/claude:done) — "over 100%"-status: verificér kvalitative labels (Below par/On track/Good/Great/Outstanding) faktisk er live.

### 12 konkrete løft mod "verdensbedste" (benchmark-syntese)
**Quick wins (lav kompleksitet, høj læsbarhed — kandidater før launch):**
1. **Status som label + bar + tal** ("Trygt flertal · On Track · 68%") frem for kun %. Pr. mål: ✅/⚠️/❌ + trend-pil. *UX-research: label slår rå %, farve skal bakkes af ikon/label.* Rent præsentationslag. → adresserer #101/#816 direkte.
2. **"Hvad vægter dette board?"-gennemsigtighed** — vis de 2-3 højest-vægtede måltyper (DNA-vægtningen findes allerede; vis den). → adresserer #102's mekanik-side + fjerner "hvorfor er boardet sur"-mysteriet.
3. **Goodwill-buffer over 100%** — lad satisfaction >75% lagre goodwill der trækkes fra før en dårlig sæson rammer budget/tier. *PCM trust>100 = leeway.* Bygger på jeres eksisterende >75%-bonus-trin.

**Næste lag (medium, høj immersion):**
4. Spiller-valgt ambitionsniveau ved forhandling (safe/expected/stretch) — *MM/PCM.* Ejerskab over forventningen afvæbner "vilkårlig"-følelsen.
5. Konsekvens-preview pr. mål ("misses → modifier −0.05") — gør 6-lags-tieren læsbar i stedet for en black box. Udvider affordance-pakken.
6. Board-personlighed driver budget/tålmodighed (2-3 traits pr. arketype) — *OOTP Patience/Priority.* Gør de 9 arketyper mekanisk forskellige.
7. Faste, annoncerede evaluerings-checkpoints — *PCM faste datoer.* Formalisér mid-season-banneret til 2-3 punkter.

**Post-launch (høj kompleksitet/dybde):**
8. Separat fan-/supporter-stemme der vægter anderledes end boardet — *FM's stærkeste narrative motor.* Hold den let (én label), undgå to modstridende 100%-systemer.
9. Eskalerende ambition ved vedvarende succes — *FM Club Vision.* Kobl til ressource-vækst (undgå FM's "urealistisk eskalering"-fælde).
10. Kvalitativ "sandsynligt udfald"-prognose pr. mål.
11. Sporbare løfter/commitments (gjort eksplicit, modsat FM's "messy promises").
12. Formandsskifte som narrativt soft-takeover-beat (I har allerede formand-udskiftning).

### Anti-patterns at undgå (fra genren)
Konsekvenser afkoblet fra ressourcer · skjult/uforklarlig bedømmelse · overstraffe enkelt-events · vage promises · to modstridende 100%-systemer · forventninger uden onboarding. **Jeres baseline-sæson + tradeoff-låsninger + relative_rank-anker modvirker allerede flere af disse — bevar dem.**

---

## 4. Dimension C — Korrekthed & teknisk kvalitet

Alle board-tests grønne (272 tests, 9 suites). Backend-evalueringen dækker 14 måltyper korrekt.

### 🔴 Kritiske (must-fix før launch)
- **#55 — frontend/backend eval-paritet.** Frontend `goalAchieved()` (`BoardPage.jsx:1162-1176`) kender kun 8 legacy-typer; de 7 nye (`signature_rider`, `u25_development_delta`, `relative_rank`, `monument_podium`, `jersey_wins`, `profitable_transfers`, `domestic_dominance`) falder til `default:return false`. → header-tælleren `goalsAchieved/nonCumGoals.length` (`:1182`) + top-3-ikoner (`:1240-1245`) **undertæller systematisk**: et mål manageren HAR opnået vises som ikke-opnået. Per-mål-detaljen er korrekt (bruger backend `outlook.goal_evaluations`), så fixet er: **drop den lokale `goalAchieved` og brug backend-status** (`status === 'ahead'/'met'`). ~25 linjer. *Troværdighedsbug — spilleren tror systemet er i stykker.*

### 🟠 Høje
- **`countGoalsMet` ekskluderer cumulative-mål fra "met", men tæller dem i total** (`boardGoals.js:874-878` vs. `economyEngine.js:961`). Cumulative stage/gc-mål kan **aldrig** tælle som met i ratio'en — heller ikke i final season hvor de ER evaluerbare. Konsekvens: (a) **bonus-offer (lag 6) bliver matematisk næsten umulig** for multi-year-planer med 1-2 cumulative mål (`isBonusOfferEligible` ≥0.75-tærskel); (b) `board_plan_snapshots.goals_met/total` lagres mismatchet → fodrer board-memory-scoren. Satisfaction-modifieren selv er IKKE ramt. Fix: tillad cumulative ved `isFinalSeason`. ~5 linjer.

### 🟡 Medium
- **#54 — goal-context loader uden plan-cyklus-filter** (`boardGoalContext.js:23-32`). Cumulative-felter (monument_podium/jersey_wins/profitable_transfers) spænder over hele boardets historik, ikke kun aktuel plan-periode; `firstSnapshot` kan vælge en gammel cyklus' baseline til `u25_development_delta`. Læse-stien `/board/status` filtrerer korrekt (`api.js:6196`) men loader IKKE goal-konteksten. **Latent** — rammer kun hold der re-signer samme plan-type i 2.+ cyklus (næppe materialiseret i beta endnu). Fix: send `planStartSeasonNumber` ind + filtrér. ~30-40 linjer.
- **#57 — `u25_development_delta` på 1yr-plan kan aldrig evalueres** (`boardGoals.js:188-194` + `boardGoalContext.js:36-39`). 1yr = 1 sæson → intet tidligere snapshot → baseline altid null → altid `awaiting_data`. Fix: ekskludér fra 1yr (kun multi-year). ~10 linjer.
- **#813 — `u25_development_delta` kræver stat-stigning der ikke kan opnås endnu.** Ingen in-season skrivning til `riders.stat_*`; eneste vej til delta = roster-churn, ikke "udvikling". Afhænger af ability-model (#675, ikke live). Labelen er vildledende. → hold målet ude af aktive planer indtil #675, eller omformulér.
- **#815 — `signature_rider` bruger skjult `popularity`-tal i stedet for synlige stjerner.** Backend-label "popularity ≥75" (`boardGoals.js:1184`); `popularity` eksponeres aldrig i spiller-vendt UI (spillere ser `PotentialeStars`). Målet refererer et felt spilleren ikke kan se. → omformulér til stjerne-koncept eller vis popularity.
- **Schema-drift på `board_request_log` unique-index.** Prod-constraint er per `(board_id, season)` (`2026-04-24-board-parallel-plans.sql`), men `schema.sql:335` + `supabase_setup.sql:266` + contract-testen (`boardRequestSchemaContract.test.js:20`) refererer stadig det gamle per-team-index. En fersk DB fra `schema.sql` får det **forkerte** index. Fix: opdatér 2 schema-filer + test.
- **E2E-test-hul:** det interaktive board er ikke dækket (core-smoke kun baseline-fasen). En committet non-baseline mock-fixture ville lukke hullet.

### ✅ Verificeret korrekt / by-design
- **#979 — FIXET + MERGET** til main (PR #1070, `b93b301b`): `cumulative_stats` beregner nu `(board.cumulative_* + currentStanding.*)` delt mellem outlook + display, med forward-guard-test. Mid-season 0%-bug løst.
- **#914** (lukket) — root-årsagen (tomme standings) blev modbevist mod prod; korrekt lukket. #979 var en separat display-bug.
- **satisfaction→modifier-kurve** matcher spec nøjagtigt (80/60/40/20 → 1.20/1.10/1.00/0.90/0.80).
- **Konsekvens-tærskler** (40>30>15>10, bonus 75) strengt aftagende, idempotente, fair.
- **DNA-order-atomicity** (#878/#820): `chooseDnaForTeam` skriver DNA→regenererer→rollback ved fejl + idempotent recovery. Holder.
- **budget_modifier** opdateres for alle aktive planer ved season-end.

---

## 5. Dimension D — i18n & copy (EN-launch-kritisk, #678)

- **Nøgle-paritet PERFEKT:** `da/board.json` = `en/board.json` = 254 nøgler, 0 mismatch. ✓
- **ICU korrekt:** 0 `{{double-brace}}`-fejl; plural-rules korrekte. ✓
- **🔴 ~280 hardcodede DA-strenge lækker i EN-mode:**
  - **10 feedback-headlines + summaries** i `boardEvaluation.js:353-433` (returneres rå, uden i18n-nøgle) → #917 (titlen nævner kun "show details", men problemet er bredere). KRITISK for EN.
  - **270 arketype-reaktions-templates + 9 labels + descriptions** i `boardArchetypes.js` — player-facing (vist i `BoardMembersGrid` + `MemberReactionPanel` + "X reagerer") → #694. Stort omfang.
  - **23 konstant-labels** i `boardConstants.js` (CATEGORY/SPECIALIZATION/TIER/SQUAD + 4 request-definitioner) + **5 DNA tradition-goal-labels** (`boardClubDna.js`, har `label_key`-fallback) + 6 fallback-rationales.
- **Em-dash:** 9 forekomster i dansk copy (`board.json`). Tonereglen siger "ingen em-dash i player-facing copy" → **verificér mod ejer** om reglen gælder DA, eller kun EN. (Lav severity; muligt bevidst.)
- **Tone/EN-first:** ingen "we"/"I"-brud i board-kontekst; terminologi konsistent (Bestyrelse/Board, plan-labels).

Dette spor er **direkte relevant for #678** (EN-translation closeout for TdF launch) — board er en stor EN-leak-kilde.

---

## 6. Dimension E — Tilstødende systemer

- **Økonomi:** `budget_modifier` (lag 1) i sponsor-payout, salary cap (lag 2), sponsor-pullout-stack (lag 5) — verificeret korrekt integration i `economyEngine`.
- **Transfers/auktioner:** `assertSigningAllowed` (lag 2-3 hard-block) returnerer 403 m. `code`; **verificér fejl-UX'en er forståelig** når et køb blokeres (frontend-side, ikke auditeret i dybden).
- **Dashboard:** board-pejlemærket læser `/api/board/status` → `activePlan.outlook` (`DashboardPage.jsx:163-165`). Konsistent kilde med BoardPage ✓. #101's krav om effekt-visning gælder også her.
- **Indbakke:** `board_update` (info) vs. `board_critical` (skal-handles) routing + mid-season-banner + auto-accept-countdown — korrekt tier-styret.
- **Onboarding:** sæson 1 baseline → sæson 2 sekventiel forhandling → DNA-gate (409 `BOARD_DNA_REQUIRED`) — solid.
- **Admin:** test-mode (#805 ✓) + LIVE-mode (#1062 lukket/done). Verificér #1062's ende-til-ende-sti er kørt før launch.
- **🟡 Invariant-huller:** `is_bank` mangler i season-end/start team-filter (`loadHumanSeasonEndTeams:112`, `processSeasonStart:199` filtrerer `is_ai`+`is_frozen` men ikke `is_bank`) — lav impact (bank har typisk ingen board), men bør hærdes. `/board/sign,renew,request,status` guarder ikke `is_frozen` (en bruger med frosset hold kan POST'e). LAV-MEDIUM severity.

---

## 7. Hændelse under auditten (transparens)

Midt i live-capture-fasen blev arbejds-worktreen `angry-solomon-7dab87` **fjernet eksternt** (afregistreret fra git, working-filer slettet undtagen mine Playwright-artefakter). Sandsynlig årsag: parallel worktree-/branch-oprydning udløst af at #979-fix-chippen (oprettet af mit eget backend-eval-agent) blev actionet til en ny session (`claude/thirsty-boyd-ede677` → PR #1070). Ingen data tabt: kildekode sikker i git+remote, alle fund i denne audit. Konsekvens: live-screenshots kunne ikke gemmes (board-render blev dog bekræftet fejlfrit før tabet). Denne rapport er skrevet fra en frisk worktree på `main`. **Oprydning udestår:** stale worktree-mappe `C:\Dev\CyclingZone\.claude\worktrees\angry-solomon-7dab87` (kun `frontend/test-results`) kan fjernes med `git worktree prune`.

---

## 8. Prioriteret køreplan

**Linse (ejer-besluttet):** løs alt før TdF-launch (2026-06-20) medmindre værdien er meget lav → post-launch.

### Pakke 1 — Korrekthed (FØR launch · ~½-1 session)
Eval-bugs der får UI til at lyve. Backend-tunge, lav UI-risiko.
- **#55** eval-paritet: drop frontend `goalAchieved`, brug backend-status. *(blokerer ikke andre)*
- **countGoalsMet** cumulative-fix (bonus-offer-matematik). 
- **#57** ekskludér `u25_development_delta` fra 1yr. **#54** plan-cyklus-filter i goal-context.
- **Schema-drift** board_request_log-index + contract-test.
- ✅ #979 allerede merget (PR #1070).

### Pakke 2 — i18n EN-leak (FØR launch · ~1 session, del af #678)
- Nøglificér 10 feedback-headlines (`boardEvaluation.js`) + 23 konstant-labels (#917-udvidet).
- Nøglificér 9 arketype-labels + 270 reaktioner (#694) — størst, men player-facing i EN.
- Verificér em-dash-reglen for DA med ejer.

### Pakke 3 — Brand-compliance (FØR launch · ~1 session, afhænger delvist af Pakke 4)
- **A11y-fix:** `role="dialog"`/`aria-modal`/focus-trap/Escape på de 4 modaler + aria-label på ×-knapper + status-ikon-tekst-alt + focus-ring (genbrug gerne en delt `<Modal>`/`<Dialog>`-primitiv hvis den findes).
- **Raw-hex→token sweep** (PR-4 for board): 34 farver → `cz-*`. Inkl. SatisfactionMeter inline-style-fix (kritisk WCAG).
- **`font-data` på alle tal** (SeasonSnapshotGrid + ~10 sites).
- **`gold = leader`** på snapshot-rank + relative_rank-mål.
- Refresh core-smoke-snapshots (alle 3 projekter) efter visuelle ændringer.

### Pakke 4 — Layout-rework + læsbarhed (FØR launch hvis muligt · epic #955, 1-2 sessioner)
Det største UX-løft. Samler #821/#818/#819/#816/#815/#813/#920(lukket)/#915(lukket).
- 3-kolonne grid → **faner** (én plan ad gangen, fuld bredde) per #955-beslutningen.
- Quick-win-løft 1+2 (label+bar+tal status · board-vægt-gennemsigtighed) → #101/#102/#816/#989.
- #818 forklar forhandlingsrækkefølge; **luk #819** (forhandling-cap: afkræftet, tradeoffs findes — omformulér til "vis tradeoffs tydeligere" hvis ønsket).
- Micro-interactions (accent-dash på aktiv fane/mål) når faner alligevel bygges.
- E2E: committ non-baseline board-fixture → luk test-hullet.

### Post-launch (meget lav launch-værdi)
- Benchmark-løft 4-12 (spiller-valgt ambition, konsekvens-preview, board-personlighed, fan-stemme, eskalering, prognose, promises, takeover).
- #103 (multi-year tidlig opfyldelse), #165 (overall-tilfredsheds-bar), #167 (plan-rækkefølge — løses af #955-faner).
- Epics #932 (ungdom/talent, blokeret på #675) + #933 (hold-ejerskab) — rene feature-udvidelser.
- `is_bank`/`is_frozen`-guard-hærdning, #813's ability-afhængighed (#675).

---

## 9. Bilag — issue-reconciliation (alle board-issues mod live `main`)

| # | Titel (kort) | State | Audit-verdikt |
|---|---|---|---|
| 54 | mål arver data fra gamle plan-cyklusser | open | **ÆGTE** (latent) — Pakke 1 |
| 55 | BoardPage tæller ikke nye måltyper | open | **ÆGTE kritisk** — Pakke 1 |
| 57 | 1yr youth-plan u25-delta uden baseline | open | **ÆGTE** — Pakke 1 |
| 979 | etapesejre tæller ikke mid-sæson | open | **FIXET+MERGET** (PR #1070) → kan lukkes |
| 813 | ungdomsmål kræver umulig stat-stigning | open | **ÆGTE** — blokeret på #675, post-launch |
| 815 | signature_rider: skjult popularity vs stjerner | open | **ÆGTE** — Pakke 2/4 |
| 917 | bestyrelses-feedback hardcodet DA | open | **ÆGTE (bredere: 10 headlines)** — Pakke 2 |
| 694 | boardArchetypes EN-translation (270+9) | open | **ÆGTE** — Pakke 2 |
| 695 | boardClubDna EN-translation | closed | verificér label-fallbacks stadig dækket |
| 101 | vis bestyrelsens konkrete effekter | open | **GYLDIG** — Pakke 4 (løft 1) |
| 102 | visualisér 9 personlighedstyper | open | **GYLDIG** — Pakke 4 (løft 2) |
| 818 | forklar forhandlingsrækkefølge | open | **GYLDIG** — Pakke 4 |
| 819 | forhandling mangler cap/konsekvens | open | **AFKRÆFTET** — tradeoffs findes; luk/omformulér |
| 816 | forklar "over 100%"-status | closed | verificér labels live (Pakke 4) |
| 989 | forklar top-X-evaluering | open | **GYLDIG** — Pakke 4 |
| 955 | [Epic] UI-rework: planer som faner | open | **PARAPLY** — Pakke 4 |
| 821 | layout svært at læse | open | **GYLDIG** — Pakke 4 |
| 920 | 5yr-cirkler uden for kassen | closed | verificér i Pakke 4-render |
| 915 | genforhandling mid-sæson (exploit) | closed | verificeret gatet ✓ |
| 165 | overall-tilfredshed som progress-bar | open | post-launch |
| 167 | plan-rækkefølge 1/3/5 | open | løses af #955-faner |
| 103 | multi-year tidlig opfyldelse | open | post-launch (design) |
| 878 | dna-choose ikke-atomisk | closed | verificeret recovery-sti ✓ |
| 820 | DNA-grundlag forkert | closed | verificeret ✓ |
| 805 | board test-mode | closed | ✓ |
| 1062 | admin board LIVE-mode | closed | verificér e2e-sti kørt før launch |
| 1030/1031 | affordance-pakke | open/done | **LANDET+verificeret** ✓ |
| 484 | BoardPage EN/DA | closed | nøgle-paritet ✓ (men hardcoded strings udestår) |

**Nye issues at oprette (ikke tidligere trackede fund):** countGoalsMet/bonus-offer-bug · board-modal-a11y · board raw-hex→token-sweep · board font-data · board gold=leader · board_request_log schema-drift · board E2E-fixture-hul · is_bank/is_frozen-guard.
