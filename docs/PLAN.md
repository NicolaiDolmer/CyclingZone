# CyclingZone — kvalitets-drevet plan mod TdF (levende strategi-plan)

> **SSOT for sekvensering/prioritering.** Etableret 2026-06-15 (stor strategisk re-plan, ejer-godkendt). Arbejdsudkast: `~/.claude/plans/brug-plan-mode-og-shimmering-forest.md`. Spil-motor-design = `docs/superpowers/specs/` + `plans/` (røres ikke — bruges ved bygning).
> **Model:** Kontinuerlige, meningsfulde kvalitets-forbedringer — IKKE et datofikseret big-bang.
> **To pejlemærker (ikke deadlines):** (1) **Forever-relaunch** — ét sidste reset → permanent no-reset, klar til ægte nye spillere (frisk sæson 1 er allerede LIVE siden 18/6; forever = det permanente vindue, spec `specs/2026-06-19-forever-relaunch-readiness-design.md`). (2) Spillet reelt *startet* + store forbedringer + race engine i fuld dybde live **før TdF 4/7**.

> **📊 Status-snapshot (2026-06-20, kode+prod-verificeret):** 18/6-relaunch UDFØRT — frisk uafhængig sæson 1 LIVE (22 hold, flags `race_engine_v2`/`daily_training`/`academy` = `on` for ALLE). E2-økonomi + anti-inflation Fase 1 (#1438/#1442) landet+deployet+migreret · værdimodel prod-backfilled (#1434/#1435, R² 0.959) · #1101-cutover kvitteret · backup/PITR opfyldt (off-site, `db:verify-restore` grøn). Natbølge 19→20/6: 15 PR'er + 9 audits → **fundamentet verificeret solidt** (race-engine/økonomi/progression/board = 0 bugs; concurrency = 1 reel race). **Næste milepæl = forever-relaunch.** **2 launch-blockers: #1560 (nye hold får tom trup) + #1558 (akademi-race penge-tab).** Race-motorens fulde fysiologi-dybde (#1021) er det største world-class-gap, ikke en forever-blocker.

## Horisont — forever-relaunch-blockers vs world-class (adskilt)

**A. NOW — forever-relaunch-blockers (Claude-kodearbejde):**
1. **#1560 — Nye hold får INGEN starttrup (tom-trup dead-end).** P1, mest fundamentale. Trup-allokering er bagt udelukkende ind i relaunch-orchestratoren (`runStarterSquadAllocation`), aldrig i den normale team-create-flow (`upsertOwnTeamProfile`) → næste nye signup efter relaunch sidder fast. Fix: udtræk per-hold-allokering til delt funktion kaldt fra team-create-hooket; genbrug svag pulje `[50,57]` (#1487-mål) + akademi-kuld. **Balance-følsom → simulér-før-ship.** Kræver ejer-beslutning (start-pulje-model + budget-kobling).
2. **WS1 race-automatisering** (`plans/2026-06-19-ws1-race-automation.md`). Fase 1 (auto-prize) + Fase 2 (season-cron) implementerbare straks efter ejer Fase-0-beslutning; Fase 3 (race-scheduler) gated af schema-beslutning + migration. Drift: spillet kan ikke slippes til ægte spillere uden automatisk løb-afvikling — skal bevises på beta.
3. **#1558 — Akademi-cap-race (penge-tab).** Severity medium (latent; prod: ingen hold >8 akademiryttere), men eneste sted en bruger kan tabe penge; samtidighed stiger med nye spillere. Fix: atomær RPC under `pg_advisory_xact_lock(team_id)` over hele count→balance→rider-update→debit (idempotency alene lukker den ikke). Migration → **ejeren merger selv**.
4. **WS2-backend (PCM-sletning) + WS3 (egne løbsnavne).** UI-del gjort (#1532/#1545). Forever-gate §6.2.

**A′. NOW — ejer-gates (parallelt spor, ikke Claude-kode):** Vercel-reset/Pro → frontend-deploy (v5.67/v5.68) + prod-spotcheck · WS1 Fase-0 A/B/C · granit-frys §7 (godkend kalibrerede tal som endelige) · leaked-password-protection #929 · spiller-comms #1278 · WS4 result_type/#1499 + START_DATE-afklaring · design A/B/C · #1276 PCM-IP · frisk backup-spotcheck umiddelbart før vinduet.

**B. NEXT — world-class (efter forever; vægt: simulerings-dybde > polish/føl > indholds-bredde):**
- (a) **fysiologi #1021 FØRST** — persistent form/træthed/recovery (erstat de neutrale 0-stubs; lukker "kondition afgør løb"-løftet) → (b) **taktik-dybde** (udbrud-timing, kaptajn-beskyttelse, lead-out-tog, hold-roller) → (c) **resultat-/spectation-UI** (#959 V2 + staged stage-by-stage reveal) → (d) **first-run onboarding-arc** → (e) **design-system-rollout HELT i mål (Plan 4) + visual-regression-matrix** på core-flows.

**C. LATER (post-TdF, bredde):** mobil-first nav (bottom-nav, tabel-reflow) · post-sæson-recap + let auto-narrativ (#1311) · roster-vedligeholdelses-pipeline · **let multiplayer-liveness** (bevidst nedprioriteret) · økonomi #1441 Fase 2-3 (forhandlbare sponsorer + modbud) · perf #1373/#1374/#1375.

Detaljeret tematisk nedbrydning (hvordan, ikke hvornår): Track 1-6 nedenfor.

## Context

Ejer-korrektion 15/6: MVP-kvaliteten har været for lav, og 20/6 må ikke styre tankegangen. Spillet ER de fem motorer (Races, Training, Youth, Transfers/Auctions, Club & World) — race engine er vigtigst. Uden ryttere, løb, stats, udvikling og ungdomsryttere synlige, pæne, præsentable og **fejlfrie** er resten ligegyldigt for brugerne. Bar: pænt/godt/præsentabelt/fejlfrit → derefter bygge til "fantastisk" og betalbart. Tracking/community/ops/cleanup er STØTTE — må aldrig fortrænge søjle-kvalitet.

**Arbejdsstandard (verdensklasse, end-to-end):** hver søjle-forbedring udføres hele kæden — data → migration → merge → UI-verify → patch notes. Refactor + dead code i samme PR. Fix selv de mangler du flagger.

## Kvalitets-bar

- **Live-bar = "præsentabelt + fejlfrit":** roadmap'ens "Today"-løfter er SANDE + polerede + ingen bugs + ingen slop.
- **Build-to-fantastic = roadmap'ens "Next"-items**, drevet af ugentlig Feature Friday + voting.

## KRITISK kvalitets-løgn — delvist lukket

Race Engine v2 (#1122/#1428) er LIVE: **evner afgør nu resultater** ("beta, påvirker ikke resultater"-løgnen er lukket). Resterende del: roadmap'ens "Today" lover at *form* former udfaldet, men `form`/`fatigue` er neutrale 0-stubs → kondition påvirker pt. intet. **Fysiologi-dybden (#1021) lukker resten — højeste world-class-prioritet (se Horisont B/Next).**

## Track 1 (SPINE) — Søjle-kvalitet i roadmap-rækkefølge

1. **Race engine i FULD DYBDE + stats/evner (LÅST SAMMEN — motoren spiser stats).** Byg PÅ eksisterende design: `docs/decisions/race-engine-architecture-v1.md`, `docs/briefs/1102-race-engine.md`, `docs/superpowers/plans/2026-06-11-1102-race-engine-runtime-wiring.md`, `.../2026-06-11-daily-training-form-fatigue.md`, `docs/decisions/rider-ability-system-v2.md`, `docs/superpowers/specs/2026-06-11-kernesystemer-design.md`.
   - ✅ **Færdigt (LIVE):** evner afgør resultater (#1122/#1428, "beta"-mærke fjernet); egen værdimodel + abilities v2 backfilled på prod (#1434/#1435).
   - ⏳ **Resterende dybde (rækkefølge fastlåst — ejer-valg 17/6):** (a) **fysiologi #1021** — form fra træning + løbsdags-træthed (erstat 0-stubs), ikke kunstige konstanter → (b) **udbruds-/taktik-dynamik** (kaptajn/hjælpere/jægere) realistisk → (c) **resultater + spectation** — tider + gaps + per-etape-klassement (#959 V2) + staged stage-by-stage reveal.
   - Empirisk dry-run-harness mod fiktiv population + mål-scorecard FØR hver dybde-del går live.
2. **Training** præsentabel+fejlfri: kontekst/labels, loading/fejl-states, mobil, fjern emoji.
3. **Youth/Akademi** præsentabel+fejlfri: potentiale-kontekst + SVG-stjerner, progress, sortering/filter, free-agent-forklaring.
4. **Transfers** fejlfri: swap-cash-bug, 14-stat swap-kort, loan-UI, EN-strings, mobil.
5. **Auktioner** fejlfri: a11y-modal, watchlist-toast, sælger-null, mobil-input, aria-live countdown.

## Track 2 — Færdiggør UI/UX-migrationen (ÉT konsistent produkt)

Plan 4 UI-foundation-rollout (`docs/superpowers/plans/2026-06-15-ui-foundation-plan4-rollout.md` + `.../specs/2026-06-14-design-system-foundation-design.md`) HELT i mål på ALLE flader — ingen to forskellige UI'er. Per-flade-migration (side + child i én PR). Emoji→SVG. RaceSignature ægte data · 375px mobil-audit · dark-mode kontrast.

## Track 3 — Central must (forudsætning)

**Økonomi-korrekthed E2 + anti-inflation Fase 1 = ✅ LANDET+deployet+migreret** (division-skaleret sponsor, løn ×0.067, hård gældsbund — `economyConstants.js` + prod-migration; #1438/#1442; økonomi-audit 20/6 = 0 beregnings-bugs). **DB-backup/PITR ✅ opfyldt 18/6.** Rester (lav-prio / ejer-gate): lån/gæld-bugs #45/#31/#97 (E3) · legal #1276 · deploy-stabilitet #906 · security #929 (leaked-password — ejer-gate, før forever) · #691 key-rotation · #563 secret-decommission.

## Track 4 — Måling (lean — instrumentér MENS du bygger)

- **North Star:** ugentligt aktive managers med en *meningsfuld handling* (bud/transfer/træning/race-view).
- **Funnel:** besøg → signup → onboarding_completed → first_bid → first_transfer → D7-return.
- **Retention:** D1/D7/D30 per kohorte (kohorte-RPC = blocker). **Tilgang: measure-first → targeted re-engagement hvor data viser lækken.**
- **Validering:** waitlist-konvertering, fairness-clarity, willingness-to-pay, NPS (#940).
- Race+træning event-kald SAMTIDIG med Track 1. #135 scorecard · #1407 SEO-måling + #1304 GA4-unblock · teknisk SEO #1404/#1405.

## Track 5 — Community/Discord + validering (parallel, lettere)

#679 Discord-struktur + welcome · bots/ramp (#424/#425/#426/#427/#419/#430) · survey + #940 NPS + waitlist-monitorering · #1279 Go/No-Go-kriterier + interview-plan. **Monetisering: validér først, tænd betalte tiers efter Go/No-Go.**

## Track 6 — Self-loops velocity-fleet (force-multiplier — må prioriteres højt)

#1199 → #1270 → #1285, derefter #622/#629/#630 Routines+Memory Store, #631 Dreaming, #624 post-deploy verifier, #609 Bash-fix, #605 token-v2. **Prioritér tidligt de loops hvor payback på kvalitet/hastighed er reel.**

## Ugentlig drifts-rytme (Man/Ons/Fre)

- **Mandag:** uge-plan + roadmap-opdatering (Now/Next via #954) + metrics-review (scorecard).
- **Onsdag:** community-update — Discord-post (#428) + patch notes publiceret + broadcastet.
- **Fredag = FEATURE FRIDAY:** ship én poleret søjle-forbedring mod "fantastisk" + annoncér. (Marketing-prosa: ejeren skriver selv; Claude leverer struktur + udkast.)
- **Løbende under TdF:** auto OG-etapekort + stage-posts.

## Eksekvering — næste skridt (mod forever-relaunch)

1. **Luk de 2 launch-blockers:** #1560 (nye-hold-trup — ejer-beslutning → simulér-før-ship → PR) + #1558 (akademi-race atomær RPC — migration ejeren merger).
2. **WS1 race-automatisering:** ejer Fase-0 A/B/C → Fase 1-2 implementér → bevis på beta (forever-gate §6.1).
3. **Ejer-gates parallelt** (Horisont A′): Vercel-reset+spotcheck · granit-frys §7 · leaked-password #929 · comms #1278.
4. **Forever-relaunch-vindue:** når §6-gaten er grøn (blockers lukket + automatisering bevist på beta + granit-frys godkendt) → ét sidste reset → permanent. Frisk verificeret backup umiddelbart før.
5. **Derefter:** world-class-sporet (Horisont B: fysiologi #1021 først), Feature-Friday-rytme (Man/Ons/Fre). Instrumentér mens vi bygger (Track 4).

## Plan-doc-konsolidering (INTET slettes)

- Design-/system-planer i `docs/superpowers/specs/` + `plans/` = levende arkiv; bruges ved bygning; slettes ALDRIG.
- Kun status-docs konsolideres: LAUNCH_ROADMAP, dele af VERDENSKLASSE_ROADMAP, MASTER_PLAN, SPRINT_DASHBOARD, BACKLOG_PRIORITIZED får "SUPERSEDED — se docs/PLAN.md"-mærke + forbliver findbare. Ingen filer fjernes.

## Ud af vinduet / defer (ikke slet)

Roadmap'ens "Next"-dybde (= Feature-Friday-backlog) · #323 skalerings-epic · board-UX-polish · monetiserings-aktivering. #873 lukkes won't-do. (#1021 er nu INDE — del af race-engine fuld dybde.)

## Verifikation (ved eksekvering)

- Søjler: dry-run/QA + ejer-verify mod fiktiv population FØR live; UI-verify via Playwright-mocks (begge temaer, 375px).
- Race-troværdighed: evner+form afgør resultater empirisk; resultater viser tider/gaps; scorecard-mål ramt.
- UI-konsistens: 0 flader på gammel UI efter Plan 4; 0 emoji i player-facing.
- Måling: events lander i player_events; kohorte-RPC returnerer reelle tal; scorecard viser DAU/MAU/D7.
