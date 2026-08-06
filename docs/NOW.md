# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action (2 ting venter på dig):**
> 1. **[PR #3393](https://github.com/NicolaiDolmer/CyclingZone/pull/3393) lønbasis — draft, 3 valg (ejer 6/8: "tager vi senere").** `løn = 15.000 × (mv/100.000)^0,55`; net +433.142 → +306.567 (mål 37.500) = 32 % af hullet. Valg: **(a)** eksponent 0,55 · **(b)** 17 D2-hold i minus — rigtig pris? · **(c)** genberegningsdato 23/8 + roadbook. ⚠️ De 9 mekanismer må ikke shippes samtidig.
> 2. **S2-kalender-backfill efter [#3347](https://github.com/NicolaiDolmer/CyclingZone/issues/3347) — dit kald.** Scorecard GO, men DB urørt og bryder M-Down 57 %; backfill ændrer **189 af 441 løb midt i sæsonen**. Ikke kørt.
>
> **✅ Ryttertype-backfillen er KØRT 5/8** efter ejer-go: 8.176 ryttere, 4.249 typer skiftet, `valuation_type` urørt for alle (verificeret mod snapshot). Snapshot `riders_type_backfill_snapshot_20260805` beholdes indtil fordelingen er set an. **#3349's måltal skal nu sættes på den NYE population.**

> **🟢 6/8: VERDENSKLASSE BØLGE 1 KOMPLET** (epic [#3395](https://github.com/NicolaiDolmer/CyclingZone/issues/3395)): alle 7 issues shippet i 7 PR'er efter ejer-go — #3403 narrative notifikationer + Discord-resultat-DM (kl. 20-digest, første kørsel i aften) · #3404 Final Kilometre · #3406 Maiden Win (`rider_career_events`, genbrugelig for #2490) · #3405 Hero & Agony · #3437 auktions-reveal · #3432 sæsondokumentaren (LLM-flag OFF; synlig efter første sweep-kørsel, klar før 23/8). + #3386/#3099 fører-holdet merged samme runde. Alle 3 migrationer applied + post-verificeret. Patch notes **v7.97-v7.99**. Artifact: `docs/audits/night-wave-2026-08-06.md` · postmortem: `.claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md`. **Næste session-kandidat: bølge 2** (Race Centre/Broadcast · Peloton Post · klubhus/rivaler · palmarès — plan-doc'ens bølgeplan). Mail-loop stadig ejer-gated (#2853). Følgefund: #3407 stale planner-snapshot.

> **🟢 6/8: Supabase-fejl-audit lukket ([#3416](https://github.com/NicolaiDolmer/CyclingZone/issues/3416)).** Tusindvis af `race_results_entrant_unique`-fejl (~288/døgn siden 5/8) = ai-trim-heal der hvert 5. min prøvede at slette "AI Aero Devo" med 2× samme rytternavn; #3022-nøglen SKIFTEDE fra id- til navnebaseret midt i sletningen. PR #3417: `entrant_uid`-snapshot gør nøglen stabil hen over sletning + navnegenerator deler nu navne-set på tværs af kerne/hale-kald (21 hold havde dubletter). Migration applied + post-verificeret; PR #3418 fixede tone-gaten (rød på ALLE PR'er efter v7.98-copy). Postmortem: `.claude/learnings/2026-08-06-entrant-key-name-collision-delete-loop.md`. Alarm-hullet (1,5 døgns fejlloop usét) er dokumenteret på [#2076](https://github.com/NicolaiDolmer/CyclingZone/issues/2076) (Sentry→Discord, 15 min ejer-opsætning) + #2892; følgefund [#3434](https://github.com/NicolaiDolmer/CyclingZone/issues/3434) (notifyTeamOwner N+1). **Tjek i morgen:** fair-play-sweepens (#3409/#3433) første natlige kørsel efter kl. 22 — `loans.amount`-fixet er merged men uverificeret i drift.

> **🟢 5/8 sen aften (trimmet):** #3390 klokke-detektor · #3392 realisme-gate-fix (gaten var rød 56 %, ikke 11 %; re-draw → 0,00 %) · #3394 15 `fetchAllRows` uden `.order()` rettet + CI-guard. #3150/#3372 = IKKE bugs, men fladerne forklarer sig ikke (UI-del kræver dit visuelle go). Detaljer i issue-tråde.

> **🔴 Platform:** Prod 191 brugere, 54 aktive/7d. Dag-1 ~31 % seneste 2 uger (var ~64 % juni), last_seen-metode ([#3310](https://github.com/NicolaiDolmer/CyclingZone/issues/3310)). #2853 venter på Resend-nøgle. Railway MCP kræver re-auth.

> **📌 Åbne opfølgninger:** ✅ `audit`-checkens falske rød er væk (#3435: snapshot-tabellen whitelistet, detector D = 0). De resterende fund er 6/8-bølgens egne: `discord_race_digest_log` + `rider_career_events` har 0 rows endnu (A), `feature_hall_of_fame_opened` 0 impressions (E) · 🆕 [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436) **balance-interne tal må ikke i offentlige issues** — repoet er public, en agent postede motorvægtene 5/8; redigeret ned, men GitHubs redigeringshistorik er stadig åben → **ejer-beslutning: slet kommentaren helt?** · [#2671](https://github.com/NicolaiDolmer/CyclingZone/issues/2671) fik 3. forekomst dokumenteret (`is_offered_intake_rider` mangler anon-EXECUTE) · **[#3337](https://github.com/NicolaiDolmer/CyclingZone/issues/3337)**: harness bevaret i `balance-internals/harness-3337/`; målingen **skal gentages** efter type-backfill + #3393 · [#3349](https://github.com/NicolaiDolmer/CyclingZone/issues/3349) måltal på POST-backfill-populationen · #3353 V4-refit (gen-kalibrér #3393's eksponent bagefter) · #3295 S3-kalender · #3145 · #3112 · #2830 ureviewet · #2645 Del B · #3172 (luk ~18/8) · #2164 (ved S2→S3).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen**. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 5/8 (aftenbølge-close-out). Historik i git-log, issue-tråde + docs/audits/._
