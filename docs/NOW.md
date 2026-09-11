# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (11/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142).

## Aktiv styring

> **🎯 Next action (11/9 kl. 22:50):** Kør prompten `docs/drafts/next-session-prompt-2026-09-12-fundament-2.md`. Første kort: **#5173** (#5159 reload-koordination, ret-trin færdigt 11/9 kl. 23:05, alle 7 fund rettet, HEAD a2c7640d, CI 48 grønne / 0 røde; WebKit-flake i landing-hydration er eksisterende (eget issue); banner-billede + go-kort; derefter patch note 7.271 samlet + help.json-FAQ, luk #5139). Så **#4270/#4845** S4-kalender (PR #5169 klar; ejer vælger overlap-gulv vs. §1d senest 14/9) · **#5155** genoptag i samme worktree. Bølge 3-kø: #5178 wave.js frys-kalibrering → #5176 Supabase-rest → #5177 perf top 3 → #5151 Tailwind trin 2 → #5158 konvertering 1 (economyEngine) → #4846. **Merget 11/9 (12):** #5135 (akademi-vindue åbnet), #5163, #5140, #5148/#5149, #5167 (#3069 vagt grøn), #5165 (#5160 + #5170 rod-årsag: prod 0/195 chunks udskiftet), #5166 (#5153 11→7 WARN), #5168 (#5161 boot-vagt + brand-fallback), #5172 (#5158 skralde, required), #5171 (#5131 baseline), #5174 (#5150). **Besluttet 11/9:** #5154 B · #5156 B · #5158 A+ · #5113 seks svar. **Venter på ejer:** #5136 late_fill-afstemning postet 14:53 (flip + #5108 efter resultat) · #4270 senest 14/9 · AUTO_MERGE_PAT (#4812) · Discord-opslag (#5121, lukker 14/9 23:59) · #5107 · nøgler · faktura 61,25 kr · Vercel Skew-toggle (uden betydning, #5170) · PNG'er (#5113). S3 slutter 27/9, S4 starter 28/9.

> **🔴 Åbne fund:** Supabase 7 WARN (#5176, frist 18/9) · CYCLINGZONE-56 måles 12/9 (forvent fald efter #5165) · favorit-win-rate 62,6 % RØD · 4.881 aktive ryttere `reputation = NULL` (#1099, shadow) · wave.js stopper levende spor på 60 min (#5178) · ca. 680 uregistrerede worktree-mapper (#4924). Backlog 626 åbne.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR #4270.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
