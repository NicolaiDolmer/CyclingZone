# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejer-rest:** post kommunikationspakken ([`drafts/2026-08-27-kommunikationspakke-saesonstart.md`](drafts/2026-08-27-kommunikationspakke-saesonstart.md)) + linje om trup-opfyldning + RET "Fra i morgen" i minimum-6-varslet (gulvet er LIVE). **PR #4359 MERGED 28/8** (peak-kontrakt, patch 7.214; #4212+#3088 lukket, #4271-kernen leveret). **Sessionens rest:** #4201-nedskrivning + eftersyn af kl. 14-18-loebene under de nye regler. **Naeste build:** #4317 · #4259 · Z1 #1146 · #4355.

> **✅ Sæsonstart-dagen 28/8, alt merged+deployet:** #4307 opfyldning KOERT (411 ryttere/89 inaktive hold) · #4311 fyld-klemme + datareparation (PR #4354) · #4306 afmeldt-hold-fix (PR #4360, patch 7.211) · **#4301/#4295 minimum-6-gulvet LIVE** (PR #4301, patch 7.212-7.213; gulvets pris i dag: 42 starter, genmaalt efter opfyldning). Motorflag verificeret armeret, Sentry ren, deploy-verify groen 11:36.

> **🧱 Nyt spor (efter fredag, MASTERPLAN pkt. 16):** PR **#4334** taender frontend-typecheck + regenererer skematyper (`database.types.ts` daekkede 46 af 143 tabeller). Afventer ejer. Opfoelgning #4326-#4333.

> **✅ #4344 lukket fremad (28/8):** etape-taktikken kunne gemme 2 kaptajner (guarden talte kun payloaden, ikke basis-rollen). PR **#4353** merged 28/8 (ejer-go, 24/24 checks). Udskilt: **#4356** (ejer-beslutning: de 34 allerede koerte etaper, re-sim eller staa ved dem) · **#4357** (`loadEntrantsForRace` mangler ORDER BY; tie-breaket er bevidst uroert indtil #4356 er afgjort).

> **⚠️ Aabne fra 27/8:** #4288 (de 3 GT'er koerer 17-18 etaper, baandet kraever 21 = umaalte) · #4282 (hold transfer-frosset af renter alene, ejer-beslutning) · #4318 (to flader siger "Race day" om to forskellige tal).

> **✅ S3-KALENDEREN LIVE (regenereret 27/8, ejer-GO pr. skridt):** 529 løb / 1.239 etaper, 28/8 → søn 27/9. 0 løbsdage over flere datoer, mountain-nedad 27 % (før 64 %), scorecard 0 regelbrud. Udtagelser wiped m. backup (`backup_4236_*`). Løbsdags-udvikling har eget flag (#4277) og er **off** i S3 — S2-regler, retur i S4.

> **⚠️ Invariant-fund (ikke kalender):** #4184 udvidet (typelister + monument-værn forældet efter ophævelsen), #4146 (24 hold over trupgrænse), **#4282 NY** (2 hold over gældsloft). #4204 (20 min-kørsel) bekræftet.

> **⚠️ Katalog-lofter + åbent valg (#4272):** D1 brosten 4,5 % (mål 6) · D4 ITT 8,1 % · D4 trækker 5/6 `summit_tour` → 16 % højbjerg og 41,9 % opad. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **Spildesign-valg, afventer ejer. To regenereringer er forbudt.**

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk ("løbsdag 4-5-6-7, ikke 3-5-7-12") · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere målt i alle 9 kombinationer efter #4217 — gevinsten var væk, hullerne blev betalt) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249), opbakning (#4250) live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4248 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Working agent:** Session 28/8 (Claude Code, DOLMERPC): saesonstart-leverancerne (se ✅-linjen) + PR #4359 afventer ejer. Roerer IKKE #4344-udloeberne (#4356/#4357) eller Z1 #1146.

_Historik i git-log, issue-tråde + docs/audits/._
