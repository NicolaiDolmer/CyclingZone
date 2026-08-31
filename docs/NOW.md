# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **#2813** blokerer CZ Pro-salget (`needs-decision`) — verifikation 1+2 lukket 31/8, rest er din gennemgang af teksten. Derefter **Spor D:** #2853-mailtekster + /pro #4074. Audit 31/8: 602→561 åbne ([dashboard](audits/backlog-priorities-2026-08-31.md), evidens #627). Patch note-udkast i `drafts/` mangler i PatchNotesPage.

> **⛔ Venter på DIN beslutning:** **PR #4483** (#4479) er parkeret 31/8 og må IKKE merges. `/rules` fortæller spillerne at lønnen fryses ved **6,7 % af markedsværdien**; koden bruger **35 % af `current_production_value`** (`contractSeed.js:38-42`, verificeret 31/8). Både sats og grundlag er forkert, og drift-guarden var grøn fordi den pinnede til `SALARY_RATE`, død siden #3989. **Åbent spørgsmål:** skal afvigelsen måles på faktisk signerede kontrakter før patch noten skrives? · **#4482** skal lag 6-bonustilbud udløbe (37 aktive på afsluttede sæsoner).

> **⏳ Ejer-frister:** **#4376** PR #4388 må IKKE merges før du har overvejet den · **#4098** senest søn 31/8 · **#3494 blokerer #4265** (`sponsor_income` ens for alle hold) · **#4213** de to tekster + NUA-køen (19 venter) · **#4515** PR #4517 (migration kører VED merge): sponsor-bonusloftet nulstilledes aldrig, 2 hold fik 0 i andet kontraktår. **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** 10 stars vs PAT · **Z1 #1146** PR #4323 grøn, spillertest før merge.

> **🔴 Nye fund 31/8** (målinger i issuetråden): **#4479** lønsats-vagten fandtes ikke (se blokken ovenfor) · **#4493** sanitize-secrets falsk positiv · **#4484** graduerings-sweep (PR #4494) · **#4495** 8 ryttere 22-23 år sidder fast på 6 hold, ejer-gated · **#4496** CI-vagt · **#4485** ungdomsklassement inkluderer 26-årige. **Åbent:** genberegnes S3's kørte `young`-rækker?

> **💳 Betaling 31/8:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md) + forfalds-vagt live (#4510/#4514 merget); planer ryddet. **🔴 Rod-årsag ÅBEN:** kortet trækkes aldrig trods gyldigt kort og korrekt opsætning — **ÉN** betaling i historikken; indstillingen findes hverken i MCP eller REST. Måles ved fornyelsen 1/9. · **#4512** dunning (ejer) · **#4511** EU-moms.

> **🩹 Åbne fra 30/8:** **#4423** akademikontrakt midt i løb (PR #4422 = del A, DU merger) · **#4356** de 34 allerede kørte etaper: re-sim eller stå ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (bevidst urørt til #4356 er afgjort) · **#4103** falsk done-flag - målt 31/8: højbjerg brudt i **3 af 4** divisioner, ikke alle fire (tal i tråden) · **#4370** React #421 på forsiden · **#4146** 24 hold over trupgrænse · **#4204** verify-invariants timer ud mod prod og er nu **blokerende** for kalender-vagten.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.

> **⚖️ Åbent spildesign-valg (#4272):** brosten-målet er 5 % ELLER 6 % - begge tal lever i koden; målinger pr. division i issuetråden. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **To regenereringer af samme kalender er forbudt.** Regler: [`CALENDAR_RULES.md`](CALENDAR_RULES.md).

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Økonomi/værdier S3:** låst, intet udestående flip. Detaljer i [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **0 åbne CodeQL-alarmer på main** (verificeret 31/8 via API).
- **Fair play:** #3818 + #4154 eksekveret. Prisloft sættes IKKE. Målt 31/8: kun **ét** aktivt værn (#3133 disabled, #2452 ikke bygget, 24 af 28 flag ubehandlet).
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117. Patch note-udkast for bølgen: [`drafts/2026-08-31-patch-note-natboelge.md`](../drafts/2026-08-31-patch-note-natboelge.md) - skriv den først ind når PR'erne er merget.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
