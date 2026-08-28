# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejer-rest:** post kommunikationspakken ([`drafts/2026-08-27-kommunikationspakke-saesonstart.md`](drafts/2026-08-27-kommunikationspakke-saesonstart.md)) — ejer siger "senere" 28/8; tilfoej linje om trup-opfyldningen. **#4307 KOERT 28/8** (411 ryttere, 89 inaktive hold, 30-dages-graense, post-verify OK — se issue-kommentar; genmaaling: gulvets egen pris nu 42 starter). **#4212 BESLUTTET 28/8:** retning B "kortet som kontrakt" (se issue-kommentarer, daekker #4271-kernen). **Blokeret:** #4301 (draft) ← #4311-reparation af dagens kuld (taktik-laek, 205 m. potentiale >2,5 — PR paa vej). **Naeste build:** #4317 · #4259 · Z1 #1146.

> **🧱 Nyt spor (efter fredag, MASTERPLAN pkt. 16):** PR **#4334** taender frontend-typecheck + regenererer skematyper (`database.types.ts` daekkede 46 af 143 tabeller). Afventer ejer. Opfoelgning #4326-#4333.

> **⚠️ Aabne fra 27/8:** #4288 (de 3 GT'er koerer 17-18 etaper, baandet kraever 21 = umaalte) · #4282 (hold transfer-frosset af renter alene, ejer-beslutning) · #4318 (to flader siger "Race day" om to forskellige tal).

> **✅ S3-KALENDEREN LIVE (regenereret 27/8, ejer-GO pr. skridt):** 529 løb / 1.239 etaper, 28/8 → søn 27/9. 0 løbsdage over flere datoer, mountain-nedad 27 % (før 64 %), scorecard 0 regelbrud. Udtagelser wiped m. backup (`backup_4236_*`). Løbsdags-udvikling har eget flag (#4277) og er **off** i S3 — S2-regler, retur i S4.

> **⚠️ Invariant-fund (ikke kalender):** #4184 udvidet (typelister + monument-værn forældet efter ophævelsen), #4146 (24 hold over trupgrænse), **#4282 NY** (2 hold over gældsloft). #4204 (20 min-kørsel) bekræftet.

> **⚠️ TO KATALOG-LOFTER + ÉT ÅBENT VALG (#4272).** D1's brosten nåede 2,6→**4,5 %** (6 % kræver flere brostens-løb; ved 8 reservationer falder D3 under sit gulv). D4's enkeltstart 4,8→**8,1 %** (kun 3 fritstående ITT-løb i Class1/Class2). **Uløst:** D4 trækker 5 af 6 `summit_tour`, hver med 2 garanterede højbjergs-etaper → 16 % højbjerg mod D1's 8 %, og samlet opad 41,9 %. Kræver arketype-**loft** (reservationer er gulve) eller flere flade Class1/Class2-etapeløb. **Spildesign-valg, afventer ejer.** **To regenereringer er forbudt.**

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk ("løbsdag 4-5-6-7, ikke 3-5-7-12") · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere målt i alle 9 kombinationer efter #4217 — gevinsten var væk, hullerne blev betalt) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249), opbakning (#4250) live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4248 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Working agent:** Session 28/8 formiddag (Claude Code, DOLMERPC): #4307 (koert) + 3 worktree-spor i gang: #4306 (fix/4306-afmeldt-hold-starter), #4311 (fix/4311-fyld-klemme), #4212+#4271 fase B (fix/4212-peak-kontrakt). Roerer IKKE #4344 (anden session) eller saesonmatrix #1146.

_Historik i git-log, issue-tråde + docs/audits/._
