# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Sæsonstart-beredskab: holdudtagelsen mod den nye kalender.** Session-prompt: `sessions/2026-08-27-holdudtagelse-beredskab-session-prompt.md`. 30 hold udtager forfra inden fredag kl. 11; binding_span-koden (#4236) fik sin første prod-kalender i nat.

> **✅ S3-REGENERERINGEN GENNEMFØRT 27/8 kl. ~00:20 (runbook fulgt, ejer-GO pr. skridt).** Ny kalender live: **529 løb / 1.239 etaper**, 28/8 → søn 27/9. Prod-målt efter: 0 løbsdage over flere datoer (per pulje), 0 utilsigtede huller (kun GT'ernes 2 hviledage), mountain-nedad 27 % (før 64 %). Scorecard 0 regelbrud; 4 kalender-invarianter grønne. Vindue ~31 min. Udtagelser wiped m. backup (`backup_4236_*`, 1.101 rækker); 237 form-peaks bevaret m. `target_race_id=null`. **Motorerne er ON** (`stage_scheduler_enabled` + `auto_entry_generator_enabled`, ejer-GO 27/8). Spillertest af kalenderen i dag (ejer organiserer).

> **⚠️ Invariant-fund (ikke kalender):** #4184 udvidet (typelister + monument-værn forældet efter ophævelsen), #4146 (24 hold over trupgrænse), **#4282 NY** (2 hold over gældsloft). #4204 (20 min-kørsel) bekræftet.

> **✅ #4277 MERGED + ANVENDT (26/8, ddf70da62).** Løbsdags-udvikling har eget flag. Prod-verificeret: `race_day_development_enabled`=**off**, `race_day_engine_enabled`=**on** (D3+D4 bevaret). S3 = S2's løbsdags-regler; retur i S4. **Løs ende:** `audit` (league-size) rød på main + alle branches — ikke required, reelt dødt værn.

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

> **🤖 Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
