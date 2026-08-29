# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action — ejer-frister:** **#4376 HASTER** (S3 er 1 dag gammel): 21 af 24 D1-hold kører på en lavere divisions sponsor-base — ret med tilbagevirkende kraft nu, eller kun fremadrettet fra S4? · **#4265 vs MASTERPLAN**: dit S3-direktiv (adskil bestyrelse/sponsor i UI) står på UDSKUDT-listen — hvad gælder? · **#4213** de to tekster (nu en LØST sag: 153 managere fik virkende kort igen) + **den ryddede NUA-kø** (19 venter) · **#4098** senest **søn 31/8** (124 hold ramt) · **#4266** SSOT for 10 kernefunktioner **senest 1/9** — sponsor+bestyrelse har ingen; [prompt klar](sessions/2026-08-29-sponsor-og-bestyrelse-ssot-session-prompt.md) · **#4176** kalender-SSOT **senest 4/9 OG før S4**. **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** 10 stars vs PAT · **Z1 #1146** PR #4323 grøn, spillertest før merge. Derefter: #4317 · #4259 · #4355 · #4367.

> **✅ 29/8 leveret:** Discord-sweep → 10 issues (**#4373-#4382**) + 3 evidens-kommentarer (#3145 #4181 #3948). **#4376 rod-årsag bevist**: `guaranteed_base` skrives på valg-tidspunktet og rebases aldrig ved oprykning; `expireAndRenewContracts` rebaser KUN race-day-raten. Skarpt tidsskel 23/8 17:35→18:22 UTC — transitionens auto-fornyelse rammer rigtigt, hvert manuelt valg før rammer forkert. Min. 2,2 mio. CZ$ underbetalt over 37 hold. Ingen kode/data rørt. **#4213 lukket:** guards #4383+#4384 live i prod, 166 ryttere frigivet, AI-hold fyldt op, **153 managere har virkende kort igen**. **Rest: 105 udskudte** — kør `repair4213AcademyOffers.mjs --live` når deres 14 etapeløb er kørt.

> **⚠️ Åbne fra 28/8:** **#4103** falsk done-flag (højbjerg brudt i alle 4 divisioner) · **#4370** React #421 på forsiden · **#4369** rod-årsag bag session-afvisningen.

> **⚠️ Udskilt af #4344 (PR #4353 merged 28/8):** **#4356** ejer-beslutning: de 34 allerede koerte etaper, re-sim eller staa ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (tie-break bevidst uroert indtil #4356 er afgjort).

> **⚠️ Aabne fra 27/8:** #4288 (de 3 GT'er koerer 17-18 etaper, baandet kraever 21 = umaalte) · #4282 (hold transfer-frosset af renter alene, ejer-beslutning) · #4318 (to flader siger "Race day" om to forskellige tal).

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.

> **⚠️ Invariant-fund:** #4146 (24 hold over trupgrænse) · #4204 (verify-invariants tager 20 min).

> **⚠️ Katalog-lofter + åbent valg (#4272):** D1 brosten 4,5 % (mål 6) · D4 ITT 8,1 % · D4 trækker 5/6 `summit_tour` → 16 % højbjerg og 41,9 % opad. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **Spildesign-valg, afventer ejer. To regenereringer er forbudt.**

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere i alle 9 kombinationer efter #4217) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3 (låst, intet udestående flip):** base_value = model(c 0,811 + type-dæmpning k=100, #4000 flippet 23/8 i PR #4135) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249), opbakning (#4250) live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Working agent:** Claude Code (Opus 5) — sponsor+bestyrelse SSOT (#4266/#4265/#4376), startet 29/8 ~11.00.

_Historik i git-log, issue-tråde + docs/audits/._
