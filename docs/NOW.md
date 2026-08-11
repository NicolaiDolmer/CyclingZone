# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.
> _Revideret 11/8: hver linje verificeret mod GitHub + prod. Fem påstande var forældede — se close-out-commit._

## Aktiv styring

> **🎯 Next action:** **spiller-tilliden først.** Tre ting rammer spillerne NU, og de kommer før al 23/8-mekanik: **[#2650](https://github.com/NicolaiDolmer/CyclingZone/issues/2650)** (træthed rammer kun spillere — genmålt 11/8: AI median 0 / 0 på 95+, human median 82 / **925 af 3.399 på 95+**; PR #3246 rettede AI-siden 3/8, human-siden aldrig) + **[#3461](https://github.com/NicolaiDolmer/CyclingZone/issues/3461)** (samme kæde) · **[#3580](https://github.com/NicolaiDolmer/CyclingZone/issues/3580)+[#3578](https://github.com/NicolaiDolmer/CyclingZone/issues/3578)** (penge uden modydelse, ingen PR endnu; [#3582](https://github.com/NicolaiDolmer/CyclingZone/issues/3582) = vi kan ikke verificere invarianten bagud) · **[#3620](https://github.com/NicolaiDolmer/CyclingZone/issues/3620)** (kontrakt-udløb forkortes stadig — ny rapport 10/8 EFTER #2881 blev lukket 6/8).

> **📅 To datoer, én dag fra hinanden:** cutover **23/8** (markedsvægt→1,0 → #3393 løn → race-day-flip #3459 → mandat #3514) og **S3 starter 24/8**. Rollback-plan pr. komponent mangler stadig. Før da: sweep-drejebog **søndag 16/8** ([#3448](https://github.com/NicolaiDolmer/CyclingZone/issues/3448)/PR #3449 — 8 CodeRabbit-fund + T4-gates først) + #3632-prod-verifikation (akademi-intake er søndags-gated).

> **🧬 Progressionskæden ([#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564), spec v0.4 §11-12 = SSOT).** Alle fire beslutninger låst (A+B 9/8, C+D 11/8). Sekvensen står i §12. **Før 16/8:** [#3593](https://github.com/NicolaiDolmer/CyclingZone/issues/3593) (577 tomme sekundær-anlæg udfyldes fra kolonnen) → [#3591](https://github.com/NicolaiDolmer/CyclingZone/issues/3591) pkt. 2 (kaldformen ER rettet i PR #3598; det åbne er kontrolleret re-derive af AI-caps m. dry-run + ejer-go — 61,6 % skifter type). **16/8→23/8, kun flow:** [#3631](https://github.com/NicolaiDolmer/CyclingZone/issues/3631) → [#3634](https://github.com/NicolaiDolmer/CyclingZone/issues/3634). **Efter 23/8:** trin 1-PR-kæden (PR-0 #2798 → PR-1 1-99 → PR-2 remap −6,7 %) → trin 2-kurven → trin 3 (#3616 hører her).

> **🔓 Muligt unblock — tjek FØR du spørger mig:** [PR #3512](https://github.com/NicolaiDolmer/CyclingZone/pull/3512)s `race:gate` var rød fordi populationen var kalibreret mod #3295's **fremtidige** kalenderprofil. **#3295 blev lukket 6/8** (455 løb + 1130 profiler live), og S3 starter 24/8. Option A ("vent på #3295") er dermed forældet. Kør gaten igen mod den byggede S3-kalender før A/B/C-spørgsmålet overhovedet stilles.

> **👤 Dine klik:** [#3585](https://github.com/NicolaiDolmer/CyclingZone/issues/3585) FØRST (Day 1-mailen selecter en kolonne der ikke findes → fejler for ALLE hold i det sekund loopet tændes), derefter #2853 + [#3600](https://github.com/NicolaiDolmer/CyclingZone/issues/3600) (loopet genforsøger aldrig) · [#3486](https://github.com/NicolaiDolmer/CyclingZone/issues/3486) `VERCEL_TOKEN` (2 min, låser #1784; CLI er stadig ikke installeret) · [#3553](https://github.com/NicolaiDolmer/CyclingZone/issues/3553) udløbet PAT — **eneste røde check på hver eneste PR** · #2813 penge-gates · **POST kommunikationspakken + akademi-kompensationen** (`docs/discord/2026-08-10-*.md`, EN+DA klar) — `#patch-notes` er angiveligt 4 dage bagud (v7.106-7.116 aldrig meldt ud); ikke verificeret af mig.

> **🧹 Vedligeholds-gæld (nyt 11/8 — den reelle blocker bag "vi skubber ting rundt"):** **549 åbne issues** mod ejer-direktiv [#3154](https://github.com/NicolaiDolmer/CyclingZone/issues/3154) (26/7: "ned til ~200 på 7-14 dage"). Kurven går den forkerte vej: 466 den 26/7 → 529 den 30/7 → **549 nu**. **51 åbne `claude:done`** (var 6 den 30/7) — puklen er tilbage, og et done-men-åbent issue er præcis det der får os til at dobbeltarbejde. Desuden: #623 blev lukket 25/5 med "decision om at bygge routine kan splittes til ny issue" — den blev aldrig oprettet, og dæknings-guarden findes stadig ikke (målt miss-rate 5 %).

> **📌 Åbne opfølgninger:** [#3586](https://github.com/NicolaiDolmer/CyclingZone/issues/3586) skema-guard i CI (fandt #3585 blandt 553 selects) · [#3587](https://github.com/NicolaiDolmer/CyclingZone/issues/3587) tavs auto-accept-cron · [#3628](https://github.com/NicolaiDolmer/CyclingZone/issues/3628) `toggleDmPref` lyver om tilstanden · #2409 Railway-MCP-token · #3353/#3349/#2645/#2164 · [#3614](https://github.com/NicolaiDolmer/CyclingZone/issues/3614) (ejer-parkeret) · [#3633](https://github.com/NicolaiDolmer/CyclingZone/issues/3633) slet backup-tabeller efter 23/8. Køen efter cutover (ejer 7/8): indbakke #2223 → mandat-UI #3514 → dashboard #3513 → React 19 #2960 (uge 1 sept).

> **🤖 Working agent:** Ingen aktiv session. Merged 11/8: #3617 (v7.112) · #3630 (v7.113) · #3636 + **#3637** (e2e-friktion, #3554 lukket, #3601 delvist) · #3635 (#3632, v7.114) · #3618 (v7.115) · #3627 (v7.116). Åbne PR'er: 3 drafts (#3512 · #3449 16/8 · #3393 23/8). Harness på main: `simSecondaryArchetype3632.js`. [Postmortem 11/8](../.claude/learnings/2026-08-11-maalinger-der-bliver-mildere-af-det-de-skal-maale.md) (+ tilføjelse: at tælle kopier rigtigt hjælper ikke, hvis man kun tæller langs én akse).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; D1 = kun AI. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag i puljen. **Pension:** måles på AFSLUTTET sæsons alder.
- **Sikkerhed:** #691 · #929 · #2802/#2803 åbne. **Skalering:** #323 (~300 brugere).

_Historik i git-log, issue-tråde + docs/audits/._
