# En gate med en fast graense paa en suite der vokser (#5309)

**Symptom:** `frontend-smoke` roed paa #5308 to gange i traek med praecis samme tal — mobile-webkit 12 min 3 s mod et budget paa 12 min. PR'ens egne tests bestod; alle tre shards sluttede `success`.

**Foerste hypotese (forkert):** PR'en havde indfoert en tidsregression. Maalt: den tilfoejede 7 tests = +38 s oven paa en base der allerede laa paa 685 s median. 5 % af problemet.

**Rodaarsag, tre lag:**

1. **Gaten var kalibreret paa en stillestaaende suite.** #4647 satte 12 min 2/9 ved 207 tests pr. projekt. 16/9 var tallet 335 (+62 % paa 14 dage). Vaeksten er oenskeet adfaerd — hver bugfix faar sin regressionstest — saa en fast graense vil altid til sidst faelde dom over den tilfaeldige PR der krydser stregen i stedet for over vaeksten.
2. **Gaten havde ingen hukommelse.** Scriptet laeser kun den aktuelle koersels artifact (7 dages levetid). Den kan sammenligne med en konstant, aldrig med i gaar — derfor kunne 62 % vaekst passere ubemaerket, mens det sidste sekund blev en blokering.
3. **Graensen blev koert paa 95 % udnyttelse paa et stoejende substrat.** De SAMME 323 tests har maalt fra 514 s til 961 s paa GitHubs delte runnere (33 koersler 15.-16/9, ±30 %). Taet paa stregen er en absolut graense et moentkast. Beviset laa allerede der: gaten var roed 15/9 paa #5284 med uaendret testantal (16 min 1 s).

**Blindgyder der blev lukket med maaling, ikke med mening:**

- *"Find den langsomme test."* Lokal profil af begge motorer, samme 328 tests: webkit 1.830 s summeret mod chromium 935 s. Forholdet er median 1,98x **jaevnt over 94 spec-filer**; de fem vaerste staar for 8 % af merforbruget. Der er intet hot spot — WebKit er bare ~2x langsommere pr. operation.
- *"Flyt webkit til nattekoersel."* Clarity 14.-16/9: 110 af 435 sessioner (25 %) koerer WebKit-motoren. At holde op med at teste den paa PR-niveau ville vaere en produktfejl forklaedt som CI-optimering. Daekning er ikke en knap man skruer ned paa for at naa et tidsmaal.

**Rettelsen:** shard-planen blev data (`frontend/tests/e2e/shard-plan.json`), loftet fik 2,4x luft, og vaekst-alarmen flyttede til den natlige main-koersel med det praecise nye lanetal. PR-gaten doemmer kun det den kan vide noget om: om testene er roede, og om EEN lane er loebsk.

**Reglen der kom ud af det:**

> En gate med en fast graense antager en stillestaaende maaling. Vokser det den maaler ved politik, skal graensen enten vaere afledt eller have luft nok til at stoejen ikke naar den — og vaeksten skal meldes paa main, aldrig paa den PR der tilfaeldigvis krydser stregen.

Sekundaert: **et acceptkriterium er ikke en gate.** #4647 skrev "under 10 min" og satte gaten til 12. Issuet er lukket som done, mens kriteriet ikke var sandt. Naar et issue lukkes paa et tal, skal det staa hvad der haandhaever tallet bagefter.

Refs: #4647, #4711, #5308, #5309.
