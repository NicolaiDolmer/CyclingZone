# #6092: GC-kaptajner på kuperede etaper + udbrud på bjerg (orders_gc_v2)

Rapporten er kvalitativ, fordi repoet er offentligt. Tal, billeder og harness-output ligger privat i `balance-internals/6092/` (gitignoreret): `RESULTS.md`, `run-compare.mjs`, `agg.mjs`, `diag.mjs`, `snap.mjs`, `identity.mjs`, `calibrate.mjs`, `cmp.mjs`, `render.mjs`, `png/foer-efter-*.png` og JSON-filerne.

Målt på samme måde som ejerens billede 2/10: de rigtige, ukørte løb (Giro della Penisola, Vuelta a Sierra Nevada, Giro delle Alpi Orientali) med startlister, roller, holdordrer og evner, gennem `dryRunUpcomingStage.mjs`, 20 seeds pr. etape. "Før" er de tre PR'er samlet (#6084 + #6088 + #6089), som branchen bygger ovenpå.

## Del 1: kuperede etaper

**Rod-årsag.** Kaptajnerne kører med favoritterne. Instrumenteringen pr. segment viste at deres tab til favoritgruppen er lille (sekunder), og at næsten hele tidstabet til etapevinderen er morgenudbruddets forspring over favoritterne. Under `orders_gc_v1` får et svagt udbrud (jægere og frie roller) ekstra lad-gå-plads for at kompensere for at der ikke længere sidder kaptajner i det. På kuperet terræn holder udbruddet så ofte hjem med et forspring over fem minutter, og så tæller hver eneste kaptajn som "over 5 min", selv om de sad med favoritterne. #6088's styrke-dæmpning rammer ikke, fordi udbruddet netop er svagt. Selektionen på korte stigninger bidrog kun lidt, og kun på én etape.

**Mekanikker slået til og fra** (harness-kopi via miljøvariabel, fjernet igen før commit): udbrud med GC-ryttere, lad-gå-loftet, jagtens pris før og i finalen, tempo-neutralisering på stigninger, blødere selektion. Kun loftet flyttede tidstabet afgørende; de andre greb flyttede det lidt eller slet ikke.

**Rettelse (kun `orders_gc_v2`).** Kuperede etaper er nu med i v2-pakken fra #6084 (blødere selektion før finalestigningen, tempo-neutralisering, kontrolleret jagt), og kuperet terræn har sit eget, lavere lad-gå-loft. Knapperne kan nu afvige pr. profil (`MOUNTAIN_SELECTION_V2_TUNING.byProfile`, læst via `mountainSelectionKnobsFor`).

**Resultat i de rigtige felter.** GC-kaptajnernes tidstab på kuperede etaper ligger nu klart under den gamle motor, og andelen over 5 minutter er under halvdelen af den gamle motors. Alle fire kuperede etaper har nu flertallet af kaptajnerne under 5 minutter. Udbruddet ender stadig ofte foran favoritterne, men vinder sjældnere end før; det er afvejningen.

## Del 2: bjerg og højfjeld

**Rettelse (kun `orders_gc_v2`).** På bjerg jager favoritternes hold i finalen uden den ekstra skarphed. På højfjeld er jagten desuden roligere før finalestigningen.

**Resultat.** Udbrud foran favoritterne stiger samlet, og mest på højfjeld, uden at kaptajnernes tidstab stiger (det ligger stadig under den gamle motor). Ejer-målet på ca. 45 % samlet er **ikke nået**; tallet ligger nogle point under.

**Hvorfor ikke.** Udfaldet er tvedelt pr. etape: på nogle etaper holder udbruddet næsten altid, på andre næsten aldrig. Etaperne på ca. 0 % har to årsager, som ingen v2-knap flytter:

1. En kaptajn eller stærk rytter har "Forsøg udbrud". Udbruddet er så farligt for klassementet (#6089 og GC-reaktionen fra #5978), får lidt plads og hentes før finalen. Det er bevidst adfærd i `orders_gc_v1`-pakken.
2. Feltet har næsten ingen udbrudsryttere (få ordrer og jægere), så udbruddet er på ganske få ryttere (eller dannes slet ikke) og hentes på sidste stigning.

At nå 45 % kræver et ejer-valg: enten skal GC-reaktionen være mildere på højfjeld, eller udbrudsdannelsen skal give større udbrud i felter med få jægere. Begge dele ligger uden for denne PR.

## Lås

- Legacy og `orders_gc_v1` er byte-identiske: alle fulde motor-output på alle etaper i de tre løb (begge revisioner, flere seeds) har samme hash før og efter.
- Rolleregler: 0 ryttere i udbrud mod deres rolle på alle etaper.
- Rullende og flade etaper er uændrede.

## Tests og anker

- `mountainSelection.test.ts`: fasen gælder nu også kuperet; ny kontrakt for profil-knapperne (fælles værdier + profilens afvigelser, loftet skaleres aldrig op, kuperet har lavere loft end bjerg).
- `backend/scripts/dev/hillyCaptainTimeLoss6092.test.mjs`: anker på det anonymiserede rigtige felt fra #6088. Kuperet under `orders_gc_v2` skal ligge på legacy-niveau eller bedre og under `orders_gc_v1`, bjerg må ikke blive dårligere end `orders_gc_v1`, 0 rollebrud. Testen fejler uden rettelsen.

## Replay og kalibreringsharness

- replay5957 (`--rules=orders_gc_v2`): specialist-korrelationen er bedre på kuperet og uændret på alle andre etapetyper.
- Kalibreringsharnessen (proxy-etaper, låst population, AI- og stress-scenarie, 10 seeds, v2 med klassement): top-10's tidstab på kuperet falder markant. Udbruddet vinder lidt sjældnere på kuperet og lidt oftere på bjerg og højfjeld. På bjerg og højfjeld stiger top-10's tidstab en smule i proxy-felterne, fordi udbruddet oftere holder hjem. Samlet er udbrudssejre og tidstab på niveau med før.

## Hvad målingen ikke dækker

- Tre løb og 20 seeds pr. etape; kuperet er kun fire etaper.
- `dryRunUpcomingStage.mjs` kører hver etape alene uden klassement. Ankeret kører også en kæde med klassement på ét løb.
- Replay-felterne bruger rytternes nuværende evner, og replay sender intet klassement.
- Lanen #6073 arbejder i samme filer på rullende etaper; rullende er uændret her.
