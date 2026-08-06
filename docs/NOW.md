# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action (vigtigst først):**
> 1. **🔴 Ryttertype-fallout ([#3372](https://github.com/NicolaiDolmer/CyclingZone/issues/3372)-cluster + [#3441](https://github.com/NicolaiDolmer/CyclingZone/issues/3441)/[#3442](https://github.com/NicolaiDolmer/CyclingZone/issues/3442)):** backfillen 5/8 ændrede REELLE caps (buildCapsForRider afleder caps af type, riderProgressionEngine.js:181) → spillere melder potentiale-hop, falske 14-dages-deltaer og 3-4x lønkrav. Du har selv meldt "kigger på det" i Discord. Rod-årsag + beslutning (frys caps som valuation_type? rekalibrér mapping?) = næste Claude-session.
> 2. **Dine klik:** kun #2813 penge-gates + Resend-nøgle (#2853) tilbage. ✅ #929 leaked-password slået til + advisor-verificeret 6/8. [#2892](https://github.com/NicolaiDolmer/CyclingZone/issues/2892) omlagt (ejer-valg A 6/8): Sentry-kvoten tillader kun 1 cron-monitor → Claude bygger egen heartbeat-vagt (Discord #ops-alarm ved udeblevne jobs) — ingen ejer-klik.
> 3. **PR #3393 lønbasis (draft)** — dine 3 valg (a/b/c) uændret; koordinér med #3442-fundet. **S2-backfill efter #3347** — dit kald, urørt.
> 4. **I aften:** fair-play-sweepens første kørsel efter 22 (#3138 lukkes ved grøn) · Discord-digestens første kl. 20-kørsel.

> **🟢 6/8 MEGA-AUDIT (denne session):** 482→450 åbne. 38 closes (evidens: [#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627#issuecomment-5203396873)) · done-pukkel 54→17 (kun gated/await-owner) · 4 nye issues #3439-#3442 · patch notes **v7.100** (11 manglende noter, PR #3443 merged) · roadmap: 3 items → shipped · 2 audit-korrektioner (#3131 epic-fejllukning reopenet, #2720 indsnævret). Discord-roundup til #patch-notes (v7.95-v7.100) klar som udkast — afventer dit go. Fuld rapport: `.claude/audits/audit-2026-08-06.md`.

> **📌 Åbne opfølgninger:** **Forum v1 (#3199/#3201) bygget 6/8** — [PR #3447](https://github.com/NicolaiDolmer/CyclingZone/pull/3447) afventer ejer-go (UI-merge-regel); migration `2026-08-06-3199-forum.sql` applies post-merge; #3200 (DM) IKKE dækket · #2881 **datareparation ikke kørt** (2 SQL'er venter, ejer-gated) · #3330 Discord-svar til @knud_r_flink udestår · #3094 peaks-fladen visuelt uverificeret (redningscommit) · #3396 Final Km replay-hul (done→todo) · #2830 lockdown-SQL ejer-gated · [#3337](https://github.com/NicolaiDolmer/CyclingZone/issues/3337)-harness: ligger UTRACKET i worktree `wf_1e3ef067-8bd-5` + backup i `C:\Dev\CyclingZone-worktrees\harness-3337-backup\` (NOW's tidligere "balance-internals"-sti fandtes ikke) — gentag måling efter type-fix + #3393 · #3349 måltal på post-backfill-population · #3353 V4-refit · #3295 S3-kalender · #2645 Del B · #3172 (luk ~18/8) · #2164 (S2→S3) · branch-oprydning: 11 remote-branches + 2 worktrees venter på dine kommandoer (session-output 6/8).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen**. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 6/8 (mega-audit close-out). Historik i git-log, issue-tråde + docs/audits/._
