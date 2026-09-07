# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (ejer-valg 7/9 aften):** **Næste session = spørgeskema-design (dialog) + forum/Discord-bølge + vækst.** Prompt: `docs/drafts/next-session-prompt-2026-09-08-spoergeskema-forum-vaekst.md`. Del A: de 12 spørgsmål ÉT ad gangen (hvorfor, hvad bruges svaret til, hvilken handling) → rettet seed → merge #5006 → ejer tester live → "kør" til udsendelse. Del C: #5000 forum-stat · #4999 webhooks · #4818 · #4819 · rest af #4751 (DM/venner/@-tag). Vækst-kort: #4964 kohorte · #2760 win-back · #4067 SEO · #3796 · #1173. **Hård frist uafhængigt af valg: #4270 S4-kalender applies INDEN 10/9 (ejer-go).**

> **⏳ Åbne ejer-valg (ét ad gangen):** #4270 kalender (frist 10/9) · **#4860 sponsor: S4-tilbud prissat mod tom S3-standing, 30 hold på 1,00 (≈3,0 mio.), A genpris ved aktivering / B sidste afsluttede sæson, FØR 27/9** · #4616 EUR-nøgler (30 min) · #4915 TTT · #4948 raceDay-hjælp · #4964 launch-kohorte · #4857 mandat-backfill · #2423 skew (rør ikke). Discord: patch-notes catch-up v7.256-7.262 (`docs/discord/2026-09-07-patch-notes-catchup-7256-7261.md`) + spørgeskema-post. Forum-serien "The future of:": academy + race engine klar i `docs/drafts/forum-future-of-*.md`. Ejeren poster selv.

> **🔴 Åbne fund (§7b refreshet 7/9 efter #4988 #4998 #4975):** felt-sammenhæng flad **88 % GRØN** · bjerg-top-10 206 s grøn · højbjerg-hale 8,1 % grøn · nedkørsel 0,44 grøn · sprinter 100 % · holdspil 7,35 (v3 7,10) · **favorit-win-rate 62,6 % RØD** (bånd 25-40, egen kalibrering, aldrig straf styrke). Mål: #4595 chunk-fix events/deploy (-21 % efter 1,5 t, genmål tidligst 8/9 14:20) · NPS #4997 (første 40 min: 7 vist, 1 svar, 1 luk; genmål 9/9). #5001 renderV4AnchorTable skriver uden --write · #5004 preflight mangler anti-slop · CLAUDE.md 1737/1750 tok (#4364).

> **✅ 7/9 aften (Fable, ejer ved maskinen, ejer-bestillinger):** Merget: #4988 holdspil B · #4996 CLI-review i bølge-brief · #5002 roadmap anon+fallback · #4998 M10 solo-id · #5003 NPS på dashboard · #4975 felt-sammenhæng · #5005 patch note v7.262. Prod: roadmap_items refreshet (SQL i `database/manual/`). Lukket: #4589 (B: lad ligge) · #3457 · #4993 · #4997 · audit 28 done + 1 dublet, #3514 done→todo. Nye: #4999 #5000 #5001 #5004. **PR #5006 (in-app spørgeskema) åben, IKKE merget: indhold designes først.** Audit: `docs/audits/day-wave-2026-09-07-ejer-bestillinger.md`. #4663-note ved S4-flag-flip.

> **📊 Triage:** Sentry via `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. Clarity er ikke kilde til "hvor mange" (#4963). #4952 Firefox-mobil · #4953 dead clicks /training · #4982 layout-regression.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616 EUR-nøgler → ejer-klik. #4514 kunden beholder Pro.

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Flip-scope = v3-paritet + #2789/#2944/#2582 + intention (§9). Ankre = §7b (population 2026-09-07, refresh `buildV4AnchorBaseline.mjs` + `renderV4AnchorTable.mjs --write`; kun `--check` er read-only, #5001); hale-gate `v4TailSpread.js --gate` med pinnede filer (default = juli-snapshot).
- **Træning:** nyt system (løbsdag som tick, #4850/#4846) live senest S4-start 28/9; kalenderpakker #4845 FØR S4-kalender. Dags-støj bruger `seededUnitMixed` (#4987).
- **Mekanik:** merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`; aldrig HH:57-HH:03); `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Bølger: TIER WAVE, PR som draft til `gh pr ready`, CodeRabbit CLI før ready (`%LOCALAPPDATA%\Programs\coderabbit\coderabbit.exe review --base main --committed`, ikke i PATH), push <10 min + hvert 15. min, vagt `scripts/wave-lane-watch.ps1`, frossen worker = recovery i SAMME worktree. Subagenter har IKKE Discord-MCP; orkestratoren læser kanaler. Billeder sendes FØR et beslutningskort.

> **🤖 Working agent:** Ingen aktiv session (7/9 aften; næste = spørgeskema-design + forum/vækst, prompt i docs/drafts).

_Historik i git-log, issue-tråde + docs/audits/._
