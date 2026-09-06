# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret):** **Løbsmotor v4 mod flip ved S4-start 28/9.** Beslutninger låst 5-6/9 i [`RACE_ENGINE_RULES.md`](RACE_ENGINE_RULES.md) §9 + spec [`2026-09-06-race-engine-v4-flip-and-tactics-design.md`](superpowers/specs/2026-09-06-race-engine-v4-flip-and-tactics-design.md). Merget 6/9: flip-fundament #4879, M7-M13+M15+M16 wiret (#4881 #4882 #4891 #4892 #4893 #4897 #4904 #4907 #4908), ordre-kæden #4894, intention-backend #4878. **Næste:** #4909 (M12, konflikt) · løbssiden som faner (`feat/race-page-tabs`, variant A, ejer-go på preview) · #4911 doc-reparation · #4910 hjælpetekster · rute-huller alle seks (#2789) · kalibrering #4707 + #4885 (feltspredning) · #4905 · #4886 · kalibrering #4914 · TTT/M9-følgesager #4915 · live-afspilning #4916 · løbsside-opfølgere #4917 (PR #4913 udkast) · ops #4918 #4919 #4920. **Ejer-go der venter:** #4912 patch note 7.258 · #4884 · #4864 · #4801 · #4835 (`AUTO_MERGE_PAT`) · #4857 backfill · #4859 flip · #4845 kalenderpakker (ejer hjemme). **S4-kalenderen (#4270) må IKKE applies før #4845.**

> **⏳ Åbne ejer-valg (ét ad gangen):** bestyrelse før DNA-valg (#4900) · holdspils-kalibrering (v4 gab 3,0 mod v3 19,4, §2e) · TTT ind i S4-kalenderen (filler pauset siden #2411) · TTT giver ingen point til pointkonkurrencen i v4 (v3 gav) · bonussekunder v4 = eneste kilde (låst 6/9) · #2423 skew protection (758 chunk-fejl/47 spillere på 7 dage, ejer: rør ikke) · Discord: coming-soon-plakater + replay-animation i `docs/design/coming-soon-v4-2026-09-06/` og `replay-v4-2026-09-06/` (ejer poster selv).

> **🔴 Åbne fund:** #4885 v4 komprimerer feltet (tidsgrænsen inert) · #4905 nedkørsels-uheld fyrer aldrig · #4886 rngFor uden segment-nøgle · #4828/#4829 D4-pulje F 25/24 · #4811 · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 6/9 (Fable):** Sentry/Supabase-triage lukket (#4866 timeout, #4868, #4870, #4871, #4876 heal-loop, #4898 #4901 #4902 #4906); #4865 11 bonus-mål repareret på ejer-go + guard (#4889 #4890). **TIER WAVE + livstegn** indført (ejer 6/9, `AI_OPS_REFERENCE.md` + `NIGHT_WAVE_RUNBOOK.md`); læring: `.claude/learnings/2026-09-06-v4-boelge-frys-tier-wave-og-genstart.md`.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-scope = v3-paritet + #2789/#2944/#2582 + intention (§9). Bygget ≠ koblet ind: to kolonner i kataloget.
- **Træning:** nyt system (løbsdag som tick, #4850) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** PR'er merges med `--admin` én ad gangen med pause (Railway-deploys må ikke overlappe); `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Bølger: TIER WAVE, maks 3 byg-workers, push <10 min + hvert 15. min.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
