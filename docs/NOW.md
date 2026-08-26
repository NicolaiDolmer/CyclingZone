# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejer-GO til merge af [PR #4276](https://github.com/NicolaiDolmer/CyclingZone/pull/4276)** (#4236+#4272+#4273) + **ÉN** regenerering. Dry-run med før/efter-diff FØR skrivning. Tænd derefter `stage_scheduler_enabled` + `auto_entry_generator_enabled` (ejer-only, allersidst). **Åben beslutning: D4’s samlede opad 41,9 % mod bånd 25-32 %** (#4272).

> **🔴 #4275 — main er RØD på `frontend-smoke`: dashboardet flyder vandret over på mobil** (siden 535 px bred på en 393 px skærm; sprogvælgeren var kun symptomet). Rod: `grid lg:grid-cols-2` uden `grid-cols-1` → implicitte auto-kolonner. Fix i [PR #4280](https://github.com/NicolaiDolmer/CyclingZone/pull/4280), ejer-godkendt visuelt. **#4280 skal merges FØR #4276** — den er required check.

> **📅 S3 STARTER FREDAG 28/8 KL. 11** → søn 27/9. 31 løbsdage, løb hver dag i alle fire divisioner. `stage_scheduler_enabled` og `auto_entry_generator_enabled` står **off** — gen-tænding er ejer-only, allersidst.

> **✅ #4236 + #4272 + #4273 KLAR TIL MERGE** (26/8, branch `fix/4236-loebsdag-baand-pr-kalenderdato`). #4236: løbsdage i træk, én dato pr. løbsdag — straddle 40→**0**, huller 8→**0**, falske bindinger 12→**0**. #4272: bjerg-opad 6-13 %→**52-60 %**, bjerg-nedad 59-70 %→**20-33 %**; sæson-aggregatet rammer ALLE bånd uden tolerance. Scorecard exit 0, backend **7181/7181**, preflight grøn. **Løser også #4190.**

> **⚠️ TO KATALOG-LOFTER + ÉT ÅBENT VALG (#4272).** D1's brosten nåede 2,6→**4,5 %** (6 % kræver flere brostens-løb; ved 8 reservationer falder D3 under sit gulv). D4's enkeltstart 4,8→**8,1 %** (kun 3 fritstående ITT-løb i Class1/Class2). **Uløst:** D4 trækker 5 af 6 `summit_tour`, hver med 2 garanterede højbjergs-etaper → 16 % højbjerg mod D1's 8 %, og samlet opad 41,9 %. Kræver arketype-**loft** (reservationer er gulve) eller flere flade Class1/Class2-etapeløb. **Spildesign-valg, afventer ejer.** **To regenereringer er forbudt.**

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk ("løbsdag 4-5-6-7, ikke 3-5-7-12") · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere målt i alle 9 kombinationer efter #4217 — gevinsten var væk, hullerne blev betalt) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249) og opbakning (#4250) er merged+live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4248 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **📋 SESSION 26/8 (aften):** #4272 bygget, #4273 løst (fixturen valgte aldrig en fritstående ITT, så hvert træk udtømte gen-trækkene — forsyningen hævet, testen uændret). `descent_finale_min` re-deriveret (D2 10→5, D4 4→3): ejerens bånd gjorde D2's gulv matematisk uopnåeligt, og 20 af 400 sæsoner udtømte re-drawet — nu 0. Patch note 7.194. **Løse worktrees sikret+pushet** (#4030 296 linjer, #3709 236 linjer). Rest: **#4274** (dev-script skrev rapport i et andet worktree).

> **🤖 Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
