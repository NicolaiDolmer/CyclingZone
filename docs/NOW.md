# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (14/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142; forbedringer fra 14/9 i #5220).

## Aktiv styring

> **🎯 Next action (14/9 kl. 11:50):** **Ejer-go på tre PR'er fra dagbølgen** (go-kort givet, skærmbilleder sendt): #5206 (#5098 holdudtagelse bevares ved etapeskift, reviewer GODKENDT) · #5211 (#5130 Discord-velkomst i indbakken) · #5216 (#4067 rewrites cyclingzone.org → marketing, ejer-go) → sig "merge N". · **#5214** (#4346 anmeld handel) + **#5217** (#5177 /roadmap CLS) venter på CI-rerun (audit = Supabase-netværk, webkit-flake #4925) → go-kort med skærmbilleder (5214 har tre i worktreet). · **Post-verify #5204:** `board=` i finalize-loglinjen i Railway (13:00-ticket dansk tid); før 198-514 s. · **15/9:** #5197 akademi-gate (ejer: "vent til i morgen") · spørgeskema-opsummering (#5121, lukkede 14/9 23:59, 34 svar) · #5136 afstemning: A 12 t = 7, D = 5, E = 2 → flip late_fill + merge #5108 (ejer-go) · #4235 forum vs Discord. **Holdes:** #5205 træning pr. løbsdag (ejer: ikke nu) · #5169 kalenderpakker (design) · #4270. **Merget 14/9 (7):** #5195 #5207 #5204 #5208 #5213 #5212 #5210 → patch note 7.272 (PR i kø). **Opfølgere:** #5215 LTV ekskl. moms (ejer-beslutning B) · #5220 wave.js-regler (undersøgelsesspor 60 min, maks 1 CodeRabbit-runde, blandet kø, livstegn 15 min) · #5133 dataindgreb (ejer-gated). **Venter på ejer:** AUTO_MERGE_PAT (#4812) · #5107 · nøgler #4616 · faktura 61,25 kr (CYCLINGZONE-54, 35 dage) · PNG'er (#5113). S3 slutter 27/9, S4 starter 28/9.

> **🔴 Åbne fund:** Mandagstal 14/9: aktive/7d 74 · signups 6/uge to uger i træk · D7 16,7 % (6 berettigede) · MRR 659 kr / 18. Chunk-fejl CYCLINGZONE-56: 23 events/24 t (ned ca. 75 %), halen er gamle klienter, ny måling 15/9. #5089 429-byger post-verify udestår. Supabase 3 WARN dokumenteret som accepterede (#5213). Backlog ~618 (audit 14/9: 18 lukket, done-pukkel 18 → 3).

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md); tal i [`GROWTH_STACK.md`](GROWTH_STACK.md) §12. **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre. Akademi: nedrykning kun ≤ 21 (#5145, PR #5197).
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846, PR #5205 bag flag) live senest 28/9; kalenderpakker #4845 (PR #5169, design) FØR #4270.
- **Priser (ejer 14/9):** spillere ser INKL. moms; ejerens tal (LTV/MRR/ARPU) EKSKL. moms (#5215).
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook; frys = commit ≥45 min + tavshed, spor 120/180 min); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`. Preview-screenshots: dev-server UDEN `VITE_PREVIEW_MOCK` når Playwright-routes skal styre data. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
