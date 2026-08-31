# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **PR #4473 (fair play) + #4508 (bonustilbud) er grønne og afventer merge.** Derefter **#4507** - `verify_race_result_duplicates` timer ud mod prod og gør kalender-vagten rød HVER nat nu, hvor #4477 er merget. Så **#2813**, der blokerer CZ Pro-salget (`needs-decision`; verifikation 1+2 lukket 31/8, rest er din gennemgang af teksten). Spor D uændret aktivt (ejer 31/8): #2853-mailtekster + /pro #4074. **Handoff (ejer-bestilt 31/8):** start næste session med [`drafts/2026-09-01-session-prompt-oplaas-og-byg.md`](../drafts/2026-09-01-session-prompt-oplaas-og-byg.md) - A måler 8 blokerede beslutninger, B bygger, C merger, D rydder **17 åbne `claude:done`**.

> **⛔ Venter på DIN beslutning:** **#4482 er BESLUTTET (valg A, ejer 31/8)** - PR #4508 wirer udløbet ind; oprydningen af de **36** (ikke 37) eksisterende tilbud er IKKE kørt og kræver spillerbesked FØRST. Udkast + SQL ligger klar, `[DATO]`-felt skal udfyldes (anbefalet frist: 48 t). **Konsekvens du bør kende:** når beskeden er ude, har 36 hold en grund til at indløse 200.000 CZ$ hver indenfor fristen.

> **⏳ Ejer-frister:** **#4376** PR #4388 må IKKE merges før du har overvejet den · **#4098** senest søn 31/8 · **#3494 blokerer #4265** (`sponsor_income` ens for alle hold) · **#4213** de to tekster + NUA-køen (19 venter). **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** 10 stars vs PAT · **Z1 #1146** PR #4323 grøn, spillertest før merge.

> **🔴 Nye fund 31/8** (alle med målinger i issuetråden): **#4493** sanitize-secrets falsk positiv · **#4495** 8 ryttere 22-23 år sidder fast på 6 hold, ejer-gated · **#4496** CI-vagt · **#4485** ungdomsklassement inkluderer 26-årige. **Åbent:** genberegnes S3's kørte `young`-rækker?

> **💳 Betaling 31/8:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md) + forfalds-vagt live (#4510/#4514 merget); planer ryddet. **🔴 Rod-årsag ÅBEN:** kortet trækkes aldrig trods gyldigt kort — **ÉN** betaling i historikken, og indstillingen findes ikke i API'et. Måles ved fornyelsen 1/9. · **#4512** dunning (ejer) · **#4511** EU-moms.

> **🩹 Åbne fra 30/8:** **#4423** akademikontrakt midt i løb (PR #4422 = del A, DU merger) · **#4356** de 34 allerede kørte etaper: re-sim eller stå ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (bevidst urørt til #4356 er afgjort) · **#4103** S4-forberedelse leveret 31/8 (valg A): S3 urørt (højbjerg-brud i 3/4 divisioner står), brosten afgjort **5 %** (6 %-konstanten fjernet), §6b's mål koblet ind i filler-vægtene som opt-in pr.-tier-tilt (`tierUniformFillerTilt.js`) klar til S4. **To regenereringer af samme kalender er forbudt** ([`CALENDAR_RULES.md`](CALENDAR_RULES.md)) · **#4370** React #421 på forsiden · **#4146** 24 hold over trupgrænse.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.


## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Økonomi/værdier S3:** låst, intet udestående flip. Detaljer i [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **0 åbne CodeQL-alarmer på main** (verificeret 31/8 via API).
- **Fair play:** #3818 i PR #4473 (afventer merge). Dry-run mod prod 31/8: detektoren så **121** handlende par før, **195** efter - alle 141 direkte handler var usynlige (sælger læst gennem slettet listing-række). Men **33 af 35 flag har nul identitets-signaler**: tærsklen 0,35 er et åbent justerings-spørgsmål. Admin-only. Prisloft sættes IKKE; #3133 disabled, #2452 ikke bygget.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117. Patch note-udkast for bølgen: [`drafts/2026-08-31-patch-note-natboelge.md`](../drafts/2026-08-31-patch-note-natboelge.md) - skriv den først ind når PR'erne er merget.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
