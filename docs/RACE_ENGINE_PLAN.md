# Motor- og taktikplan (SSOT)

> **Formål:** ét sted for alt, der er besluttet, lovet, designet eller bygget til løbsmotoren, taktik, roller og motor-tests, men ikke er live endnu. Intet motor- eller taktikpunkt må glemmes igen. **Regler** (hvordan motoren virker i dag) står i [RACE_ENGINE_RULES.md](RACE_ENGINE_RULES.md). **Målinger og gates** står i [MOTOR_TESTPORT.md](MOTOR_TESTPORT.md). Tal og bånd står kun privat (hard rule 17).
>
> **Ejer-princip (26/10):** alt planlagt til motoren skal i spillet hurtigst muligt. Intet udskydes uden specifik aftale med ejeren. Motoren skal snart være langt bedre, end spillerne forventer.
>
> **Vedligehold:** hver session, der rører motor eller taktik, opdaterer denne fil i samme PR. Nye beslutninger føres i loggen nedenfor med dato og kilde. Tracker-issue: [#7260](https://github.com/NicolaiDolmer/CyclingZone/issues/7260). Visuelt designbord: ejerens artifact "Motor-designbord".

## 1. Status (26/10 aften)
- **Live revision:** `s5_profiles_v3` (fra 26/10, #7237). Første seniorløb binder v3 onsdag 28/10 kl. 11:00.
- **I gang (bølge PC1):**
  - #7258 (PR #7259): klassement afgøres ikke af udbrud, fælles fremskrivning, favoritter sjældent i udbrud.
  - #7239 (PR #7265): delt kaptajn i appen.
  - #7266: motortests af spillernes ordrer.
  - #6746: rollebevidste taktiktekster.
- **Merget 26/10:** #7264 (ordrer kan sættes før løbsstart), #7270 (bundle-budget), #7263 (docs-modsigelser).
- **Før onsdag kl. 11 (i merge-køen):** #7259 (ejer-go 26/10: "mellem nu + opfølgning"), #7265 delt kaptajn, #7268 sande tekster, #7271 fjern Breakaway odds, #7273 genafspilning.
- **Tirsdag (taktik-pakken):** #7267 motortests, #7272 dagsform, #7275 fortælling, #7276 luksushjælper, #7277 motorberegnet udbrudschance, #7278 sent soloangreb, ugentlig motor-rapport, Alt ud-kalibrering, spærrede modsatte ordrer.
- **Parkeret:** #7240 (v3.1-tuning alene øgede klassementsvindere fra udbrud; vurderes i #7258).

## 2. Beslutningslog
| Dato | Beslutning | Kilde |
|---|---|---|
| 26/10 | Klassementsvinder fra udbrud: hård gate med to private grænser (sad i udbrud / vandt etape fra udbrud) | #7258 |
| 26/10 | Farlige udbrud holdes på snor, også når rytteren først *ventes* at komme frem senere i løbet. Lukker rivalgrænsen fra #5978-tjeklisten (6/10) | #7258 |
| 26/10 | Én fælles fremskrivning af klassementet ud fra tid, løbsevne og de resterende etaper bruges i blokering, snor, #7160 og testport | #7258, #5978, #6818 |
| 26/10 | S1: U23 og juniorer får fire egne testgrupper (U23 endags/etape, junior endags/etape) | Designbord |
| 26/10 | S2: grænser for ungdom fra et referencesæt af rigtige løb, godkendt af ejeren | Designbord, Codex C4 |
| 26/10 | S3: dagens favorit i endagsløb i morgenudbruddet: hård gate, privat loft | #7258 |
| 26/10 | S4: fremskrevet klassementsfavorit i morgenudbruddet: hård gate, privat loft | #7258 |
| 26/10 | S5: antal ryttere fra samme hold i udbrud følger udbruddets størrelse; andre hold jager hårdere ved overvægt | #6804 P3.3, #6912 |
| 26/10 | Femtrins-indsatsen tændes før onsdag, men samtidig med resten af taktik-pakken og efter grønne motortests | #7266 |
| 26/10 | Form og træthed 2.0 (`condition_model_v2`) er tændt med vilje | ejer i chat |
| 26/10 | S6 dagsform: den bedste vinder som i virkeligheden pr. løbsgruppe; dårlig dag (træthed, form, sygdom, vejr) vises i løbsloggen. Bygges nu | #6649 |
| 26/10 | S7 Breakaway odds: fjern tallet fra den faste tabel nu (A), motorberegnet chance pr. løb til taktik-pakken (B) | #6912 |
| 26/10 | S8 alle løb gemmer motorens fulde input privat, så prod-etaper kan genafspilles | #1857 |
| 26/10 | S9 filmen og etapeteksten siger, hvorfor udbruddet holdt, og hvornår spillerens ordre gjorde forskellen | #6469 |
| 26/10 | S10 luksushjælper = kaptajnens sidste mand; ingen separat løjtnant (delt kaptajn dækker overtagelsen) | #5982, #5981 |
| 26/10 | Taktiklag 1-2: angrebspunkt og følg rival som opgaver i etapeplanen | #5573 |
| 26/10 | Taktiklag 3: sent soloangreb kun for ledere og fri rolle; hjælper på Arbejd kun når kaptajnen er sat | #6368 |
| 26/10 | Taktiklag 4: hvis-så-ordrer som faste skabeloner i etapeplanen | #5574 |
| 26/10 | Taktiklag 5: trøjejagt som både løbsmål og opgave pr. etape | #4822 |
| 26/10 | Taktiklag 6: sidevind og vifter med "hold kaptajnen fremme" i etapeplanen | #2476 |
| 26/10 | Feltet får en tredje jagt-måde: "begræns tiden" | #7258 |
| 26/10 | S13 G17 måler kun styrt, sygdom og træthed mod virkeligheden; flere udgåede i GT | #6938 |
| 26/10 | S14 ugentlig motor-rapport på spillede løb mod gates, med alarm | #2557 |
| 26/10 | #7259 tændes med mellem snor; opfølgning bringer udbrudssejre på bjerg og mellembjerg tilbage | #7258 |
| 25/10 | Arbejd/angrib løses af etapeplanen langs ruten; ordet følger rollen; modsatte valg spærres | spec 2026-10-25-taktik-roller-design.md §11 |
| 25/10 | Delt kaptajn med i v3; højst én pr. hold; hjælp går til kaptajnen først | samme spec §11 |
| 19/10 | Klassementsfavoritter og etapens favoritter er sjældent med i udbrud | #6804 punkt 4, spec 2026-10-17 P3 |

## 3. Taktik-pakken (én tænding før onsdag 28/10 kl. 11, #7266)
1. Ordrer kan sættes før løbsstart (#7264).
2. Femtrins-indsats (`race_day_intention_enabled`): Grupetto, Spar, Normal, Arbejd/Følg angrebene, Alt ud.
3. Etapeplanen langs ruten (`stage_plan_v1`, #7003/#7204).
4. Delt kaptajn i appen og Race Hub uden stille kaptajn (#7239).
5. Sande tekster: rollebevidst ord i den klassiske fane, ét afsnit i Hjælp (#6746, #6321).

**Gate før tænding:** motortests (#7266) viser, at hver ordre virker i den forventede retning og kan mærkes, hvor den burde, pr. løbsgruppe. Plus en test fra databasen hele vejen gennem motoren.

## 4. Backlog: motor (fra gennemgangen 26/10, #7260)
| Punkt | Kilde | Status |
|---|---|---|
| Hold-overvægt i udbrud (S5) | spec 17/10 P3.3/P3.4, #6912 | Besluttet; bygges efter #7259 |
| Feltet kan "begrænse tiden" i stedet for alt eller intet | Discord 25/10, #7258 | Besluttet; bygges efter #7259 |
| Dagsform / "dårlig dag" (forudsigelighed) | #6649 | Bygges (PR #7272) |
| Gem hele motorens input privat, så prod-etaper kan genafspilles | #1857 | Klar (PR #7273) |
| Fortælling: hvorfor holdt udbruddet (`chase_faded`, årsag pr. sejr) | #6469 | Bygges (PR #7275) |
| Kuperet enkeltstart: tidshul skaleret efter feltet | spec 21/10 P8 (ejer A) | Ikke bygget |
| Gruppetto-ordre (sparer kræfter pr. etapetype) | #6940 | Motor bygget, følger taktik-pakken |
| Sprintkaptajn slutter efter egen togfører | #6552 | Åben fejl |
| Enkeltstart vægter for lidt mod bjerg i GT | #6595, PR #7164 | PR åben (konflikt) |
| Dronningeetaper for spredte i division 1 | #7236 | Åben |
| Holdtidskørsel: regler siger "scores ikke", benchen kører TTT | CALENDAR_RULES §969, #3463 | Skal verificeres |
| Sent soloangreb kun for ledere og fri rolle | #6368 | Besluttet; bygges (PR #7278) |
| Assistenten giver aldrig jæger/fri rolle | raceAutopick.js | Ikke bygget |
| Luksushjælper = sidste mand | #5982 | Bygges (PR #7276) |
| Angrebspunkt, følg rival, hvis-så, trøjejagt | #5573, #5574, #4822 | Besluttet; bygges efter #7265 |
| Sidevind og vifter | #2476 | Besluttet; bygges efter etapeplan-sporene |
| Drift-vagt: ugentlig rapport på spillede løb mod grænserne | #2557 | Bygges |
| Testportens domme FAIL i begge revisioner | #6908 | Åben |
| G17 udgåede: kun styrt/sygdom/træthed; flere udgåede i GT | #6938 | Besluttet; bygges efter #7259 |
| "Breakaway odds" fra fast tabel → motorberegnet chance | #6912 | A klar (PR #7271), B bygges (PR #7277) |

## 5. Backlog: taktik og roller (fra gennemgangen 26/10)
| Punkt | Kilde | Status |
|---|---|---|
| Ordre-kolonnen skjult før løbsstart | #7264 | Merget 26/10 |
| AI har grupetto/protect, mennesker kun 3 trin | RULES §2 M14 | Løses af taktik-pakken |
| Patch note 7.383 lover Alt ud | patchNotes.js | Bliver sand ved taktik-pakken |
| Delt kaptajn ikke målt på hold med 7-8 ryttere; ingen ende-til-ende-test | PR #7205 | #7266 |
| Testporten måler ikke menneskers ordrer | MOTOR_TESTPORT, s5MotorBench | #7266 |
| `segmentLoop.teamPlay`-tests uden v3-tilfælde | testfil | #7266 |
| Modsatte ordrer kan vælges sammen | spec §3 | Løses af etapeplanen |
| Hjælp modsiger sig selv om indsatstrin | help.json | #6746 |
| Træthed vises ikke i taktikvalget | #3455 | Ikke bygget |
| Assistent-regler "udtag aldrig X", gemte trupper | #6182 | Lovet (#6947), ikke bygget |
| Sprinttog-UX og Hjælp | #6125 | Lovet (#6947) |
| Tactics-tabellen på PC (slider, vandret scroll i GT) | #5637, #6177 | Åben |

## 6. Tests og spejling mod virkeligheden
- **Løbsgrupper:** korte etapeløb, GT, endagsløb, monumenter (#7243) + U23 endags/etape og junior endags/etape (S1).
- **Gates:** G16-G19, G2F, gcFromBreakaway, stageFavouriteInBreakaway, gcFavouriteInBreakaway (alle med private grænser).
- **Referencesæt:** rigtige løb pr. gruppe (Codex C4, privat `private-handoffs/youth-reference-2610/`).
- **Ordre-tests:** #7266 (tvilling uden ordren + ende-til-ende).
- **Prod-verifikation:** første v3-løb onsdag 11:05 (revision bundet, film, resultater).

## 7. Modsigelser, der skal rettes
Se [#7262](https://github.com/NicolaiDolmer/CyclingZone/issues/7262) (docs) og kode-kommentarer med "SLUKKET" i `tuning.ts` og `breakawayInterest7160.ts`, når #7258 er merget. `ordersGcSurface.ts`-headeren siger stadig "NULL = legacy".
