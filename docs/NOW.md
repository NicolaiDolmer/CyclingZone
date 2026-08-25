# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **#4236** — roden. Prompt: **`sessions/2026-08-26-samlet-workflow-session-prompt.md`** (S3 + forum, erstatter de tre tidligere). Tag evt. **#4123** først, så du kan SE hvad fixet flytter. Derefter #4183+#4233 (ét bug), #4200's rest, vagterne. **Tænd scheduler + entry-generator kun på ejer-GO, sidst.**

> **📅 S3 UDSKUDT TIL FREDAG 28/8** (#4218, ejer-direktiv 25/8): 28/8 → søn 27/9, **31 løbsdage, løb hver dag i alle fire divisioner**, kalenderen genereret forfra (531 løb, 22 nye tilføjet). Målt i prod: sæson 3 = `active`, 0 løbsdage kørt. **`stage_scheduler_enabled` og `auto_entry_generator_enabled` står `off`.** Alle spillere udtager forfra.

> **🚨 #4236 — verificeret mod prod 25/8:** én løbsdag spænder op til **9 kalenderdage** — D1 løbsdag 15 dækker 5/9, 10/9 og 13/9. D1 25/89, D3 21/47; D2/D4 rene. Bindingen lyver, så felterne ikke kan fyldes lovligt, og det brænder fast i resultater der ikke kan køres om. Rod: `raceCalendarLanePacker.js:1005`. **`game_day := dato − startdato` er afvist to gange** (#4155, #4158) — foreslå den ikke igen.

> **⚠️ 4 TIMER UDEN AKTIV SÆSON 25/8** (#4229, 07:30-11:50): alder, rangliste, træning og akademi nede for alle. `seasonRollover.mjs` kræver status `upcoming`; ingen satte den tilbage til `active`. **Alle fire kalender-invarianter rapporterede GRØNT imens.** Postmortem + vagt-rest i issuet.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) er bygget bag flag, flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8 (clawback + frys + auth-ban). **Ejer 24/8: prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum-sporet (parallelt, deler ingen filer med S3):** L1 merged+live (#4238). **#4249** dashboard-kort + layout-omlægning og **#4250** opbakning + citér-svar er MERGEABLE og afventer **ejerens visuelle go**. Efter #4250: kør `2026-08-25-3517-forum-reactions.sql` + fjern `schema-columns-ok` i `forum.js`. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag** (ikke pr. dato — den forveksling har kostet tre hændelser). **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only og sker aldrig som sidegevinst. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **📋 SESSION 25/8 (workflow):** Alle 11 blockers diagnosticeret read-only — **8 har skiftet karakter**, issue-teksterne kan ikke bruges som bevis. **#4183 = #4233** (ét bug, `aiTeamGenerator.js:403`). **#4201 afgjort:** sen udfyldning, 1 t før løb, sweep 60→15 min. 🆕 **Stage-mix brudt i alle 4 divisioner** (#4103, højbjerg 5,6–16,1 % mod 12 ±2) — afventer ejer-svar. 🆕 **24 SSOT-regler bagud** (#4176 + #4254). **#4016 halvt leveret** (PR #4253 låser hovedmappen til main). **Åbne ejer-spørgsmål:** stage-mix · #4174-niveau · fast GT-etapetal.

> **🤖 Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
