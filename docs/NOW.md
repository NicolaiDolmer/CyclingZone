# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** arkitekt i hovedtråden, sonnet-workers i worktrees; PR der afventer justering = draft. **Hard rule 24 (ny 18/8):** orkestratoren ejer e2e-slottet ved parallelle workers.

## Aktiv styring

> **🎯 Næste action: LØN-DESIGN-SESSION 19/8 formiddag** ([prompt](sessions/2026-08-19-loen-design-session-prompt.md)) — åbner med go på KS3's to parkerede drafts (S2-recap + etapeside #3914) + v7.144 når merge-køen er landet. Ugen: trin 7 ons (inkl. #3592 + #3924 trænings-følelsen) → kalender-session (PR #3862 + regenerering + **bufferdag 24/8 besluttet**, #3467) → race-UI PR B (LIVE-broadcast) tor/fre → cutover søndag 23/8.

> **✅ KS3 LUKKET 18/8** ([audit](audits/2026-08-18-kvalitetssession-3.md)): **D1-plan LÅST+BYGGET** (PR #3930 merged, dry-run godkendt — apply ejer-gated søndag m. frosset snapshot) · designs låst: #3899/#3900/#3924 · backlog net −32 (500 åbne). Merge-køen fra KS3 er landet og v7.144 skrevet (se session-linjen nedenfor).

> **💰 Værdi-sporet:** beslutning 1-5+7 truffet; **nøglefund: kørende × 0,422 slår alt** → niveau-korrektion i løn-sessionen. Åbne: #3755 · #3756 · #3732 · #3733 (design låst). #3449 draft til løn-sessionen.

> **📅 Cutover søndag 23/8** = race-day-flip + D1-komprimering + mandat-backfill (drejebog + værktøj + komprimering ALT merged/bevist). **👤 Ejer-klik: POST race-day-beskeden FØR søndag** ([cutover-beskeder](discord/2026-08-17-cutover-beskeder.md) besked 1) · Sentry-alarmregel · #3486 `VERCEL_TOKEN`.

> **📌 Opfølgninger:** #3661 er REELT ÅBEN (falsk done — de 4 design-proces-regler mangler i AGENTS.md; fanget af KS3's adversarielle verifikation) · #2884 anti-snipe mangler · sparkline-komponenten ligger klar til #3721-strukturdesignet (rytterprofil+træningsside designes SAMLET, ejer-krav 18/8) · #3592→trin 7 · W7 efter trin 7 · W8-bundter (54 needs-decision) · #3796/#3797 growth. Ops-gæld: 500 åbne.

> **🚨 Incident 18/8 LØST (#3934, PR #3937 merged + migration applied):** #3420-constrainten gjorde sweepens rytter-swaps til 23P01-dødvande (~350 enheder/tick; Avesnois kørte m. 23 underfyldte hold). Fix: constraint DEFERRABLE + batch-RPC pr. hold + completion-trigger på binding_span. Verificeret i prod: 0 fejlede enheder. Opfølgning: raceRunner/regenerate på samme RPC (én writer). v7.143 patch note skrevet.
> **🚨 Incident 18/8 aften LØST (#3961, PR #3962 auto-merger):** en efterladt lokal staging-backend (trin 7-scriptet, mod branch-klonen med kopieret `discord_settings`) re-simulerede snapshot-løb og postede 60 falske resultat-embeds til rigtige spillerkanaler 20:32–21:41. Proces dræbt, live-guard bygget (Discord kræver prod-DB), evidens+slette-script klar. **👤 Ejer-klik: kør slette-scriptet (60 opslag) + evt. kort spillerbesked.** Postmortem: `.claude/learnings/2026-08-18-staging-backend-poster-til-prod-discord.md`.
> **🤖 Aktive sessioner: Ingen aktiv session.** Spilleroplevelses-design-sessionen 18/8 aften LUKKET: Discord-sweep → 5 issues (#3954-#3958) + evidens på #2884/#3513/#3592 · session-prompten 19/8 omskrevet (nordstjerne-loop, 3721-mockup + 7-fane-plan = plan-of-record) · **ejer-valg B låst: /training får faner Squad / Yesterday's gains / History** (#3721/#3924-kommentarer) · trin 7 visuelt go IKKE givet endnu — er åbningsbeslutningen i spilleroplevelses-sessionen; strukturbygget venter på trin 7-merget. Feedback/workflow-sessionen 18/8 LUKKET: 10 PR'er merged (6 UI + #3931 + #3946 setback-fjernet + #3947 modbud/auktion-guard + #3949 Race Control), patch 7.144 (9 entries), 8 issues lukket, kompensation 15.000 udbetalt+verificeret (A4), forum-hovedsvar postet af ejer. Svarudkast-pakke: `docs/discord/2026-08-18-svarudkast-uge33.md` (ejer sender resten). Nye: #3948 board-mål-tekst · #3950 etape-bot (ejer-go) · #3951 handelsmønster-undersøgelse (egen session) · #3952 radius (ejer vil se før/efter FØRST). **Næste spilleroplevelses-session: [prompt klar](sessions/2026-08-19-spilleroplevelse-session-prompt.md)** (resultat-øjeblikket 16-18 + trin 7-opfølgning + scouting 2.0). Kør IKKE radius-bølgen uden ejer-go på eksempler.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold (komprimering). **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben (service-key-rotation). **Skalering:** #323 (paraply; 330-332 lukket).

_Historik i git-log, issue-tråde + docs/audits/._
