# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **#4200 + #4201 + #4217** — holdudtagelsen skal virke. Det var dem der udskød sæsonen. Derefter #4183/#4233 (nye spillere har ingen landingsplads), #4174 (ét ejer-svar: hvor højt fyldes inaktive trupper), vagterne (#4229 #4215 #4219 #4123), #4211's 6 brud, og til sidst **tænd scheduler + entry-generator — kun på ejer-GO.**

> **📅 S3 UDSKUDT TIL FREDAG 28/8** (#4218, ejer-direktiv 25/8): 28/8 → søn 27/9, **31 løbsdage, løb hver dag i alle fire divisioner**, kalenderen genereret forfra (531 løb, 22 nye tilføjet). Målt i prod: sæson 3 = `active`, 0 løbsdage kørt. **`stage_scheduler_enabled` og `auto_entry_generator_enabled` står `off`.** Alle spillere udtager forfra.

> **🚨 #4236 — kalender-blocker fundet 25/8:** samme løbsdag dækker flere datoer (D1 25 af 89, D3 21 af 47; D2/D4 rene). **Det er årsagen til de fire tynde endagsløb** — Le Mur de Huy deler løbsdag 29 med Tour des Émirats, der sluttede dagen før. Feltet er ikke lovligt at fylde, så at rydde auto-udtagelserne giver samme resultat igen. `CALENDAR_RULES.md` §0 siger en løbsdag bor INDE i én kalenderdag → det er en fejl, ikke slot-designet.

> **⚠️ 4 TIMER UDEN AKTIV SÆSON 25/8** (#4229, 07:30-11:50): alder, rangliste, træning og akademi nede for alle. `seasonRollover.mjs` kræver status `upcoming`; ingen satte den tilbage til `active`. **Alle fire kalender-invarianter rapporterede GRØNT imens.** Postmortem + vagt-rest i issuet.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) er bygget bag flag, flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8 (clawback + frys + auth-ban). **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (ikke pr. dato — den forveksling har kostet tre hændelser). **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only og sker aldrig som sidegevinst. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **📋 SESSION 25/8:** GitHub-audit (32 lukket, 9 falske done-flag flippet, `claude:done` 43→5, åbne 607→576) · #4213 ejer-valg: auktionerne får lov at køre · **hard rule 30 + fire nye SSOT'er** (RACE_ENGINE, PLANNING_CENTER, ECONOMY, PROGRESSION) · Z1-designet besluttet, 4 valg, spec i `superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md`.

> **🤖 Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
