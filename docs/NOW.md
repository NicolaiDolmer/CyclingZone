# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (re-synket 3/8; bølge A leveret, rækkefølge B/C/D/E uændret). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action:**
> 1. **Design-session: første-sessions-retention** ([#3310](https://github.com/NicolaiDolmer/CyclingZone/issues/3310) = måltal + funnel, klar som grundlag). Dag-1 falder 38 %→19-24 %; 73/76 nye holds HAR kørt løb, kun 34/80 åbnede en løbsside. Ikke pacing, men gen-engagering → #2853 Resend-nøgle er blokeren. **Anbefalet omprioritering foran #3295 — afventer dit ja.**
> 2. **Cutover-kæden kører som planlagt opgave** ([#3295](https://github.com/NicolaiDolmer/CyclingZone/issues/3295) S3-kalender, hård deadline 23/8) + #3306 form-reset-annoncering FØR cutover. Design-sessions i kø: gruppe-balance (#2557; is_academy-fix i poolBalance FØRST) · forum/beskeder (#3199+#3200) · #1150.
> 3. **Autonom bug-pakke klar** (sig "kør bug-pakken"): #3297 sortering · #3298 redirect · #3299 træthed-kolonne · #3142 intake-fejl · #3212 scout-bånd. Dertil #3300 (ejer-direktiv, high) og #3154 backlog-sweep som natbølge-kandidat.
> 3. **Hos ejeren:** penge-kæden #2813 (gates + flip-go) · RESEND-nøgle (#2853/#3201) · klik-pakken (#2892/#2076/#419/#3235) · logo #481 · Supabase-toggles (kører i anden session) · Discord-roundup-udkast leveret i chat 4/8 (poster selv/godkender) · "TAU 0,40→0,45" fra natprompten kunne ikke matches til koden — definér hvilket system.

> **🟢 4/8 nat+morgen (Fable-orkestrator): 28 PRs merged, patch 7.89+7.90 live, 12 issues lukket m. evidens, 3 migrationer applied+verificeret.** Højdepunkter: etaperapporter+udtagelses-indsigt (#3115/#2356) · sæson-recap (#2752-del) · 36t-varsel+auto-udtag (#2180-backend) · welcome-notif (gap 2a-hypotesen modbevist) · akademi-økonomi (#2793, backfill 300/59) · offentlige sider (#2042A) · cutover-preflight+runbook · decay-claim-guard · #3172-rodårsag · adversarial verify fangede 5 talfejl. **Ejer-beslutninger 4/8:** karantæne AFVIST (styrke straffes aldrig — memory-låst) · reseed → design-session · prisbånd #3133 pauset · **merge-flow omlagt: strict=false, alle 16 checks består** (grønne PRs merger straks; Merge Queue kræver org-repo — merge_group-triggerne i dvale, org-flytning = senere mulighed). Detaljer: [night-wave-2026-08-04.md](audits/night-wave-2026-08-04.md).

> **🔴 Platform:** Prod 191 brugere, 54 aktive sidste 7 dage. **Dag-1-retention 19-24 % seneste 2 uger (var 38 % i juni) — målt 4/8, metode i #3310.** #2853 venter på Resend-nøgle. #2736 Alunta-cron: første kørsel ~23:49 4/8 (tjek næste nat; fornyelse 31/8). Railway MCP kræver re-auth (interaktiv session). Playwright mobile-webkit lokalt = miljø-issue, CI gater. ~~Lokal main-checkout hænger~~ **ryddet 4/8: main = origin/main, 11→2 worktrees, 97→3 lokale branches.**

> **📌 Venter i øvrigt på dig:** beslutnings-arkets 60 sager ([ark](audits/beslutnings-ark-2026-07-30.md)) · #2830 · #3109-#3112 · #2881 · #2699 · #3140 off-season-buffer · #3147 sponsor-udbetalinger · sessioner: #2622/#2675/#2650.

> **📌 Åbne opfølgninger:** **#3306 form-reset aldrig annonceret + modstridende patch note (FØR S2→S3, high)** · #3309 grace-kolonne mangler i auction_timing_config · #3307 unchecked-delete-guard re-apply (reddet branch) · #3290 (RPC-hul, omkring 23/8) · #2164 (ved S2→S3) · #3172 (luk ~18/8) · #2180-rest (frontend-knap + Discord-valg) · #3275 draft = reseed-fundament · #3145/#3146/#3150/#2944/#3149 (motor-kø) · #3189 Clarity-verifikation (+#2041).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen** (game_day er pulje-relativt; jf. #3185-forensik). Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 4/8 (morgen-close-out. Historik i git-log, issue-tråde + docs/audits/)._
