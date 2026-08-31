# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **23 PR'er i køen.** Trin 1+2 merget 31/8 (11 PR'er); main verificeret efter hver salve: guards exit 0, preflight grøn, 7.506 backend-tests grønne. **Næst:** trin 3, de fire spillervendte (#4466 #4472 #4468 #4476) - teksterne er vist og godkendt, mangler kun patch note ved merge (udkast i `drafts/`). Derefter #4503. Rækkefølge: [audit-doc](audits/night-wave-2026-08-30.md). **#4467** er spam, konto blokeret.

> **⛔ Venter på DIN beslutning:** **PR #4483** (#4479) er parkeret 31/8 og må IKKE merges. `/rules` fortæller spillerne at lønnen fryses ved **6,7 % af markedsværdien**; koden bruger **35 % af `current_production_value`** (`contractSeed.js:38-42`, verificeret 31/8). Både sats og grundlag er forkert, og drift-guarden var grøn fordi den pinnede til `SALARY_RATE`, død siden #3989. **Åbent spørgsmål:** skal afvigelsen måles på faktisk signerede kontrakter før patch noten skrives? · **#4482** skal lag 6-bonustilbud udløbe (37 aktive på afsluttede sæsoner).

> **⏳ Ejer-frister:** **#4376** PR #4388 må IKKE merges før du har overvejet den · **#4098** senest søn 31/8 (målt: 323 unge ryttere på 103 af 350 hold) · **#3494 blokerer #4265** (`sponsor_income` = 240.000 for ALLE 230 hold) · **#4213** de to tekster + NUA-køen (19 venter). **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** 10 stars vs PAT · **Z1 #1146** PR #4323 grøn, spillertest før merge.

> **🔴 Nye fund 31/8** (alle med målinger i issuetråden): **#4463** nat-vagt grøn uden at måle · **#4465** ophævet kalenderregel håndhævet 5 steder (begge PR #4477) · **#4479** lønsats-vagten fandtes ikke (se blokken ovenfor) · **#4502** AGENTS.md brød token-loftet (PR #4503) · **#4493** sanitize-secrets falsk positiv · **#4484** graduerings-sweep (PR #4494) · **#4495** 8 ryttere 22-23 år sidder fast på 6 hold, ejer-gated · **#4496** CI-vagt · **#4485** ungdomsklassement inkluderer 26-årige. **Åbent:** genberegnes S3's kørte `young`-rækker?

> **🩹 Åbne fra 30/8:** **#4423** akademikontrakt midt i løb (PR #4422 = del A, DU merger) · **#4356** de 34 allerede kørte etaper: re-sim eller stå ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (bevidst urørt til #4356 er afgjort) · **#4103** falsk done-flag - målt 31/8 er højbjerg brudt i **3 af 4** divisioner (D1 7,7 % · D2 5,6 % · D4 16,1 %; D3 10,6 % består), ikke alle fire · **#4370** React #421 på forsiden · **#4146** 24 hold over trupgrænse · **#4204** verify-invariants timer ud mod prod og er nu **blokerende** for kalender-vagten.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.

> **⚖️ Åbent spildesign-valg (#4272):** brosten-målet er 5 % ELLER 6 % - begge tal lever i koden. Målt: D1 3,9 % · D2 4,8 % · D3 7,1 % · D4 4,8 %. D4 trækker 5/6 `summit_tour` → 16,1 % højbjerg. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **To regenereringer af samme kalender er forbudt.** Reglerne bor nu i [`CALENDAR_RULES.md`](CALENDAR_RULES.md) via PR #4474.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Økonomi/værdier S3:** låst, intet udestående flip. Detaljer i [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **0 åbne CodeQL-alarmer på main** (verificeret 31/8 via API; alarm #353, ufuldstændig shell-escape i railway-log-watch fra #4453, lukket af PR #4506).
- **Fair play:** #3818 + #4154 eksekveret. Prisloft sættes IKKE. Målt 31/8: kun **ét** aktivt værn - prisbåndet #3133 står disabled i prod, auktionsgebyret #2452 er ikke bygget, og 24 af 28 flag står ubehandlet.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117. Patch note-udkast for bølgen: [`drafts/2026-08-31-patch-note-natboelge.md`](../drafts/2026-08-31-patch-note-natboelge.md) - skriv den først ind når PR'erne er merget.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
