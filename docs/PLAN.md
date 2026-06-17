# CyclingZone — kvalitets-drevet plan mod TdF (levende strategi-plan)

> **SSOT for sekvensering/prioritering.** Etableret 2026-06-15 (stor strategisk re-plan, ejer-godkendt). Arbejdsudkast: `~/.claude/plans/brug-plan-mode-og-shimmering-forest.md`. Spil-motor-design = `docs/superpowers/specs/` + `plans/` (røres ikke — bruges ved bygning).
> **Model:** Kontinuerlige, meningsfulde kvalitets-forbedringer — IKKE et datofikseret big-bang.
> **To pejlemærker (ikke deadlines):** (1) Den rigtige open beta (frisk sæson) i gang hurtigst muligt. (2) Spillet reelt *startet* + store forbedringer + race engine i fuld dybde live **før TdF 4/7**.

> **📊 Status-snapshot (2026-06-17, kode+prod-verificeret):** Race Engine v2 + abilities v2 + egen værdimodel **bygget**; `race_engine_v2_enabled` står på `beta` i prod (kun admin/beta-testere — IKKE `on` for alle endnu) · værdimodel prod-backfilled (PR #1434/#1435, 8994 ryttere, R² 0.959) · E1 værdi-gate merged (#1397). **Økonomi E2 + anti-inflation Fase 1 (#1438/#1442) ER i kode, deployet og migreret i prod** (`transfer_frozen`/`debt_breach_streak` findes på `teams`; `SPONSOR_INCOME_BASE=240k` er nu kun legacy-fallback — aktiv sponsor er division-skaleret {600/400/340k}, løn 0.067, upkeep {440/140/40k}). **Reelle resterende launch-blockers:** relaunch-stiens manglende undo/backup · orchestrator grøn ejer-verify · #1101-cutover-ack · #677. Race-motorens *dybde* (fuld fysiologi #1021) er det største world-class-gap, ikke en relaunch-blocker.

## Horisont — launch-kritisk vs world-class (adskilt)

**A. Launch-kritisk (nu → blød relaunch-checkpoint; 20/6 er IKKE hård deadline — fyrer kun når gates er grønne):**
1. **E2-økonomi + anti-inflation Fase 1 (`strict_fair_v1`) — ✅ LANDET (ikke længere blocker).** Verificeret mod kode+prod 2026-06-17: division-skaleret sponsor {600/400/340k}, løn ×0.067, upkeep {440/140/40k}, FINAL sponsor-clamp, hård gældsbund #97 — alt i `economyConstants.js` på main + migration anvendt i prod (`transfer_frozen`/`debt_breach_streak` findes). PR #1438/#1442 merged+deployet. **Fase 2** (forhandlbare sponsorer) + **Fase 3** (modbud) = POST-relaunch.
2. **Relaunch-stiens sikkerhed: backup/undo (HÅRD pre-req).** Korrektion 2026-06-17: server-gate FINDES (`assessTransitionReadiness`, #1346, merged 12/6) — men dækker KUN `POST /admin/season-transition`. Relaunch-orchestrator + cron + `executeSeasonTransition.js` kalder `transitionToNextSeason` **direkte og er bevidst ugatede**, og der er **ingen undo** for `runFullBetaReset`'s hårde DELETEs. Prod kører en levende sæson 2 → ét fejlklik sletter den permanent. **Verificerbar DB-backup/PITR SKAL på plads før prod-apply.** Detaljer: `docs/superpowers/specs/2026-06-17-relaunch-hybrid-engine-1307-design.md`.
3. **Relaunch-orchestrator grøn ejer-verify** (#1103/#1105) — dev-færdig + merged, afventer click-through mod preview-DB før prod.
4. **Staged akademi/daglig-træning-aktivering** (#1308/#1163, epic #1136) — kode-komplet, flag OFF; flip ON med tæt monitorering (aldrig kørt live på fuld population).
5. **Baroudeur værdi-anker + værdimodel-regression-test** — én af de 8 typer er mispriset (mangler anker); billig fix der beskytter den friske værdimodel.
6. **Ejer/comms/bugs:** PCM-dump IP-beslutning (#1276, ejer) · relaunch-comms (#1278) · lån/gæld-bugs (#45/#31/#97, E3) · skjul Hall of Fame/manager-XP (#1139, blød).

**B. World-class-vision (efter launch-gate; vægt: simulerings-dybde > polish/føl > indholds-bredde):**
- **Next (mod TdF 4/7):** (a) **fysiologi #1021 FØRST** — persistent form/træthed/recovery (erstat de neutrale 0-stubs; lukker "kondition afgør løb"-løftet) → (b) **taktik-dybde** (udbrud-timing, kaptajn-beskyttelse, lead-out-tog, hold-roller) → (c) **resultat-/spectation-UI** (#959 V2 + staged stage-by-stage reveal — gør den færdige motor følbar) → (d) **first-run onboarding-arc** (første auktion/transfer/race-milestones) → (e) **design-system-rollout HELT i mål (Plan 4) + frontend test/visual-regression-matrix** på core-flows.
- **Later (post-TdF, bredde):** mobil-first nav (bottom-nav, tabel-reflow) · post-sæson-recap + let auto-narrativ (#1311) · roster-vedligeholdelses-pipeline (verden føles endelig efter måneder) · **let multiplayer-liveness** (deadline-day-kompression, "N byder nu", aktivitets-feed — **bevidst nedprioriteret** jf. ejer-vægtning).

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

**Økonomi-korrekthed E2 = HÅRD launch-gate** (sponsor-division-scaling + løn ×0.67 mangler i kode; gældsloft på plads — detalje i Horisont A.1) + lån/gæld-bugs #45/#31/#97 (E3) · **season-transition/orchestrator server-gate + undo** (Horisont A.2) · legal #1276 · deploy-stabilitet #906 · security #929 · **verificerbare DB-backups** · #691 key-rotation · #563 secret-decommission.

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

## Eksekvering — første skridt

1. **Kollaborativ issue-oprydning** (github-housekeeping, gruppe for gruppe, INGEN autonom sletning): batch-luk verificerede done (#1347-1351, #1355, #1338, #1185, #1166, #1174, #1180, #1187, #1275); gennemgå dubletter/stale/mangler-done + grupper (monetisering, board-UX, bugs) med ejer. Luk #873 won't-do (findbar).
2. **Kick-off parallelt:** Track 3 + Track 1 #1 (race engine fuld dybde + stats) + Track 6 (højeste-payback loops).
3. **Instrumentér mens vi bygger** (Track 4 events).
4. **Etablér uge-rytmen straks** (Man/Ons/Fre).
5. **Relaunch (rigtig open beta)** fyrer når launch-gaten er grøn (Horisont A: E2 + orchestrator-verify + præsentable søjler). **Light-motoren (evner afgør) er nok til relaunch; fuld fysiologi-dybde er Next (post-relaunch, mod TdF)** — ikke en relaunch-blocker.

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
