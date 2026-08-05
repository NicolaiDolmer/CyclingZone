# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action:**
> 1. **Ryttertype-backfillen (`backend/scripts/backfillRiderTypes.js`) skal køres i god tid før 23/8.** Fundamentet er på plads: `valuation_type` er APPLIED (8.171/8.171, post-verify `valuation_type = primary_type` for alle = kørt før reklassificeringen, som krævet). Økonomien er dermed frosset, så backfillen ikke kan flytte trupværdier. Roadbook-udkast til spillerne ligger klar og afventer dit go.
> 2. **Ejer-beslutning, brænder: [#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360)** pengemængden firdobles over 5 sæsoner (4,24× mod mål 1,3×). Er tærsklerne forkerte, eller er økonomien? Sandsynligvis spillets alvorligste balance-problem.
> 3. **[#3349](https://github.com/NicolaiDolmer/CyclingZone/issues/3349) terræn-mixet:** for meget fladt, for lidt kuperet, og climber er stadig ~40 % efter #3343. Foreslået næste skridt: research som `docs/research/2026-08-04-stage-race-structure/`, men på ægte felt-sammensætning, så generatoren får et måltal i stedet for et skøn.
> 4. **Hos ejeren:** #3363 (lånebekræftelse) + #3275 (pulje-reseed) mangler go — begge draft. Resend-nøgler + mailtekst (#2853) · #3300's 3 designsvar · Railway MCP re-auth · penge-kæden #2813 · logo #481 · 37 Sentry cron-monitorer skal Enable'es manuelt (liste i PR #3351).

> **🟢 5/8: merge-køen tømt (12 PR'er merged), 3 migrationer applied.** #3380 patch notes · #3368+#3381 pagination-guard · #3366 sæson-recap · #3362 kontraktudløb · #3365 i18n-flimmer · #3357 frossen valuation_type · #3382 CodeQL · #3339 finansprognose · #3369 scouting · #3341 resultat-hub. **Migrationer kørt + post-verificeret:** katalog-udvidelse (race_pool 136→151, D2's forsyningsmangel lukket) · `valuation_type` (8.171 ryttere) · akademi-reparationen var allerede kørt (32 kontrakter i alt, verificeret). **Rettet undervejs:** pagination-guardens baseline var Windows-genereret og matchede intet i CI (guarden var uvirksom fra første kørsel) · #3365 brækkede landing-hydrationen (verificeret mod ren main) · 4 CodeQL-alarmer lukket ved at pinne href i stedet for delstreng. Detaljer: [night-wave-2026-08-05.md](audits/night-wave-2026-08-05.md).

> **🔴 Platform:** Prod 191 brugere, 54 aktive/7d. Dag-1 ~31 % seneste 2 uger (var ~64 % juni), last_seen-metode ([#3310](https://github.com/NicolaiDolmer/CyclingZone/issues/3310)). #2853 venter på Resend-nøgle. Railway MCP kræver re-auth.

> **📌 Åbne opfølgninger:** [#3367](https://github.com/NicolaiDolmer/CyclingZone/issues/3367) worktree-isolation SKAL lukkes før næste bølge (nu hard rule 14) · #3353 V4-refit (fjerner `valuation_type` igen) · #3145 ITT-motor-fejl · #3112-guard · #2830 write-grants-SQL er ureviewet, ikke kørt · #2645 Del B + #2022-resten er ejer-gated/uløst · #3172 (luk ~18/8) · #2164 (ved S2→S3).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen**. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 5/8 (merge-kø-close-out). Historik i git-log, issue-tråde + docs/audits/._
