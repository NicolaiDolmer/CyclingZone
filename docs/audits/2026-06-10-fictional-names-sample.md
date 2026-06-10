# Audit: Fiktive rytter-navne — sample + metode (#669)

**Dato:** 2026-06-10 · **Status:** DRY-RUN — intet er skrevet til databasen.
**Formål:** Ejer-review af navnestil FØR prod-apply. Migrations-planen:
[`scripts/migrations-manual/2026-06-10-669-fictional-rider-names-rename-PLAN.sql`](../../scripts/migrations-manual/2026-06-10-669-fictional-rider-names-rename-PLAN.sql).

> IP-kontekst: ingen gamle PCM-navne optræder i dette dokument (eller i nogen
> committet fil). Kun `pcm_id` + nationalitet + det NYE fiktive navn.

## Metode

- **Pipeline (lokalt, ingen DB):** `python scripts/extract-pcm-rider-input.py`
  (PCM-xlsx → TSV) → `node scripts/generate-fictional-rider-names.mjs`
  (TSV → JSON-mapping + staging-SQL + dette sample).
- **Deterministisk:** seed **669** (mulberry32, samme PRNG som
  launch-population-generatoren `backend/lib/fictionalRiderGenerator.js`).
  Samme seed + samme input → bit-identisk output (verificeret ved dobbelt-kørsel
  2026-06-10). Input-SHA256: `cb246870616b12350c6391517a50463590ef48f1e6ba59e550312ccadf34a635`.
- **Nationalitet bevares 1:1** — kun `firstname`/`lastname` ændres. Navne
  trækkes fra nationalitets-clusters: basen `backend/lib/fictionalRiderNames.js`
  (ejer-godkendt hybrid-model 2026-05-31) + udvidelser i
  `scripts/lib/fictional-name-pools-extended.mjs` (basen røres ikke — #1135's
  deterministiske output må ikke skifte).
