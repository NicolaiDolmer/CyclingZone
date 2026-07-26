# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring — S2 ER LIVE

**✅ CUTOVER S1→S2 GENNEMFØRT 26/7 19:35-22:30** (transition completed 21:32; fuld verifikations-rapport i [#2846](https://github.com/NicolaiDolmer/CyclingZone/issues/2846)-kommentaren). Komprimeringen = præcis den godkendte 48/96/12-liste. 155 season_ended + 155 season_started, sponsor 58,31M/156 hold, payroll 3,24M, fatigue 0,00, 1.754 planer carried, 35 pensioneret (ny ejer-regel: pension på AFSLUTTET sæsons alder), 37.831 S2-entries, achievements+honours live, 7 gated issues lukket. **S2 dag 1 = MANDAG 18:00-20:40** — aftenvagt fra 17:45 (drejebogens skridt 8).

> **🎯 Next action (ejer):**
> 1. **[#3037](https://github.com/NicolaiDolmer/CyclingZone/issues/3037): Easy Riders mistede 9/12 ryttere** (nyt hold 25/7, starter-kontrakter udløb ved S1-slut) — make-good-beslutning FØR mandag aften hvis muligt (retention!).
> 2. **Review/merge [PR #3040](https://github.com/NicolaiDolmer/CyclingZone/pull/3040)** (cutover-hotfixes: .in()-chunkning ×2, admin_log-FK, pensions-regel — alt allerede runtime-verificeret i prod; server kører gammel kode til merge+deploy). Draft-PR #3029 (#230) kan nu også merges (cutover + skridt 7 er færdig).
> 3. Ejer-ja udestår fortsat: #2881 datareparation · #2892 Sentry-kvote · #1903 abonnement-tjek · svar-ark 49 A/B-beslutninger i [`docs/audits/2026-07-26-ejer-beslutnings-batch.md`](audits/2026-07-26-ejer-beslutnings-batch.md).

> **📌 Nye opfølgninger fra cutoveren:** [#3037](https://github.com/NicolaiDolmer/CyclingZone/issues/3037) (starter-kontrakt-udløb for nye hold) · [#3038](https://github.com/NicolaiDolmer/CyclingZone/issues/3038) (#2805-spærren vs 142 dormant-løb — SKAL fixes før S2-slut 23/8) · [#3039](https://github.com/NicolaiDolmer/CyclingZone/issues/3039) (test-konti får upkeep) · #3030-kommentar (2 nye .in()-sites fixet) · #3036 (countback i tiebreak før S2→S3) · #2164 (D3→D4-regel før S2→S3). **Patch note for cutover-ændringerne mangler** — lille frontend-PR mandag formiddag (pensions-reglen er usynlig før S2→S3, så ingen spiller møder udokumenteret ændring).

> **📈 Prod:** 161 brugere · ~62 % af nye vender aldrig tilbage · 41 WAU / 8 DAU · 1 abonnement. Anskaffelsen virker, fastholdelsen gør ikke.

> **Næste sessioner:** (a) mandag 17:45: aftenvagt (skridt 8: scheduler-logs, første S2-etaper, race_stage_passages #2811, præmie-sweep, bjergklassikere #2755) · (b) patch-note-PR · (c) "allerede løst"-verifikation (30-50 closes) · (d) ejer-beslutnings-batch · (e) s2_uge1-bølge · (f) planner-design-session (#2905).

> **🤖 Working agent:** Ingen aktiv session. (Cutover-sessionen 26/7 lukkede 22:45; 2 reddede worktree-branches venter stadig på review: `feat/2910-fatigue-reset-claim-guard` + `fix/2861-postgrest-in-cap-sweep` — sidstnævnte overlapper #3031/#3040, kræver rebase-tjek.)

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. S2-tilstand: D2=48 · D3=96 · D4=12 ægte; D4 C-H dormant (0 hold — reconcile-design).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — alle åbne. **Skalering:** #323 (genbesøg ved ~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag. Grace afvist (#1941 = design, ikke bug). **Pension:** måles på AFSLUTTET sæsons alder (ejer-regel 26/7, PR #3040).

_Trimmet 26/7 (cutover-close-out). Historik i git-log, issue-tråde + docs/audits/._
