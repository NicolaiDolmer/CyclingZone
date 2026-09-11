# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Intention-SSOT:** [GAME_DESIGN_DOCUMENT.md](GAME_DESIGN_DOCUMENT.md) (D-001–D-048) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) (11/9) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md · **Orkestrator-standard v2:** CLAUDE.md-afsnit + `.claude/workflows/wave.js` (#5142).

## Aktiv styring

> **🎯 Next action (11/9 kl. 12:50):** Kør prompten `docs/drafts/next-session-prompt-2026-09-11-fundament.md` (dagsession: fase 0 read-only, fase 1 beslutningskort ét ad gangen, fase 2 fundament-bølgen gennem wave.js). **Holdt:** #5139 draft, RET FØRST efter Codex-audit (`docs/audits/2026-09-11-codex-audit-chunk-fejl.md`); plan = epic #5162 (spor #5159 #5160 #5161; tre krav før næste chunk-merge, ingen Skew Protection). **Merget 11/9:** #5174 (#5150 Tailwind-tokens, trin 1/3), #5172 (#5158 TS-skralde, required check ts-core-ratchet), #5171 (#5131 perf-baseline), #5168 (#5161 boot-vagt + brand-fallback), #5166 (#5153 Supabase 11→7 WARN, post-verify grøn), #5165 (#5160 to-build-gate + #5170 rod-årsag chunk-rotation: skew-define gated på kode-flag; E2-måling på næste deploy), #5167 (#3069 feature-liveness grøn igen, 7 fund whitelistet), #5135 (akademirytter-vindue åbnet kl. 13:57, #5133 lukket), #5163, #5140 (late_fill-udkast), #5148/#5149 Dependabot, #5132, 4 Dependabot, #5141 (lukkedato 14/9 23:59 sat, 214 skub sendt), #5137 (puljer 9/13 frie 12-13/9), #5134 (Express 5, prod-vagt uden fund), #5138 (Tailwind 4 marketing), #5147 (standard v2), #5164 (Claude Design-eksport). **Besluttet 11/9:** #5154 B (ingen PITR) · #5156 B (reviewer-agent = gate) · #5158 A+ (strict kerne + skralde, spor i bølgen) · #5113 seks svar logget. **Ejer-valg der venter:** #5136 late_fill (ejeren poster afstemningen 11-12/9; flip + #5108 venter) · #4270 S4-kalender A/B senest 14/9 (#4845 bygges i bølgen) · #5113 PNG'er fra Claude Design-zippen til `docs/design/visual-identity/png/` (eksport = PR #5164). **Ejer-trin:** `AUTO_MERGE_PAT` (#4812) · Discord-opslag (#5121) · #5107 · nøgler (PostHog, GSC, Resend-webhook, EUR, `SUPABASE_ACCESS_TOKEN`) · faktura 61,25 kr. S3 slutter søndag 27/9, S4 starter 28/9.

> **🔴 Åbne fund:** Supabase-advisors 12 WARN (#5153) · CYCLINGZONE-56 105 events/27 spillere pr. 24 t (#5162) · favorit-win-rate 62,6 % RØD · 4.881 aktive ryttere `reputation = NULL` (#1099). GitHub-audit 11/9: 19 lukket, 4 labels rettet; backlog 623 åbne.

> **📊 Triage:** `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`. **💳** [`BILLING_STACK.md`](BILLING_STACK.md), 12 betalende (MRR 436 kr). **S3:** 529 løb, 28/8 → 27/9; etaper kl. 11-19 dansk tid.

## Standing context (forever-relaunch)

- **Liga:** pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8). **Mere fog of war** (ejer 6/9; Q-037 → #5107).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (#4209). Pension: afsluttet sæsons alder; referenceår `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** ÉN v4 (`backend/lib/engine/v4`), flag `race_engine_v4` OFF; v3 kører S3 færdig. Ankre §7b; hale-gate `v4TailSpread.js --gate`.
- **Træning:** løbsdag som tick (#4850/#4846) live senest 28/9; kalenderpakker #4845 FØR #4270.
- **GDD-regler (ejer 10/9):** ét område pr. kort · ÉT samlet før/efter-billede før kortet · genåbn aldrig låste beslutninger.
- **Mekanik:** byg KUN via wave.js (4 laner, semafor 2, hook); merges én ad gangen (`scripts/merge-queue.ps1 -Pr "N"`); migrationer applies af auto-migrate.yml, Claude post-verificerer; CI tavs på PR = merge-konflikt; go-kort på `gh pr diff` + billede; workers rører aldrig `docs/NOW.md`. `Get-Date` FØR hver logning.

> **🤖 Working agent:** Claude Code (Fable) dagsession 11/9 fra kl. 13:15, bølge 2 kører via wave.js (run wf_b75376c2-1e7: #5159 #5150 #5158 #5131 #5155); åbne PR-kort: #5173 (#5159 reload-koordination, genoptages), #5175 (#5155, genoptages), #5169 (S4-beslutning senest 14/9). Anden session: STOP + spoerg ejeren.

_Historik i git-log, issue-tråde + docs/audits/._
