# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ejerens fredag-morgen-rutine (28/8, sæsonstart kl. 11).** Rapport + de 3 beslutninger: [`docs/audits/2026-08-28-natsession-rapport.md`](audits/2026-08-28-natsession-rapport.md). Rækkefølge: review+merge **PR #4284** (din egen) → **#4285** (#4200) → **#4286** (#4233: D4-A på 25) → apply #4284s migration → §6-tjeklisten (query 3 **kl. ~10:15**) → **post svar-udkastene i Discord** (`docs/drafts/2026-08-27-4261-svarudkast-loeb-som-traening.md`). Også åben: **#4291** (rå i18n-nøgler, rører spillertekst). **Triage 27/8 lagde to på:** **PR #4298** (backend-only, CI grøn — balance-drift-vagten crashede hver dag i pausen) og **#4299** (en spillers kaptajn er udtaget til åbningsløbet UDEN binding; både DB-constrainten og span-guarden er blinde for rækken).

> **✅ NATSESSION 27/8 (01:10-02:30): 5 PR'er, 0 prod-mutationer.** Prod read-only kl. 02:10: overlap pr. løbsdag **0**, binding-sanity **0/0**, alle motor-flag **on** (`race_day_development` off). 14 af 15 puljer på 24; **D4-A på 25** (fikset i #4286). Assistenten er pull, ikke push: af 24.724 S3-udtagelser ligger 24.615 på AI-hold og kun 109 på 3 menneskehold, alle player-initierede. **Nye fund:** D1 har 0 brosten-i-etapeløb (bånd ≥1) · de 3 GT'er kører 17-18 etaper og er derfor **umålte** (**#4288**, båndet er forældet, ikke kalenderen) · #4282+#4146 er begge **vagt-fejl**, 0 reelle brud. **Ejer-beslutning venter:** et hold er transfer-frosset af renter alene (#4282). 9 done-men-åbne issues lukket. **Merget i nat:** #4287 (Hjælp) · #4289 (CI-vagter) · #4290 (kalender-vagter).

> **✅ S3-KALENDEREN LIVE (regenereret 27/8, ejer-GO pr. skridt):** 529 løb / 1.239 etaper, 28/8 → søn 27/9. 0 løbsdage over flere datoer, mountain-nedad 27 % (før 64 %), scorecard 0 regelbrud. Udtagelser wiped m. backup (`backup_4236_*`); 237 form-peaks bevaret m. `target_race_id=null`. Løbsdags-udvikling har eget flag (#4277) og er **off** i S3 — S2-regler, retur i S4.

> **⚠️ Invariant-fund (ikke kalender):** #4184 udvidet (typelister + monument-værn forældet efter ophævelsen), #4146 (24 hold over trupgrænse), **#4282 NY** (2 hold over gældsloft). #4204 (20 min-kørsel) bekræftet.

> **⚠️ TO KATALOG-LOFTER + ÉT ÅBENT VALG (#4272).** D1's brosten nåede 2,6→**4,5 %** (6 % kræver flere brostens-løb; ved 8 reservationer falder D3 under sit gulv). D4's enkeltstart 4,8→**8,1 %** (kun 3 fritstående ITT-løb i Class1/Class2). **Uløst:** D4 trækker 5 af 6 `summit_tour`, hver med 2 garanterede højbjergs-etaper → 16 % højbjerg mod D1's 8 %, og samlet opad 41,9 %. Kræver arketype-**loft** (reservationer er gulve) eller flere flade Class1/Class2-etapeløb. **Spildesign-valg, afventer ejer.** **To regenereringer er forbudt.**

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk ("løbsdag 4-5-6-7, ikke 3-5-7-12") · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere målt i alle 9 kombinationer efter #4217 — gevinsten var væk, hullerne blev betalt) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3:** base_value = model(c 0,811 + type-dæmpning k=100) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0. Type-dæmpningen (#4000) flippes med #3449 tidligst 30/8.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249) og opbakning (#4250) er merged+live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4248 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Ingen aktiv session.**

_Historik i git-log, issue-tråde + docs/audits/._