- **Unikheds-garanti:** hvert nyt fulde navn foldes med `foldNameNordic`
  (samme fold som PCM-resultat-importens navne-matching) og tjekkes mod
  (a) ALLE 8.699 nuværende navne i datagrundlaget (= kendte virkelige proffer),
  (b) alle andre genererede navne, og (c) evt. `--extra-names` (fx de 25
  allerede-indsatte fiktive #1135-ryttere ved apply-time). Generatoren fail'er
  hårdt ved kollision — et succesfuldt run ER kollisionstjekket. Ved pool-pres
  bruges deterministisk dobbelt-efternavn (rapporteret, aldrig stille) —
  **0 tilfælde** i denne kørsel.
- **Ingen ikoniske pro-efternavne** i poolerne (Vingegaard, Pogačar, …);
  meget almindelige civile efternavne (García, Pedersen, …) er tilladt, da
  fulde-navne-kollisionstjekket fanger eksakte sammenfald.

## Kørsels-statistik (dry-run 2026-06-10, committet PCM-dump)

| Nøgletal | Værdi |
|---|---|
| Ryttere omdøbt i mapping | 8.699 |
| Nationaliteter | 138 |
| Kollisions-korpus (foldede navne) | 8.693 |
| Compound-navne (overflow) | 0 |
| Nationaliteter uden dedikeret pool | 0 |
| Tests (`node --test scripts/lib/fictional-rename-generator.test.mjs`) | 8/8 pass |

**Live-DB-delta (verificeret read-only 2026-06-10):** prod har **8.969**
PCM-ryttere (270 flere end dumpen — senere imports) + 25 ikke-PCM-ryttere.
Derfor SKAL det endelige input ekstraheres fra live-DB umiddelbart før apply
(planens TRIN 0) — ellers beholder op til ~270 ryttere rigtige PCM-navne.
Sample her er stilmæssigt repræsentativt; den endelige mapping regenereres
deterministisk fra live-input med samme seed.

## Sample — 100 eksempler (repræsentativt: ≥2 pr. cluster, resten proportionalt)

| pcm_id | Nationalitet | Cluster | Nyt navn |
|---|---|---|---|
| 5245 | AL | albanian | Driton Krasniqi |
| 15715 | XK | albanian | Arben Rexhepi |
| 659 | AU | anglo | Alfie Whitfield |
| 1 | CA | anglo | Joel Dawson |
| 2386 | CA | anglo | Sean Ward |
| 12311 | CA | anglo | Henry Parker |
| 301 | GB | anglo | Ryan Cooper |
| 797 | GB | anglo | Patrick Cook |
| 2523 | NZ | anglo | Aaron Ward |
| 3026 | US | anglo | Charlie Hughes |
| 6456 | AM | armenian | Vahan Harutyunyan |
| 9871 | AM | armenian | Vahan Vardanyan |
| 3044 | KZ | centralAsian | Timur Mirzaev |
| 4482 | KZ | centralAsian | Ulugbek Kasymov |
| 11863 | UZ | centralAsian | Rustam Mamyrov |
| 4506 | CN | chinese | Kai Li |
| 4508 | CN | chinese | Ping Jiang |
| 10963 | CN | chinese | Rui Sun |
| 3297 | TW | chinese | Yu Guo |
| 1381 | BE | dutchFlemish | Siebe Van den Berg |
| 2065 | BE | dutchFlemish | Teun Smit |
| 2318 | BE | dutchFlemish | Wout Claes |
| 16 | NL | dutchFlemish | Jasper Hermans |
| 754 | NL | dutchFlemish | Koen Kuipers |
| 1936 | NL | dutchFlemish | Emiel Van Damme |
| 10045 | NL | dutchFlemish | Gijs Smit |
| 3059 | ER | eastAfrican | Henok Cissé |
| 11610 | ER | eastAfrican | Henok Solomon |
| 4473 | PH | filipino | Dexter Salazar |
| 4475 | PH | filipino | Reynaldo Aguilar |
| 11566 | PH | filipino | Alvin Salazar |
| 4 | FR | french | Thibault Charpentier |
| 1380 | FR | french | Maxime Roussel |
| 2542 | FR | french | Olivier Bouvier |
| 3022 | FR | french | Étienne Girard |
| 11069 | FR | french | Fabien Mercier |
| 4347 | GE | georgian | Irakli Maisuradze |
| 13315 | GE | georgian | Davit Kapanadze |
| 2441 | AT | german | Marvin Zimmermann |
| 10044 | AT | german | Simon Keller |
| 2845 | CH | german | Konstantin Kaiser |
| 1269 | DE | german | Andreas Pohl |
| 1951 | DE | german | Nico Albrecht |
| 12561 | CY | greek | Panagiotis Kotsis |
| 4160 | GR | greek | Ilias Christodoulou |
| 5357 | ID | indonesianMalay | Amir Setiawan |
| 11001 | ID | indonesianMalay | Budi Yusof |
| 4166 | MY | indonesianMalay | Bayu Pratama |
| 1033 | IT | italian | Riccardo Greco |
| 1959 | IT | italian | Stefano Parisi |
| 2683 | IT | italian | Michele Valli |
| 2799 | IT | italian | Simone Battaglia |
| 11259 | IT | italian | Alberto Bianchi |
| 1820 | JP | japanese | Hiroto Inoue |
| 3580 | JP | japanese | Yuki Ikeda |
| 10265 | JP | japanese | Daiki Ikeda |
| 4495 | KR | korean | Hajun Jung |
| 4500 | KR | korean | Hyun Jang |
| 10851 | KR | korean | Woojin Kim |
| 3068 | DZ | maghreb | Riad Lahlou |
| 4725 | DZ | maghreb | Jamal Berrada |
| 3330 | IR | maghreb | Ismail Karimi |
| 11470 | MA | maghreb | Mehdi Hamdi |
| 4414 | MN | mongolian | Enkhbat Ganbaatar |
| 11715 | MN | mongolian | Tulga Altangerel |
| 2123 | DK | nordic | Oskar Henriksen |
| 2505 | DK | nordic | Jeppe Korhonen |
| 11386 | DK | nordic | Elias Winther |
| 2800 | NO | nordic | Magnus Hedlund |
| 5060 | SE | nordic | Oskar Sørensen |
| 4620 | BR | portuguese | Vasco Neves |
| 1975 | PT | portuguese | Gustavo Ribeiro |
| 2893 | PT | portuguese | Rafael Martins |
| 11504 | PT | portuguese | Duarte Coelho |
| 3088 | CZ | slavic | Michał Hájek |
| 178 | EE | slavic | Piotr Volkov |
| 1981 | PL | slavic | Rok Walczak |
| 2804 | RU | slavic | Krzysztof Krajnc |
| 1199 | SI | slavic | Krzysztof Shevchuk |
| 11488 | SI | slavic | Jan Hribar |
| 5128 | IN | southAsian | Aditya Mehta |
| 10453 | LK | southAsian | Imran Hussain |
| 3056 | AR | spanish | Fernando Zapata |
| 2046 | CO | spanish | Miguel Cano |
| 3373 | CO | spanish | Pablo Soto |
| 11088 | CO | spanish | Hugo Flores |
| 4466 | EC | spanish | Rodrigo Salazar |
| 1978 | ES | spanish | Vicente Quintero |
| 1986 | ES | spanish | Luis Campos |
| 1991 | ES | spanish | Felipe Campos |
| 4425 | MX | spanish | Hernán Valdés |
| 3401 | VE | spanish | Fernando Aguirre |
| 12038 | KH | thai | Kittisak Chanthavong |
| 4594 | TH | thai | Kraisorn Srisawat |
| 4595 | TH | thai | Decha Chanthavong |
| 3513 | TR | turkish | Kaan Kılıç |
| 3515 | TR | turkish | Tolga Aydın |
| 14062 | TR | turkish | Kaan Aksoy |
| 7892 | VN | vietnamese | Hieu Dang |
| 10602 | VN | vietnamese | Hieu Tran |

**Kendt stil-trade-off til review:** clusters er pan-regionale pools (basens
design), så fx `nordic` blander dansk/norsk/svensk/finsk ("Jeppe Korhonen",
"Oskar Sørensen" for SE) og `slavic` blander polsk/tjekkisk/slovensk/ukrainsk
("Krzysztof Krajnc"). Nationalitets-FELTET er altid korrekt — det er kun
navne-smagen der er regional frem for landespecifik. Strammere
landespecifikke pools er muligt men kræver større pools (kapacitet).

## Fordeling — nationalitet (top 24 af 138)

| ISO | Ryttere | | ISO | Ryttere | | ISO | Ryttere |
|---|---|---|---|---|---|---|---|
| FR | 536 | | US | 231 | | AR | 130 |
| IT | 530 | | DE | 221 | | CZ | 119 |
| BE | 499 | | DK | 219 | | KR | 115 |
| ES | 373 | | AU | 190 | | NZ | 113 |
| NL | 361 | | JP | 172 | | CA | 107 |
| CO | 296 | | NO | 150 | | TR | 106 |
| CN | 274 | | PT | 139 | | CH | 103 |
| GB | 268 | | PL | 132 | | AT | 98 |

Øvrige 113 nationaliteter: 3.217 ryttere i alt (90 RU + 3.127 under RU-niveau).
Fuld fordeling: `stats.byNationality` i generator-outputtet (reproducérbart
fra seed 669).

## Cluster-utilization (alle ≤60%-grænsen, håndhævet af test)

| Cluster | Ryttere | Kapacitet | Udnyttelse |
|---|---|---|---|
| thai | 83 | 196 | 42.3% |
| centralAsian | 119 | 288 | 41.3% |
| anglo | 1068 | 2856 | 37.4% |
| indonesianMalay | 134 | 360 | 37.2% |
| japanese | 172 | 504 | 34.1% |
| albanian | 34 | 100 | 34% |
| spanish | 1431 | 4224 | 33.9% |
| korean | 115 | 360 | 31.9% |
| turkish | 130 | 414 | 31.4% |
| greek | 60 | 192 | 31.3% |
| filipino | 96 | 320 | 30% |
| dutchFlemish | 866 | 2982 | 29% |
| mongolian | 27 | 100 | 27% |
| vietnamese | 32 | 120 | 26.7% |
| portuguese | 229 | 864 | 26.5% |
| french | 559 | 2240 | 25% |
| chinese | 361 | 1496 | 24.1% |
| italian | 542 | 2301 | 23.6% |
| southAsian | 49 | 210 | 23.3% |
| german | 457 | 2016 | 22.7% |
| maghreb | 419 | 1872 | 22.4% |
| slavic | 868 | 4416 | 19.7% |
| nordic | 486 | 2546 | 19.1% |
| georgian | 12 | 80 | 15% |
| eastAfrican | 346 | 2400 | 14.4% |
| armenian | 4 | 64 | 6.3% |

## Kulturelle approksimationer (eksplicitte, 20)

Nationaliteter uden egen pool mapper til nærmeste kulturelt-plausible cluster
(`CLUSTER_APPROXIMATIONS` i `scripts/lib/fictional-name-pools-extended.mjs`):

| ISO | Approksimation |
|---|---|
| AZ | Aserbajdsjan → turkish (tyrkisk-sproglig navnetradition) |
| CY | Cypern → greek (græsk-cypriotisk flertal) |
| GU | Guam → filipino (chamorro-navne er spansk/filippinsk-påvirkede) |
| LA | Laos → thai (nærmeste sydøstasiatiske pool) |
| KH | Cambodja → thai (nærmeste sydøstasiatiske pool; khmer-navne afviger) |
| MN | Mongoliet → mongolian (egen mini-pool) |
| LK | Sri Lanka → southAsian (blandet indisk/singalesisk pool) |
| PK | Pakistan → southAsian (muslimske navne indgår i poolen) |
| MU | Mauritius → french (fransk-kreolske efternavne) |
| BZ | Belize → spanish (spansktalende flertal) |
| AD | Andorra → spanish (catalansk navnetradition) |
| CW | Curaçao → dutchFlemish (hollandsk Caribien) |
| MT | Malta → italian (italiensk-påvirkede efternavne) |
| TL | Timor-Leste → portuguese (portugisisk kolonihistorie) |
| GA | Gabon → eastAfrican (pan-subsaharisk pool, frankofone navne) |
| LS | Lesotho → eastAfrican (pan-subsaharisk pool) |
| IS | Island → nordic (basens valg; ægte islandske patronymer findes ikke i poolen) |
| BE | Belgien → dutchFlemish (basens valg; vallonske ryttere får flamske navne) |
| RO | Rumænien/Moldova → slavic (pan-østeuropæisk pool inkl. rumænske efternavne) |
| HU | Ungarn → slavic (pan-østeuropæisk pool inkl. ungarske efternavne) |

Udvidelsen overrider desuden basens mapping for XK (Kosovo) slavic→albanian
og GE (Georgien) slavic→georgian — begge var kulturelt forkerte i basen.

## Reversibilitet

- **Backup før rename:** originale navne gemmes i
  `riders_pcm_name_backup_669` (RLS-låst uden policies = deny-all for
  anon/authenticated, så PCM-navne aldrig eksponeres via PostgREST).
- **Fuld rollback-SQL** står i planens ROLLBACK-sektion — genskaber alle
  navne 1:1 fra backup, kan køres når som helst efter commit.
- **Reproducérbarhed:** mapping kan altid regenereres bit-identisk fra
  (seed 669 + input-TSV); seed + input-SHA256 er indlejret i alle output-filer.

## Hvorfor `scripts/out/` er gitignoret

Pipelinens input-TSV (`669-pcm-rider-input.tsv`) og apply-time-ekstraktionerne
indeholder **rigtige PCM-navne** og må aldrig committes (hele pointen med #669).
Output-filerne (mapping/staging/sample) er reproducérbare fra seed + input, så
intet i `scripts/out/` er source of truth. Dette dokument er det committede,
PCM-navne-frie review-artifact.
