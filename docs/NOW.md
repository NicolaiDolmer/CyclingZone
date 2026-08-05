# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring

> **🎯 Next action (3 ting venter på dig):**
> 1. **[#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360) pengemængden — ét ja/nej.** Genmålt 5/8: issuets 4,24× er delvis en **målefejl** (`freshPopulationBurden.js:61` regner med 1.288 CZ$ løn pr. hold pr. sæson), men prod er værre end issuet: **+500.198 CZ$ garanteret net pr. hold pr. sæson** = 1,0× startkapital, mod målet 37.500. Rod-årsag: lønbyrden er **5,6 % af sponsoren** mod designets 85 %. Spørgsmålet er ikke tærsklen, det er økonomien. Anbefaling: start med **lønnen** (rammer det du EJER, ikke det du PRÆSTERER → straffer ikke styrke). Fuldt oplæg + 3 veje i issue-tråden.
> 2. **[#3386](https://github.com/NicolaiDolmer/CyclingZone/issues/3099) auktions-førernavn afventer dit visuelle go.** Klar og grøn, men agenten gik en anelse bredere end issuet (ny "Ingen bud endnu"-tilstand + navnet vises også når du selv fører). Skærmbilleder i PR-bodyen.
> 3. **Økonomi: 9 mekanismer godkendt 5/8, men målingen flyttede hvad der skal fikses først.** Lønsatsen rammer ~20 % og virker som designet — den ganges bare med `current_production_value`, som er **11× under** markedsværdien og nærmest flad over alder. Konsekvens: et ungt talent til 180.000 koster 1.273/sæson, en 34-årig til 20.000 koster 2.971. **At hæve satsen løser derfor ingenting.** Gaten inden kode: skal lønnen prissættes efter markedsværdi i stedet, og skal eksisterende kontrakter så genberegnes (løn frosset ved signering, #1309)? 👍 Ja + genberegn ved sæsonskiftet 23/8. Fuldt talgrundlag i [#3360](https://github.com/NicolaiDolmer/CyclingZone/issues/3360)-tråden. ⚠️ De 9 må ikke shippes samtidig.
>
> **✅ Ryttertype-backfillen er KØRT 5/8** efter ejer-go: 8.176 ryttere, 4.249 typer skiftet, `valuation_type` urørt for alle (verificeret mod snapshot). Snapshot `riders_type_backfill_snapshot_20260805` beholdes indtil fordelingen er set an. **#3349's måltal skal nu sættes på den NYE population.**

> **🟢 5/8 aften: gaten lukket + 5 PR'er merged.** [#3367](https://github.com/NicolaiDolmer/CyclingZone/issues/3367) worktree-isolation LUKKET (#3384) — worktrees junctioner nu til en lockfile-hashet cache uden for begge checkouts; `npm ci` i et worktree kan ikke længere nå hoved-checkoutet (verificeret destruktivt). Hard rule 14 er nu 🔒. Merged: #3383 (rød main) · #3384 · #3363 lånebekræftelse · #3275 pulje-reseed (flag **off**, migration applied + post-verificeret) · #3388 dashboard-løbslinks · #3387 divisionsbonus-tekst. Patch notes v7.96. **To uplanlagte fund:** main var rød uden en eneste ny commit (klokke-afhængig test detonerede kl. 13:00 UTC → #3385) · repoet var en **shallow clone** (`.git/shallow` fra natbølgen), hvilket gjorde `git merge` umulig og rebase katastrofal — løst med `--unshallow`.

> **🔴 Platform:** Prod 191 brugere, 54 aktive/7d. Dag-1 ~31 % seneste 2 uger (var ~64 % juni), last_seen-metode ([#3310](https://github.com/NicolaiDolmer/CyclingZone/issues/3310)). #2853 venter på Resend-nøgle. Railway MCP kræver re-auth.

> **📌 Åbne opfølgninger:** [#3385](https://github.com/NicolaiDolmer/CyclingZone/issues/3385) klokke-afhængige tests (6 filer i risiko) · **[#3337](https://github.com/NicolaiDolmer/CyclingZone/issues/3337) målt: specialisering betaler sig kraftigt (+84 % point ved samme pris)** — men kun klatring og spurt er levedygtige; puncheur har en 7,9× prispræmie i V4 og leverer 503 point/mio. mod climberens 1.358 → hører i #3353 · [#3349](https://github.com/NicolaiDolmer/CyclingZone/issues/3349) måltal skal sættes på POST-backfill-populationen (puncheur går 0,3 % → 9,3 % af reklassificeringen alene) · #3347 tier 3-realisme-gate (før 23/8) · #3295 S3-kalender · #3145 · #3112 · #2830 ureviewet · #2645 Del B · #3172 (luk ~18/8) · #2164 (ved S2→S3).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden. D1 = kun AI. **#1688-hard-gaten er shippet.** **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Sikkerhed:** #691 · #929 · #2802/#2803 — åbne. **Skalering:** #323 (~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag **inden for puljen**. Grace afvist. **Pension:** måles på AFSLUTTET sæsons alder.

_Trimmet 5/8 (aftenbølge-close-out). Historik i git-log, issue-tråde + docs/audits/._
