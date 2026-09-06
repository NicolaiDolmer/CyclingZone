# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-styret):** **Regel 6/9: tre baner** (deadline S4 · forretning viger aldrig · færdiggør før nyt), fuld rækkefølge i [MASTERPLAN.md](MASTERPLAN.md). **Bane 1 nu:** løbssiden som faner PR #4913 (ejer-go på preview) → v4 før flip (#4914 kalibrering, #4885 #4886 #4905, #4915 TTT, #4246, #4911, #4910) → flip (ejer) → S4-kalender #4270 (ikke før #4845) → træning pr. løbsdag #4850 → mandat #4857→#4859 → cutover #4592/#4619/#4860/#4376. **Bane 2:** #4616 nøgleblok (ejer ~30 min) → Pro i euro + mail-loop dry_run. **Bane 3:** ejer-lukkesession for **34 done-gated** issues (30 min, ingen kode) · #4921 feature-register MERGET (PR #4922, gate groen paa main; opfoelger: `dormant`-state) · #4495 akademi-valg. **Ejer-go der venter:** #4857 · #4859 · #4845. **Merget 6/9 aften:** #4912 #4884 #4864 #4835; #4801 lukket umerget (loftet ind i #4850); #4789 får "oprykning før slip" (ejer 6/9) og merges på grøn CI.

> **⏳ Åbne ejer-valg (ét ad gangen):** bestyrelse før DNA-valg (#4900) · holdspils-kalibrering (v4 gab 3,0 mod v3 19,4, §2e) · TTT ind i S4-kalenderen (filler pauset siden #2411) · TTT giver ingen point til pointkonkurrencen i v4 (v3 gav) · bonussekunder v4 = eneste kilde (låst 6/9) · #2423 skew protection (758 chunk-fejl/47 spillere på 7 dage, ejer: rør ikke) · Discord: coming-soon-plakater + replay-animation i `docs/design/coming-soon-v4-2026-09-06/` og `replay-v4-2026-09-06/` (ejer poster selv).

> **🔴 Åbne fund:** #4885 v4 komprimerer feltet (tidsgrænsen inert) · #4905 nedkørsels-uheld fyrer aldrig · #4886 rngFor uden segment-nøgle · #4828/#4829 D4-pulje F 25/24 · #4811 · #4453 · #4537 · #4530 · #4531 · #4109.

> **✅ 6/9 (Fable):** Sentry/Supabase-triage lukket (#4866 #4868 #4870 #4871 #4876 #4898 #4901 #4902 #4906); #4865 bonus-mål repareret (#4889 #4890). **TIER WAVE + livstegn** indført (`AI_OPS_REFERENCE.md`, `NIGHT_WAVE_RUNBOOK.md`). **Docs-drift fundet (8 punkter i FEATURE_STATUS mod kode/prod):** recaps #1311, kaptajn/udbrud #1307, gældsbugs #45/#31, HoF #1139 er lukket; `facilities_enabled` er ON; rytterlån afviklet (#1994); kontraktflows ER bygget (extend-contract, `contractExpiryRelease.js`, `aiContractAutoRenewal.js`); form/fatigue/skader ER live i v3+v4 (`raceSimulator.js`, `physiology.ts`), ikke 0-stubs. Løsning: #4921 register + CI-gate, merget 6/9. Masterplan omskrevet til tre baner, artifact republiceret.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-scope = v3-paritet + #2789/#2944/#2582 + intention (§9). Bygget ≠ koblet ind: to kolonner i kataloget.
- **Træning:** nyt system (løbsdag som tick, #4850) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender.
- **Mekanik:** PR'er merges med `--admin` én ad gangen med pause (Railway-deploys må ikke overlappe); `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Bølger: TIER WAVE, maks 3 byg-workers, push <10 min + hvert 15. min.

> **🤖 Working agent:** Claude Code (Fable, orkestrator) 6/9 aften fra ~19:45 - PR #4913 loebsside-faner (worker) + #4789 (worker); koe-PR'er behandlet.

_Historik i git-log, issue-tråde + docs/audits/._
