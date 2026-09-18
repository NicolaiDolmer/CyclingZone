# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-057) · **Rækkefølge:** [MASTERPLAN.md](MASTERPLAN.md) · **Områder:** hard rule 30 i AGENTS.md · **Orkestrator v2:** CLAUDE.md + `.claude/workflows/wave.js`.

## Aktiv styring

> **🎯 Next action (ejer 18/9, ét kort ad gangen):** 1) **post** `drafts/discord-patch-notes-2026-09-17.md` (v7.276-7.283 + v7.286 = svaret på rating-tråden) + S4-opslaget → 2) træningsdesign kort 1-4 (`audits/2026-09-17-traeningsdesign-session-brief.html`) → 3) win-back v2 sammen → dry-run → send-go → 4) icebox-batch 2 (ejeren vil BYGGE nogle) → 5) 31 needs-decision + **#5351** (rating-opskrift m. teamwork/leadership ruller ud i SAMME deploy som #5268). **Næste bølge:** bølge 3-5 i `drafts/next-session-prompt-2026-09-17-aften-boelge.md` (bølge 4-5 = go-kort). **Aften 17/9:** 11 PR'er merget, 19 done, `audits/night-wave-2026-09-17.md`. **Åbne PR'er:** #5281 #5264 #5169 #3512 (rør ikke).

> **🔴 Rating-hændelsen 17/9 (lukket, regel står):** teamwork/leadership fik vægt i display-opskriften 15/9, og NULL talte som 0 → Mit hold/Scouting 2-4 point lavere end profilen. PR #5352: vægte rullet tilbage, NULL springes over, golden-guard `ratingGolden.5321.json` (opdateres KUN m. ejer-go). **Ejer-regel:** én rating overalt; synlige ratings falder aldrig uden ejerens vidende; nye evner tæller først når de har værdier, i samme deploy som data. Postmortem `.claude/learnings/2026-09-17-rating-null-taeller-som-0.md`.

> **🟡 Loft-designet (ejer 16/9, byg intet før samtalen):** `abilityRoleClass` binær på fortegn → `aggression` (vægt 3) kostede 8,4 point, `teamwork`/`leadership` 1,5-1,8. Langsigtet løsning (vægtet rolleklasse eller gulv). **#5268-point-flyt afventer samtalen, koblet til #5351.**

> **🔴 Åbne fund:** Webkit-flaken #4925 (mobile-webkit, skiftende specs, React #418; bed 4 PR'er 17/9). Rerun, ikke fix. **#5323 Quad9:** måling live fra 17/9 kl. 13; aflæs 19/9 før DNS-kort. Advisors: 3 WARN SECURITY DEFINER, alle kendte (`SUPABASE_SECURITY_ADVISORS.md`). **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d` (logget ind 17/9). **S3:** 529 løb, 28/8 → 27/9.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (#5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145). **Graduation Day ved 23** (live 15/9).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Kalender-gaten blokerende (#4123); `calendarGoldenDiff.mjs` FØR S4-generering.
- **Træning (ejer 15/9, §13.3):** løbsdag som tick, sweep ≥ kl. 20 + knap uden bonus, program 7×5. #5205 + B4 #5264 + B3 #5281 (parkeret) bag flag `training_tick_per_race_day` (off); live senest 28/9. **B3 er IKKE bag flag.** #5267 uafklaret.
- **Evner (live):** taktik/aggression uden alder for nye ryttere; `teamwork`/`leadership` er data, **ikke i rating-opskriften** (17/9; motor: #5348 #5349 efter apply). Lofter `{tactics 55, teamwork 70, leadership 70}`, `aggression` UDE (#5297). Point-flyt = `backend/scripts/dry-run-5268-mental-abilities.js`, ejer-gated. Fødsel uden PCM = default (#5278).
- **Trupper (15/9):** `riders.squad` + `backend/lib/squads.js` live; backfill ejer-gated. Alt live 28/9; spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md`.
- **Forside `/`:** anonym = marketing-sitet; ændring → `node scripts/check-cdn-cache-headers.mjs` før merge. **Priser:** spillere inkl. moms, ejerens tal ekskl. (#5215).
- **Kort-regler (ejer 15/9 + 17/9):** ét delpunkt · prod-tal · læs issuets seneste kommentarer FØRST · genåbn aldrig låste beslutninger · udskyd aldrig selv · UI-PR = skærmbillede samme tur · **spillervendt rettelse = problem + løsning i klart sprog FØR byg** (bidt 17/9).
- **Mekanik:** byg KUN via wave.js; merge én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); commit-guarden skriver markør, pre-commit afviser commit uden (#5094); ny tabel bag flag → `FLAG_GATED_EMPTY_TABLES`; migrationer via auto-migrate.yml, post-verify STRAKS; workers rører aldrig `docs/NOW.md`.

> **⏸️ Dagbølge 18/9 afbrudt 11:45, alt pushet:** 8 PR'er merget; åbne: #5366 (klar) + drafts #5370 #5372 #5373 #5374. **Genoptag: `drafts/next-session-prompt-2026-09-18-resume.md`.** **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
