# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action:**
> 1. **Merge-kø (16 draft-PR'er, rækkefølge + gates i [night-wave-2026-08-05.md](audits/night-wave-2026-08-05.md)).** Start med backend-only-blokken (#3352 security, #3355 akademi, #3354, #3356, #3358, #3359, #3351), så ryttertype-kæden #3343→#3348→#3357 samlet, så kalenderen #3344+#3346 før S3 bygges. **#3339/#3341/#3343 er CONFLICTING** (patchNotes) — kræver manuel opløsning; rebase udefra i agent-worktrees virker IKKE (prøvet, afbrudt uden skade).
> 1b. **Tidskritisk før 23/8:** godkend akademi-reparations-SQL (#3355 — ellers frigives 22 ryttere fejlagtigt) · #1150-kæden (1.399 ryttere) · katalog-migrationen til #3344. Alle idempotente m. post-verify i `database/proposals/`, ingen kørt.
> 1c. **Ejer-klik:** 37 Sentry cron-monitorer skal Enable'es manuelt (liste i PR #3351).
> 2. **Hos ejeren:** Resend-nøgler + mailtekst-godkendelse (#2853, ~15 min, tænder intet — kæden er deep-linket og flip-klar) · #3300's 3 designsvar · Railway MCP re-auth · penge-kæden #2813 · #3147-basekadence (lavtryk nu) · beslutnings-ark 60 sager · logo #481.
> 3. **Måle-datoer:** ~18/8 payoff-mål (≥60 % ser første resultat, baseline ~34 %) + dag-1-effekt via get_cohort_retention på /admin/growth.

> **🟢 4/8 dag (Fable-orkestrator, ejer-go "10-15 opgaver"):** Sponsor-audit → kritisk betalingsfejl fundet+fixet (#3315) og **204.204 CZ$ efterbetalt WolkerWessels** (verificeret) · mid-season-sponsorkontrakter live (#3316) · retention-design → spec + plan + fuld slice bygget (PR #3323, dobbelt-reviewet pipeline) · dagbølge 14/14 spor (8 PRs merged i dag, 2 migrationer applied, 5 investigations-rapporter) · bug-pakke 6/6 · required checks 16→24 (#3259) · dag-1-retention-tallet KORRIGERET: ~31 % seneste 2 uger (var ~64 % juni), last_seen-metode (#3310). Detaljer: [night-wave-2026-08-04-dagboelge.md](audits/night-wave-2026-08-04-dagboelge.md) + [night-wave-2026-08-04.md](audits/night-wave-2026-08-04.md) (nat/morgen). Hændelser: 2 chunk-frys (recovered) + privacy-læk (scrubbet) — postmortems i .claude/learnings/.

> **🔴 Platform:** Prod 191 brugere, 54 aktive/7d. **Dag-1 ~31 % seneste 2 uger (var ~64 % juni) — last_seen-metode, #3310.** #2853 venter på Resend-nøgle (e-mail-kæden er nu deep-linket og flip-klar). #2736 Alunta-cron: tjek første kørsel ~23:49. Railway MCP kræver re-auth.

> **📌 Åbne opfølgninger:** #3145 ITT-motor-fejl (bekræftet 4/8) · #3112-guard (forslag klar) · de 5 pending-D4-kontrakter (aktiveres ikke automatisk, jf. #3319-PR-body) · #3307-relateret unchecked-delete OK · #3290 lukket · #2164 (ved S2→S3) · #3172 (luk ~18/8) · #3275 draft = reseed-fundament · #3189→#2041-rest.

> **🟢 Natbølge 4.-5./8 (19 spor, 0 merges — merge kræver ejer-go):** **16 draft-PR'er** klar til review, merge-rækkefølge i [night-wave-2026-08-05.md](audits/night-wave-2026-08-05.md). **Nye brændende fund:** [#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360) pengemængden firdobles over 5 sæsoner (4,24× mod mål 1,3×) — gaten skjulte det gennem hele betaen · #1150 er ikke 807 men **1.399** udløbende ryttere, 170/180 hold berørt, AI havde ingen fornyelse (PR #3362) · #2881: samme bug fandtes uopdaget et 2. sted, **22 ryttere frigives fejlagtigt 23/8** uden reparation (PR #3355) · 44/115 target_race_ids peger allerede på døde S1-løb (PR #3361). **Syntese af 9 målinger:** [simulation-drift-synthesis.md](audits/2026-08-05-simulation-drift-synthesis.md). Ejer-beslutninger 4/8: ryttertype = potentiale for alle · D2 ~50/50 · ProSeries 3-5 / WT 6-8 · typer+værdier samtidig (løst via frossen `valuation_type`, total uændret 993M) · katalog-udvidelse godkendt.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen**. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 4/8 aften (dagbølge-close-out). Historik i git-log, issue-tråde + docs/audits/._
