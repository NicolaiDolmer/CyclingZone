# CyclingZone — kvalitets-drevet plan mod TdF (levende strategi-plan)

> **SSOT for sekvensering/prioritering.** Etableret 2026-06-15 (stor strategisk re-plan, ejer-godkendt). Arbejdsudkast: `~/.claude/plans/brug-plan-mode-og-shimmering-forest.md`. Spil-motor-design = `docs/superpowers/specs/` + `plans/` (røres ikke — bruges ved bygning).
> **Model:** Kontinuerlige, meningsfulde kvalitets-forbedringer — IKKE et datofikseret big-bang.
> **To pejlemærker (ikke deadlines):** (1) Den rigtige open beta (frisk sæson) i gang hurtigst muligt. (2) Spillet reelt *startet* + store forbedringer + race engine i fuld dybde live **før TdF 4/7**.

## Context

Ejer-korrektion 15/6: MVP-kvaliteten har været for lav, og 20/6 må ikke styre tankegangen. Spillet ER de fem motorer (Races, Training, Youth, Transfers/Auctions, Club & World) — race engine er vigtigst. Uden ryttere, løb, stats, udvikling og ungdomsryttere synlige, pæne, præsentable og **fejlfrie** er resten ligegyldigt for brugerne. Bar: pænt/godt/præsentabelt/fejlfrit → derefter bygge til "fantastisk" og betalbart. Tracking/community/ops/cleanup er STØTTE — må aldrig fortrænge søjle-kvalitet.

**Arbejdsstandard (verdensklasse, end-to-end):** hver søjle-forbedring udføres hele kæden — data → migration → merge → UI-verify → patch notes. Refactor + dead code i samme PR. Fix selv de mangler du flagger.

## Kvalitets-bar

- **Live-bar = "præsentabelt + fejlfrit":** roadmap'ens "Today"-løfter er SANDE + polerede + ingen bugs + ingen slop.
- **Build-to-fantastic = roadmap'ens "Next"-items**, drevet af ugentlig Feature Friday + voting.

## KRITISK kvalitets-løgn at lukke FØRST

Roadmap'ens "Today" lover at form/taktik former udfaldet — men evnerne er "beta, påvirker ikke resultater". Stats/træning er i praksis dekoration. **Race engine skal i fuld dybde, hvor evner+form faktisk afgør løb, før den går live — ellers er roadmap'en usand.**

## Track 1 (SPINE) — Søjle-kvalitet i roadmap-rækkefølge

1. **Race engine i FULD DYBDE + stats/evner (LÅST SAMMEN — motoren spiser stats).** Byg PÅ eksisterende design: `docs/decisions/race-engine-architecture-v1.md`, `docs/briefs/1102-race-engine.md`, `docs/superpowers/plans/2026-06-11-1102-race-engine-runtime-wiring.md`, `.../2026-06-11-daily-training-form-fatigue.md`, `docs/decisions/rider-ability-system-v2.md`, `docs/superpowers/specs/2026-06-11-kernesystemer-design.md`.
   - Evner afgør resultater (#1122 live, fjern "beta"); stats backfilled + ægte motor-input.
   - Fuld fysiologi (#1021): form fra træning + løbsdags-træthed, ikke kunstige konstanter.
   - Udbruds-/taktik-dynamik (kaptajn/hjælpere/jægere) realistisk.
   - Resultater viser tider + gaps + per-etape-klassement (#959 V2); resultat-UI-polish.
   - Empirisk dry-run-harness mod fiktiv population + mål-scorecard FØR live.
2. **Training** præsentabel+fejlfri: kontekst/labels, loading/fejl-states, mobil, fjern emoji.
3. **Youth/Akademi** præsentabel+fejlfri: potentiale-kontekst + SVG-stjerner, progress, sortering/filter, free-agent-forklaring.
4. **Transfers** fejlfri: swap-cash-bug, 14-stat swap-kort, loan-UI, EN-strings, mobil.
5. **Auktioner** fejlfri: a11y-modal, watchlist-toast, sælger-null, mobil-input, aria-live countdown.

## Track 2 — Færdiggør UI/UX-migrationen (ÉT konsistent produkt)

Plan 4 UI-foundation-rollout (`docs/superpowers/plans/2026-06-15-ui-foundation-plan4-rollout.md` + `.../specs/2026-06-14-design-system-foundation-design.md`) HELT i mål på ALLE flader — ingen to forskellige UI'er. Per-flade-migration (side + child i én PR). Emoji→SVG. RaceSignature ægte data · 375px mobil-audit · dark-mode kontrast.

## Track 3 — Central must (forudsætning)

Økonomi-korrekthed E2 + lån/gæld-bugs #45/#31 · legal #1276 · deploy-stabilitet #906 · security #929 · **verificerbare DB-backups** · #691 key-rotation · #563 secret-decommission.

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
5. **Relaunch (rigtig open beta)** live så snart Track 3 + præsentable søjler + fuld-dybde race engine er klar — før TdF.

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
