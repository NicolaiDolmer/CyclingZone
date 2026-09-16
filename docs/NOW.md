# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action:** **Ejer + Claude-review 17/9:** [vækstplan, fuld A-H-dækning og design](strategy/2026-09-16-growth-review/README.md), indgang **#4964**, nyt hul **#5310**. Vælg MASTERPLAN-placering; forslag er IKKE build-go. Gemt på `codex/growth-plan-2026-09-16`, ingen PR/merge. **Øvrig styring:** loft 🟡 · sponsor #4860/#5263 **27/9** · apply-go #5268/#4619. **Parkeret:** #5281 på B4; #5264 CONFLICTING; #5267 → #5169. Øvrige #5235/#5262/#3512. Gamle Codex-prompts er delvist stale (#5289/#5290 merget).

> **🟡 Loft-designet (ejer 16/9 — byg intet, afventer samtale):** `abilityRoleClass` er **binær på fortegn**, så vægt 1 og vægt 3 begge giver `signatur` (93). Derfor ramte loftet skævt: `aggression` (vægt 3) kostede 8,4 ratingpoint, `teamwork`/`leadership` (vægt 1) koster 1,5-1,8. Ejeren vil have en langsigtet løsning (vægtet rolleklasse eller gulv à la `GC_PUNCH_FLOOR`). **#5268-point-flytningen bør afvente samtalen.**

> **🔴 Åbne fund:** **#5296 welcome-mail = formentlig falsk alarm** — Resend viser mailen delivered 10-15/9, kæden intakt; mistanken er mail-drift-**vagten**, ikke udsendelsen (evidens i issuet). **Webkit-flaken #4925 er bredere end titlen:** mobile-webkit fejler på skiftende specs på tværs af PR'er. Rerun, ikke fix. Deploy verify tom-JSON → #5286. #5223 dobbelt sprint-kaptajn. `zod` mangler lokalt → 3 route-tests fejler, kør `npm run sync-deps`. Beta-testere: 0 i prod. AGENTS.md/FEATURE_STATUS over budget. **Discord-sweep 16/9:** 8 nye. #5285 tilhører anden sessions bølge #5284 — rør den ikke; tjek `wave-active.json` FØR spawn.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9, etaper 11-19.

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

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
