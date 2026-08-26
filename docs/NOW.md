# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **#4272** — bånd for hvordan etaperne slutter. Prompt: **`sessions/2026-08-26-kalender-kvalitet-session-prompt.md`**. Derefter #4273, frontend+preflight, PR for #4236+#4272 samlet, og **én** regenerering på ejer-GO.

> **📅 S3 STARTER FREDAG 28/8 KL. 11** → søn 27/9. 31 løbsdage, løb hver dag i alle fire divisioner. `stage_scheduler_enabled` og `auto_entry_generator_enabled` står **off** — gen-tænding er ejer-only, allersidst.

> **✅ #4236 LØST (26/8), mangler PR.** Kontiguitets-pakker: løbsdage i træk, én dato pr. løbsdag. Målt mod prod-katalog: straddle 40→**0** · løb med hul 8→**0** · falske bindinger 12→**0** · GT-spænd over loftet 2→**0**. Scorecard exit 0, backend 7167/7168. **Løser også #4190.** Branch `fix/4236-loebsdag-baand-pr-kalenderdato`. `raceCalendarLanePacker.js` 1483→620 linjer; stream+banded slettet.

> **🔴 #4272 SKAL MED I SAMME REGENERERING.** Bjergetaper slutter **nedad 59-70 %** i D1-D3, bakkeetaper svinger 33-86 % opad pr. division. Ejer-godkendte bånd står i issuet. Også: D1's brosten 3 % → 6 % · enkeltstart 10 % i alle divisioner (m. #4220) · mere overlap, monument-solo som præference. **To regenereringer er forbudt** — #4218's regenerering 25/8 skabte selv flere blockers.

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk ("løbsdag 4-5-6-7, ikke 3-5-7-12") · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere målt i alle 9 kombinationer efter #4217 — gevinsten var væk, hullerne blev betalt) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249) og opbakning (#4250) er merged+live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4248 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **📋 SESSION 26/8:** #4239 merged (kalender-værktøjet lever). #4236 bygget og grøn. Ny gæld: **#4273** (#3347-testen kan ikke længere fremprovokere reparations-stien — 400 sæsoner søgt, 0 brud) · **#4274** (dev-script skrev rapport i et andet worktree). Løse worktrees med ucommitted filer: `feat/4030-h2h-scorecard`, `fix/3709-signaturfaktor`.

> **🤖 Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
