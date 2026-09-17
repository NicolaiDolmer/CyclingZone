# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action:** **Session 18/9 = "til bunds, intet udskudt"**: plan i `docs/drafts/session-plan-2026-09-18.md` (blok A ejer-kort: træningsdesign (brief `audits/2026-09-17-traeningsdesign-session-brief.html`) → win-back (ny tekst EFTER en måneds Discord-læsning) → S4-opslag → icebox-batch 2 → sponsor PR #5336 → #5323 Quad9; blok B GitHub-K-pass; blok C oprydning; blok D MASTERPLAN-artifact + patch notes Discord). **Kørsel 1 (17/9):** 9 merget (#5324 #5285 #5308 #5235 #5335 #5332 #5333 #5334 #5262), #5263 lukket (ejer: pris låses ved underskrift), 18 iceboxet, 669 → 656 åbne. **Åbne PR'er:** #5336 sponsor-lille (worker) · B3 #5281 + B4 #5264 (grøn, efter træningsdesign) · #5169 · #3512 → #5327. `infisical login` udløbet.

> **🟡 Loft-designet (ejer 16/9 — byg intet, afventer samtale):** `abilityRoleClass` er **binær på fortegn**, så vægt 1 og vægt 3 begge giver `signatur` (93). Derfor ramte loftet skævt: `aggression` (vægt 3) kostede 8,4 ratingpoint, `teamwork`/`leadership` (vægt 1) koster 1,5-1,8. Ejeren vil have en langsigtet løsning (vægtet rolleklasse eller gulv à la `GC_PUNCH_FLOOR`). **#5268-point-flytningen bør afvente samtalen.**

> **🔴 Åbne fund:** #5296 vagten rettet (PR #5298, done). **Webkit-flaken #4925 er bredere end titlen:** mobile-webkit fejler på skiftende specs på tværs af PR'er. Rerun, ikke fix. Deploy verify tom-JSON → #5286. #5223 dobbelt sprint-kaptajn. AGENTS.md/FEATURE_STATUS over budget. **Sweep 17/9:** #5312-#5321. **Fund:** #5325 (ErrorState uden `role=alert`) · #5326 (sanitize-secrets-hook fejler).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md) (tal: [`GROWTH_STACK.md`](GROWTH_STACK.md) §12). **S3:** 529 løb, 28/8 → 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (#5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145). **Graduation Day ved 23** (live 15/9, #5279).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, samlet sweep ≥ kl. 20 + knap uden bonus, program 7×5. #5205 + B4 #5264 + B3 #5281 (parkeret) bag flag `training_tick_per_race_day` (off); live senest 28/9. **B3 er IKKE bag flag** — alene merget mister 62 af 371 hold deres +25 %. **#5267:** D1 havde 86 løbsdage i S3; "140" = etaper (5 klokkeslæt × 28). Uafklaret.
- **Evner (live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` er data (motor senere); lofter `{tactics 55, teamwork 70, leadership 70}`, **`aggression` UDE** (#5297). Loftet regnes **on the fly** pr. kald (`scoutingReport.js:192`) → loft-fixes ses straks ved deploy; persisteret `ability_caps` selvheler ved nattick (≥22), free agents/frosne kræver `scripts/dev/lofterApply3746.mjs`. Point-flyt = `backend/scripts/dry-run-5268-mental-abilities.js`, ejer-gated. Fødsel uden PCM = default (#5278).
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` (loft U23 12 / junior 10) live; backfill = `backend/scripts/backfill-4619-riders-squad.js`, ejer-gated (valg A). Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge (#5251). **Priser:** spillere inkl. moms, ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9):** ét delpunkt · prod-tal som eksempel · læs issuets seneste kommentarer FØR kortet · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur.
- **Mekanik:** byg KUN via wave.js; merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`; `gh pr update-branch` først, konflikt → worker fletter main ind); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES` samme PR; migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`; `gh --body-file`.

> **🤖 Working agent:** Claude Code (Fable) — styringssession 17/9, bølge aktiv (wave-active.json).

_Historik i git-log, issue-tråde + docs/audits/._
