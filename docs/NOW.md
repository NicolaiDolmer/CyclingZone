# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Tøm bølge-køen - 24 PR'er venter, ingen merget** (bevidst: intet merge-go). Rækkefølge + reviewverdikter: [`docs/audits/night-wave-2026-08-30.md`](audits/night-wave-2026-08-30.md). Start med **#4477** (kalender-vagten går grøn uden at måle - anden gang klassen rammer) og **#4473** (fair play-detektoren har ALDRIG set direkte handler; kræver en rigtig `fairplayScoringDryRun`-kørsel med service-nøglen FØR merge). Derefter #4462 + #4480 (SSOT, frist 1/9) og #4474 (kalender-SSOT, frist 4/9 og før S4). **#4467 er spam** fra en ekstern bot (NEXAITECHAU, påstået "$500 bounty") - luk/rapportér selv.

> **⏳ Ejer-frister:** **#4376** PR #4388 udskudt til 31/8, må IKKE merges før du har overvejet den · **#4098** senest søn 31/8 (målt: 323 unge ryttere på 103 af 350 hold, ikke 353/124/362) · **#4176** senest 4/9 OG før S4 → PR #4474 klar · **#4266** frist 1/9 → PR #4462 klar. **#3494 blokerer #4265** (sponsor-vækstmål umuligt: `sponsor_income` = 240.000 for ALLE 230 hold). **#4213** de to tekster + NUA-køen (19 venter). **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** 10 stars vs PAT · **Z1 #1146** PR #4323 grøn, spillertest før merge.

> **🔴 Nye fund 31/8:** Natbølgen: **#4463** nat-vagten rapporterede grønt uden at måle noget - `| tee` maskerede parserens exit-kode; samme klasse i 7 steps over 5 workflows · **#4465** `calendar_monument_exclusive_game_day` håndhævede reglen du ophævede 26/8, levede 5 steder inkl. et prod-skrivende script · **#4479** `ECONOMY_RULES` lover en lønsats-paritetstest der ikke findes · **#4484** (triage 31/8) graduerings-sweepet fejlede 23x på én nat - én rytter med grad-række i to sæsoner låste både sweepet og managerens knap; PR #4494. Alle fire har PR. Discord-sweepet: **#4485** ungdomsklassementet inkluderer 26-årige - `raceRunner` bruger wall-clock-året fra `seasons.start_date` (2026), mens alderen regnes på sæson-referenceåret (2028); gapet vokser ét år pr. sæson. **Åbent:** skal S3's kørte `young`-rækker genberegnes?

> **🩹 Åbne fra 30/8:** **#4423** akademikontrakt midt i løb (PR #4422 = del A, DU merger) · **#4356** de 34 allerede kørte etaper: re-sim eller stå ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (bevidst urørt til #4356 er afgjort) · **#4103** falsk done-flag - målt 31/8 er højbjerg brudt i **3 af 4** divisioner (D1 7,7 % · D2 5,6 % · D4 16,1 %; D3 10,6 % består), ikke alle fire · **#4370** React #421 på forsiden · **#4146** 24 hold over trupgrænse · **#4204** verify-invariants timer ud mod prod og er nu **blokerende** for kalender-vagten.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.

> **⚖️ Åbent spildesign-valg (#4272):** brosten-målet er 5 % ELLER 6 % - begge tal lever i koden. Målt: D1 3,9 % · D2 4,8 % · D3 7,1 % · D4 4,8 %. D4 trækker 5/6 `summit_tour` → 16,1 % højbjerg. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **To regenereringer af samme kalender er forbudt.** Reglerne bor nu i [`CALENDAR_RULES.md`](CALENDAR_RULES.md) via PR #4474.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Økonomi/værdier S3:** låst, intet udestående flip. Detaljer i [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **0 åbne CodeQL-alarmer på main** (verificeret 30/8 - de 164 fra omdøbningen i #4392 er væk). **#4256 lukket:** den forældreløse branch var allerede i main via #3571/#3581.
- **Fair play:** #3818 + #4154 eksekveret. Prisloft sættes IKKE. Målt 31/8: kun **ét** aktivt værn - prisbåndet #3133 står disabled i prod, auktionsgebyret #2452 er ikke bygget, og 24 af 28 flag står ubehandlet.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117. Patch note-udkast for bølgen: [`drafts/2026-08-31-patch-note-natboelge.md`](../drafts/2026-08-31-patch-note-natboelge.md) - skriv den først ind når PR'erne er merget.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
