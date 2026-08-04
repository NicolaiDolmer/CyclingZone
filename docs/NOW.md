# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action:**
> 1. **Næste session (anbefalet):** **kalender-blokken før #3295** (deadline 23/8) — #3327 D2-dækning · #3328 klasse↔længde · #3326 etaperækkefølge · #3329 D1-overlap. Derefter tillids-bugs #3333/#3330/#3332 + guard #3331. Alternativ: motor-køen (#3145 bekræftet ITT-fejl, #3149/#3150/#2944).
> 1b. **#3325 (ryttertyper) klar til ejer-review:** ejer-beslutning "ren B" (potentiale, alle aldre) noteret på issuet. Draft-PR [#3343](https://github.com/NicolaiDolmer/CyclingZone/pull/3343) bygget + målt (climber+tt 94%/90% ned til ~40%/12%), 2 af 8 typer (rouleur 2,1%, brostensrytter 2,2%) lige under 3%-scorecardet, IKKE merget, backfill IKKE kørt mod prod.
> 2. **Hos ejeren:** Resend-nøgler + mailtekst-godkendelse (#2853, ~15 min, tænder intet — kæden er deep-linket og flip-klar) · #3300's 3 designsvar · Railway MCP re-auth · penge-kæden #2813 · #3147-basekadence (lavtryk nu) · beslutnings-ark 60 sager · logo #481.
> 3. **Måle-datoer:** ~18/8 payoff-mål (≥60 % ser første resultat, baseline ~34 %) + dag-1-effekt via get_cohort_retention på /admin/growth.

> **🟢 4/8 dag (Fable-orkestrator, ejer-go "10-15 opgaver"):** Sponsor-audit → kritisk betalingsfejl fundet+fixet (#3315) og **204.204 CZ$ efterbetalt WolkerWessels** (verificeret) · mid-season-sponsorkontrakter live (#3316) · retention-design → spec + plan + fuld slice bygget (PR #3323, dobbelt-reviewet pipeline) · dagbølge 14/14 spor (8 PRs merged i dag, 2 migrationer applied, 5 investigations-rapporter) · bug-pakke 6/6 · required checks 16→24 (#3259) · dag-1-retention-tallet KORRIGERET: ~31 % seneste 2 uger (var ~64 % juni), last_seen-metode (#3310). Detaljer: [night-wave-2026-08-04-dagboelge.md](audits/night-wave-2026-08-04-dagboelge.md) + [night-wave-2026-08-04.md](audits/night-wave-2026-08-04.md) (nat/morgen). Hændelser: 2 chunk-frys (recovered) + privacy-læk (scrubbet) — postmortems i .claude/learnings/.

> **🔴 Platform:** Prod 191 brugere, 54 aktive/7d. **Dag-1 ~31 % seneste 2 uger (var ~64 % juni) — last_seen-metode, #3310.** #2853 venter på Resend-nøgle (e-mail-kæden er nu deep-linket og flip-klar). #2736 Alunta-cron: tjek første kørsel ~23:49. Railway MCP kræver re-auth.

> **📌 Åbne opfølgninger:** #3145 ITT-motor-fejl (bekræftet 4/8) · #3112-guard (forslag klar) · de 5 pending-D4-kontrakter (aktiveres ikke automatisk, jf. #3319-PR-body) · #3307-relateret unchecked-delete OK · #3290 lukket · #2164 (ved S2→S3) · #3172 (luk ~18/8) · #3275 draft = reseed-fundament · #3189→#2041-rest.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen**. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 4/8 aften (dagbølge-close-out). Historik i git-log, issue-tråde + docs/audits/._
