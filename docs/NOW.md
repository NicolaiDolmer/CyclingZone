# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Start naeste saesonstart-session** paa prompten [`superpowers/plans/2026-08-28-saesonstart-fortsaettelse-prompt.md`](superpowers/plans/2026-08-28-saesonstart-fortsaettelse-prompt.md). Den starter med **spillerne**: laes 24 timers Discord, foreslaa svar, skriv Discord-patch-notes for 7.204-7.207, og list hvad der er paa tegnebraettet. **Merget 27/8:** #4302 · #4300 · #4304 (migration applied) · #4303. **Holdt tilbage med vilje:** #4301 minimum-6 (blokerende fund + grundlaget flyttede sig, se prompten §3). **Derefter:** #4306 · spor B (#4296 · #4259) · #4201/#4212/#4271 · Z1. **Ejer-rest:** post Discord-varslet (RET datoen foerst) · #4307 aktivitets-definition.

> **✅ PEAK-REPARATION 27/8 (ejer-GO kl. 09:2x):** kalender-regenereringen nullede `target_race_id` (FK er `ON DELETE SET NULL`) men lod vinduerne stå med den GAMLE kalenders datoer. **812** foraeldreløse planer, 731 med vinduer i den live sæson, **280 ryttere på 27 menneskehold ville stå i utilsigtet peak på åbningsdagen**. NOW.md's tidligere tal "237" var forkert. Backup `backup_4294_rider_peak_plans` (812 rækker), slettet, post-verify: 82 planer tilbage, alle med gyldigt målløb, 0 uden mål. Forward-guard (FK → CASCADE + filter i `loadPeakPlans`) i PR.

> **✅ NATSESSION 27/8:** 5 PR'er, 0 prod-mutationer. Prod read-only: overlap pr. løbsdag **0**, alle motor-flag **on** (`race_day_development` off). Assistenten er **pull, ikke push** (24.615 af 24.724 S3-udtagelser på AI-hold). **Åbent:** #4288 (de 3 GT'er er umålte, båndet er forældet) · #4282 (hold transfer-frosset af renter alene, ejer-beslutning).

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

> **🤖 Working agent:** Parallel-session 27/8 (Claude Code, DOLMERPC): saesonmatrix #1146 + #4246 + ops #4308/#4309. Roerer IKKE #4296/#4259/#4212/peak-undersoegelsen (anden session).

_Historik i git-log, issue-tråde + docs/audits/._
