# AI-triage 6/9 — 19 needs-ai-triage-issues (del B)

> Refs #3154. Metode: `gh issue view` (title/body/labels/comments) pr. issue + kode-grep mod `origin/main` (worktree `docs-triage-ai-b`, rebaset på origin/main 5/9) + kryds mod merged PR'er/lukkede child-issues. Ingen prod-mutation, ingen migration, ingen issue oprettet. Komplementerer del A og `docs/audits/stale-issues-audit-2026-09-04.md` (samme metode, andet udsnit) — ingen gentaget analyse hvor den allerede findes der (#2423, #2457, #2749, #1461 byggede videre på den).

## Samle-tabel

| # | Titel (kort) | Klassifikation | Handling denne runde | Begrundelse (kort) |
|---|---|---|---|---|
| [#3337](https://github.com/NicolaiDolmer/CyclingZone/issues/3337) | Specialisering: betaler bjergryttere/allroundere sig? | UDSKUDT | Kommentar, fjernet needs-ai-triage | Målt 5/8; hænger på B2-værdi/løn, udskudt til efter 27/9 |
| [#3112](https://github.com/NicolaiDolmer/CyclingZone/issues/3112) | Parallel session slettede ucommitteret arbejde | KLAR | Kommentar, fjernet needs-ai-triage | Færdigt scriptudkast i egen kommentar, aldrig wired ind (grep = 0 hits) |
| [#3092](https://github.com/NicolaiDolmer/CyclingZone/issues/3092) | Afinstallér ubrugt Manus Connector | (uændret) | Kun kommentar | needs-user-action/manual:user — kun ejer kan udføre |
| [#2794](https://github.com/NicolaiDolmer/CyclingZone/issues/2794) | Løbssiden: fane-opdeling mod informationsoverload | KLAR (2 trin) | Kommentar, fjernet needs-ai-triage, beholdt needs-design | Quick win (resultat-genvej) ubygget; fuld IA venter på mockup |
| [#2757](https://github.com/NicolaiDolmer/CyclingZone/issues/2757) | Pointtrøje vægter bjerge for højt | KLAR | Kommentar, fjernet needs-ai-triage | Løst for S2+ (PR #2777); fallback uden rutedata stadig fladt |
| [#2749](https://github.com/NicolaiDolmer/CyclingZone/issues/2749) | S1 prize-overbetaling 4,7M | KLAR | Kommentar, fjernet needs-ai-triage | Ejer skrev opgaven ordret 4/9, frist 11/9 |
| [#2720](https://github.com/NicolaiDolmer/CyclingZone/issues/2720) | Scouting: modstridende "verdensklasse"+"lav tillid" | KLAR (snævert) | Kommentar, fjernet needs-ai-triage | Kernemodsigelse nu forklaret i UI-tekst; kun overflow-spotcheck rest |
| [#2457](https://github.com/NicolaiDolmer/CyclingZone/issues/2457) | AI-holdenes rytterkvalitet pr. division | KLAR | Kommentar, fjernet needs-ai-triage | Ejer skrev "mål først"-opgaven ordret 4/9 |
| [#2423](https://github.com/NicolaiDolmer/CyclingZone/issues/2423) | Vercel: Skew Protection m.fl. | EJER-VALG | Kommentar, needs-decision tilføjet | 3 rettelsesforsøg rullet tilbage; ejer skal vælge videre investering vs. acceptere selvheling |
| [#2261](https://github.com/NicolaiDolmer/CyclingZone/issues/2261) | "High profile" rammer middelmådige ryttere | UDSKUDT | Kommentar, fjernet needs-ai-triage | Løses af omdømme-system PR3 (#1099), allerede besluttet 4/9 |
| [#2236](https://github.com/NicolaiDolmer/CyclingZone/issues/2236) | Organic community outreach | UDSKUDT | Kommentar, fjernet needs-ai-triage | Løbende founder-work-tracker, ejer poster selv |
| [#1569](https://github.com/NicolaiDolmer/CyclingZone/issues/1569) | Ny-spiller onboarding-audit | KLAR (snævert) | Kommentar, fjernet needs-ai-triage | Fase 1 shippet; ét P1-punkt (dismiss uden tærskel) stadig reelt og ubygget |
| [#1464](https://github.com/NicolaiDolmer/CyclingZone/issues/1464) | Forward-guard: finance/enum-typer | KLAR (snævert) | Kommentar, fjernet needs-ai-triage | Finance+notification leveret (PR #4458); kun loans-DDL-migration rest |
| [#1461](https://github.com/NicolaiDolmer/CyclingZone/issues/1461) | DMARC p=none → quarantine → reject | EJER-VALG | Kommentar, needs-decision tilføjet | Blokeret af ejer-test (bekræftelsesmail i indbakke) |
| [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) | [Epic] Langsigtet økonomi | EPIC | Statuskommentar, fjernet needs-ai-triage | Fase 1-3-A2 merged; grundregel-flip udskudt til efter 27/9 (allerede besluttet) |
| [#1375](https://github.com/NicolaiDolmer/CyclingZone/issues/1375) | [perf] Performance-arkitektur-tracker | EPIC | Statuskommentar, fjernet needs-ai-triage | Fase 0 delvist, Fase 1 åben; ingen ventende beslutning, kun eksekvering |
| [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310) | Markeds-pakke fast-follow | UDSKUDT | Kommentar, fjernet needs-ai-triage | Intet af scope bygget; ejer flaggede 18/8 at forudsætningen er overhalet |
| [#1136](https://github.com/NicolaiDolmer/CyclingZone/issues/1136) | [Epic] Progression & livscyklus | EPIC | Statuskommentar, fjernet needs-ai-triage | L0/L1/P2W done; L2/L3 aktive i egne issues; L4+ bevidst parkeret |
| [#1106](https://github.com/NicolaiDolmer/CyclingZone/issues/1106) | Multi-sæson visning | EPIC | Statuskommentar, fjernet needs-ai-triage | Delfunktioner leveret separat; kerne-ask ikke skala-testbar før flere sæsoner |

**Totaler:** KLAR 8 (heraf 4 med snævert restscope) · UDSKUDT 4 · EJER-VALG 2 · EPIC 4 · uændret (kun kommentar, ejer-handling) 1. **0 lukket, 0 dublet, 0 nyt issue oprettet.**

## Til ejeren — kun EJER-VALG, ét ad gangen

1. **#2423 — Skal jeg blive ved med at forsøge Skew Protection, eller er selvheling godt nok nu?** Tre forsøg på at pinne spillere til deres deploy-version er alle rullet tilbage i prod (senest en cookie der ramte alle med gammel cookie efter et nyt deploy). Den nuværende mitigation (selvheling + ét-vindue-deploy-disciplin) virker, men er ikke en rigtig fix. **Anbefaling:** accepter den nuværende mitigation og stop yderligere forsøg indtil chunk-fejl-gaten faktisk viser et problem den ikke fanger — tre mislykkede forsøg er nok.

2. **#1461 — Har du testet at bekræftelsesmailen lander i indbakken (ikke spam)?** Det er det eneste der mangler før DMARC kan strammes fra ren overvågning til reel spoofing-beskyttelse. **Anbefaling:** test det (2 minutter, opret en ny bruger på cyclingzone.org), og flip til `quarantine` med det samme hvis den lander i indbakken — det er reversibelt.

## Bekræftelse

19/19 issues fik en `AI-triage 6/9:`-kommentar. Labels ændret kun som beskrevet ovenfor (needs-ai-triage fjernet fra 18 issues; needs-decision tilføjet til #2423 + #1461). #3092 fik kun en statuskommentar (needs-user-action/manual:user uændret, per instruks). Ingen issue lukket, ingen dublet fundet, ingen nyt issue oprettet.
