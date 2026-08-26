# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Kør S3-regenereringen.** Koden er merged; kun anvendelsen udestår. Køreplan: [`docs/runbooks/2026-08-27-s3-kalender-regenerering.md`](runbooks/2026-08-27-s3-kalender-regenerering.md) · session-prompt: `sessions/2026-08-27-s3-regenerering-session-prompt.md`. **Discord-besked FØRST**, derefter ejer-GO pr. skridt.

> **🔴 REGENERERINGEN ER BLOKERET AF TO VÆRN.** Sæson 3 står `active` (scripts kræver `upcoming`), og wipens gameplay-port stopper på **1.066 udtagelser — 991 spillernes egne fra 29 hold**, seneste 26/8 kl. 20:30. Begge skal åbnes eksplicit af ejeren. **#4229: statusskiftet gav 4 timers nedetid 25/8.** Fallback uden wipe: in-place `finale_type`-opdatering (retter de 144 bjergetaper, koster intet, retter ikke løbsdagene).

> **📅 S3 STARTER FREDAG 28/8 KL. 11** → søn 27/9. 31 løbsdage, løb hver dag i alle fire divisioner. `stage_scheduler_enabled` og `auto_entry_generator_enabled` står **off** — gen-tænding er ejer-only, allersidst.

> **✅ #4236 + #4272 + #4273 + #4275 MERGED (26/8).** Backend 7181/7181, scorecard exit 0, e2e grøn. **Men IKKE anvendt på S3.** Målt live 26/8 21:20: `mountain` 144 af 225 slutter **nedad** (64 %) · 61 løbsdage over flere datoer (værste 7) · 8 løb med hul.

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
