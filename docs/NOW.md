# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action (næste session, ejer-styret, ét kort ad gangen):** **1) Forum + Community fredag:** prompt ligger klar i `docs/drafts/session-prompt-forum-community-fredag-2026-09-04.md`. **2) #4485 U25-reparation:** ejer-GO givet 4/9; PR #4761 er merget → kør `node backend/scripts/repair-4485-young-classification.js --dry-run` → `--apply` (B, begge veje) → post-verify 0 → spillerbesked-udkast. **3) #4753 flag:** når de 24 igangværende etapeløb er kørt: ejer-GO → `ai_team_retire_enabled = on` → heal-sweepen nedlægger 4 markerede hold → puljer 8/10/11/15 = 24. **4) #4147 flag:** efter et døgn med vagten → ejer-GO → `race_finalize_resumable_enabled = on`. **5) Næste analyseopgaver (ejer 4/9):** #2749 S1-præmier for meget (frist 11/9) · #2457 AI-kvalitet pr. division (mål) · #4765 svaghedsrate (frist 11/9) · #2161 Discord-login (byg) · #4582 demote-kontrakt (WIP i worktree) · #3512 (rebaset, backend-tests rød) · #3426 måling. **6) Ejer-klik:** #4616 (EUR-planer i checkout + Stripe + 2 Railway-nøgler) → merge PR #4608 · visuelt go på draft-PR'er #4757, #4768, #4769.

> **⏳ Venter på DIN beslutning:** **#4376/PR #4388** sponsor-korrektion (IKKE godkendt, drøftes) · **#4629** træningsprogrammer · **#4632** løbsdagens intention · **#4613** træningssiden (PR #4736 draft) · **#4714** afstemning · #4627 design-sync · 12 punkter i `docs/audits/stale-issues-audit-2026-09-04.md` spand D (ét ad gangen).

> **🔴 Åbne fund:** **#2423** Skew Protection via `__vdpl`-cookie er SLÅET FRA (hotfix 057622162): Vercel pinner assets men ikke dokumentet ved browser-navigation → alle spillere med cookie fik 404 efter hvert deploy. Kun selvheling (#4595, live) + deploy-disciplin (ét vindue pr. bølge). · **CYCLINGZONE-56** chunk-fejl skal falde nu · **#4453** Railway-logvagt mangler secret · #4537 · #4530 · #4531 · #4109.

> **✅ Session 4/9 (Fable):** prod-udfald 08:16-08:36 (PR #4745 `?dpl=`) revertet; rod-årsag cachede 404 + immutable fundet → selvheling live (#4595, PR #4760) · merget: #4755 audit-timeout, #4756 alarm-dedupe (#2738), #4762 AI-hold nedlægges (flag OFF), #4766 GT-hviledags-vagt, #4767 genoptagelig afslutning (flag OFF), #4763 sæsonskifte-nøgle, #4761 U25-script, #4770 lofter 25→45 + GC punch 80 · prod-mutationer m. ejer-go: #4148 flag on, #4576 105 rækker expired, #3069 6 dubletter slettet, kolonner finalize_state/retired_at applied manuelt (auto-migrate stoppede på #4755-SQL, rettet caddc1b94) · 25+ beslutninger truffet, 20 issues lukket, 21 balance-issues flyttet fra needs-decision til sæsonskifte-kø · postmortems i `.claude/learnings/2026-09-04-*.md` (4 stk.).

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). 12 betalende (MRR 436 kr). #4616: EUR-planer findes i Alunta men ikke i checkout, Railway mangler EUR-nøgler → ejer-klik. #4514: kunden beholder Pro (ejer 4/9). B2C-only ønske (#4511/#4616 pkt 8).

> **✅ S3 kører:** 529 løb, 28/8 → søn 27/9. Etaper kører hver hele time; scheduler hvert 5. min.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (GT-hviledage bundet, #4209). **Pension:** afsluttet sæsons alder. Alders-referenceår = `riderSeasonAge.js` (S3=2028). U25 = 25 og yngre.
- **Race engine:** v3 låst fallback; v4-flip ejer-only. Krav til v4 (ejer 4/9): #2789 rute-huller, #2944 graduerede styrt + mekaniske uheld uden DNF, #2582 tidsgrænse.
- **Grundregler (rytter, værdi/løn, økonomi-balance) udskudt til efter 27/9** (ejer 28/8 + 4/9).
- **Mekanik:** PR'er merges med `--admin` én ad gangen, ÉT deploy-vindue pr. bølge; `database/*.sql` applies af auto-migrate.yml, Claude laver post-verify. Workers: maks 3 tunge, "push senest efter 15 min", fremdrift måles på branchens sidste push.

> **🤖 Working agent:** Fable (Claude Code, 4/9 fra ~12:45): forum-forbedringer + Community fredag + PR-runde. Andre sessioner: STOP + spørg.

_Historik i git-log, issue-tråde + docs/audits/._
