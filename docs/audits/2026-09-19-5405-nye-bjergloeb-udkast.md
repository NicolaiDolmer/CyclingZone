# Udkast: nye bjergrige etapeløb i kataloget (#5405)

**19/9 2026. READ-ONLY undersøgelse.** Ingen `--apply`, ingen skrivning til databasen,
ingen ændring af kataloget, ingen migration. Kandidat-løbene findes ikke i `race_pool`
og er lagt i en kopi af kataloget i hukommelsen.

Denne fil er den **anonymiserede** metode og dom. Tallene pr. kombination ligger i
`balance-internals/2026-09-19-s4-kalender-kvalitet/nye-bjergloeb.md` (gitignoreret).
Forslagenes navne og deres virkelige forbilleder står her, fordi de er udkast til
spillervendt indhold og skal kunne diskuteres i et issue.

Forgænger: [`2026-09-19-5405-bjergdage-bytte.md`](2026-09-19-5405-bjergdage-bytte.md).

---

## Spørgsmålet

Ejeren spurgte 19/9: kan vi lave en permanent og langsigtet forbedring, så de lavere
divisioner får flere afgørende bjergdage? Og: tag udgangspunkt i virkeligheden.

Forgængeren viste at problemet ikke kan løses ved at bytte løb rundt mellem
divisionerne. Spørgsmålet her er om **nye løb i kataloget** løser det.

## Metode

`backend/scripts/dev/nyeBjergloeb5405.mjs` kører 21 tørkørsler i én kørsel. Hver
tørkørsel kalder `materializeTierCalendars({ dryRun: true })` præcis som
`buildSeasonCalendar.js`' tørkørsel gør, og kører derefter hele scorecardet (samme kode
som CI), uden `--uniform-tilt` (ejer-beslutning 3/9).

Kandidat-løbene lægges ind via `extraCatalogRows` — #3295's eksisterende dry-run-sti,
som selv kaster en fejl hvis nogen prøver at bruge den uden `dryRun`. To ting varieres:
hvilke kandidat-løb der ligger i katalog-kopien, og `archetypeReservations`. Den frosne
produktions-tabel muteres aldrig; den klones.

Baseline i kørslen er bit-identisk med formiddagens rapport. Harnessen er dermed
verificeret mod et kendt resultat, ikke bare kørt.

## Hvordan et løb i kataloget er defineret

Én række i `race_pool`: navn, klasse, type, etapeantal, dato-tekst, land og
terræn-arketype. **Der er ingen etaper i kataloget.** Etapeprofilerne genereres hver
gang en kalender bygges, ud fra arketypen (garanterede etapetyper + filler-vægte) og en
seed-nøgle afledt af løbets `external_id`, som igen er afledt af navnet. Samme navn
giver samme parcours hver gang. **Et nyt løb kræver derfor ingen håndskrevne
etapeprofiler** — kun en katalog-række.

Klasse og etapeantal er bundet sammen af et bånd (#3328), så et nyt løb ikke kan være
længere end sin klasse tillader.

**Navne-konventionen** er ikke skrevet i et regelsæt, men den er entydig i seed-filen:
kataloget er et spejl af den virkelige UCI-kalender, hvor hvert løb har fået et
**fiktivt navn på sit eget sprog**, afledt af regionen og ikke af arrangørens
varemærke. **Der er en juridisk grund** — arrangørerne ejer løbsnavnene som varemærker,
og spillet bruger derfor generiske navne, samme spor som de fiktive ryttere (#669). Et
nyt løb skal have et opdigtet navn med en virkelig geografi bag.

Løb er tidligere tilføjet via seed-CSV'en plus idempotente SQL-migrationer
(`ON CONFLICT (external_id) DO NOTHING`).

## Fund 1: katalogets øverste klasser er allerede fulde

Katalogets ProSeries-bånd og WorldTour-bånd spejler den virkelige kalender et-til-et.
**Der findes ikke et ubrugt, bjergrigt løb på det niveau tilbage at tage udgangspunkt
i.** Class1-båndet er derimod klart underforsynet mod virkeligheden.

Det har en konsekvens ejeren skal kende: Division 2's vindue består udelukkende af
klasser der allerede er fulde. Nye løb i den klasse Division 3 og 4 deler, kan altså
ikke nå Division 2 — og målingen viste at de i praksis alle sammen lander i Division 4.

## Fund 2: kataloget alene rækker ikke

Nye løb i den klasse Division 3 og 4 deler, lader Division 2 og 3 stå **præcis
uændret** — ikke én etape flytter — og gør samtidig Division 4 for bjergrig.

Nye løb i den klasse Division 2 og 3 deler, rykker Division 3 et stykke, men ikke i
mål, og gør intet for Division 2.

Grunden er mekanisk: etape-kvoten pr. division er eksakt. En division tager i store
træk det antal bjergløb dens reservation siger, og fylder resten op efter prestige.

**Det nuancerer forgængerens diagnose.** Forsyningen er for lille, men den er ikke
alene det der binder — **reservationen binder også**. Katalog-udvidelse alene rækker
ikke. Reservations-ændring alene virker, men koster Division 3 dens enkeltstarter.
**De to sammen er det der løser det.**

## Fund 3: kombinationen bringer alle fire divisioner i mål

Det mindste sæt der virker er **tre nye bjergrige etapeløb i den klasse Division 2 og 3
deler**, kombineret med at Division 2 og Division 3 hver især reserverer ét bjergløb
mere, og at Division 3 samtidig reserverer ét løb af den type der garanterer en
enkeltstart.

Gate-status med den kombination:

- Alle fire divisioner er inden for **både** bjerg-målet og enkeltstarts-målet. Det er
  første gang i hele dette spor at det sker.
- Antallet af afvigelser på de uniforme mål går fra to til **nul**.
- Sæsons-finale-afvigelserne er uændrede.
- Blokerende og apply-blokerende fund: **nul, før og efter.**
- Etape-kvoterne rammes præcist, som før.
- Ingen rød markering flytter fra grøn nogen steder.

**Hvorfor tre løb og ikke to.** Med kun to nye løb kommer alle fire divisioner i mål på
bjerg, men Division 3 falder til gengæld ud af enkeltstarts-båndet — nøjagtig samme pris
som i forgængerens løsning. Det tredje løb betaler ikke for en bjergdag; det betaler for
enkeltstarten.

At reservere endnu et bjergløb til Division 2 får den til at skyde over målet i den
anden retning. Nye løb i Division 3/4's fælles klasse skubber Division 4 ud af sit bånd
uden at hjælpe Division 2 eller 3.

## Forslagene

Alle fire har et virkeligt forbillede på 2.1-niveau med rigtige bjergfinaler.

| # | Virkeligt forbillede | Foreslået katalog-navn | Land | Arketype | Etaper | Bjergfinaler | Enkeltstart |
|--:|---|---|---|---|--:|--:|---|
| 1 | O Gran Camiño (2.1, april) | **Volta Galega** | Spanien, Galicien | `summit_tour` | 5 | 2 | Ja |
| 2 | Österreich-Rundfahrt (2.1, juli) | **Rundfahrt der Hohen Tauern** | Østrig | `summit_tour` | 5 | 2 | Nej |
| 3 | Volta a Portugal (2.1, august) | **Volta Portuguesa** | Portugal | `summit_tour` | 5 | 2 | Ja |
| 4 | Tour Colombia (2.1, februar) | **Vuelta a los Andes** | Colombia | `summit_tour` | 5 | 2 | Ja |

Løb 1, 2 og 3 er dem der virker. Løb 4 er kun målt i den lave klasse, hvor det kun
hjælper Division 4, og er taget med som kontrol.

Punkt 1-3 er slået op på nettet 19/9. **Punkt 4 (Tour Colombia) er husket, ikke slået
op** — behandl detaljerne som omtrentlige.

**Den ærlige note om klassen:** løb 1, 2 og 3 skal ligge i den klasse Division 2 og 3
deler for at virke, men er en klasse lavere i virkeligheden. Det er en oprykning over
deres virkelige UCI-klasse. Den er til at forsvare — O Gran Camiño har vokset sig stort
med WorldTour-hold i feltet, og Østrig Rundt lå historisk højere — men det er en
afvigelse fra det rene spejl af virkeligheden, og **ejeren skal tage stilling til den.**

**Navnene er seed-nøglen.** Etapeprofilerne afhænger af navnet. Ændres et navn efter
målingen, ændres parcours, og tallene holder ikke. Navnene skal låses før den endelige
tørkørsel.

## Kan det nås før sæsonskiftet 27-28/9?

**Ja, hvis det startes mandag 21/9.** Skridtene er: tre rækker i seed-CSV'en plus en
idempotent migration · ændring af reservations-tabellen plus de tests der låser den ·
opdateret golden-snapshot i samme PR · fuld lokal verifikation · migration applies efter
merge og post-verificeres · ny tørkørsel umiddelbart før generering, med ejer-go.
Groft skøn: **5-7 timers effektivt arbejde.** Ingen etapeprofiler skal skrives i hånden.

Hvad der kan gå galt: navne-ændringer efter målingen ugyldiggør tallene · målingen er
lavet på én sæson med én startdato og skal gentages med de endelige parametre ·
golden-snapshottet ændrer sig garanteret og skal med i PR'en ellers bliver CI rød · de
to gule markeringer er måske ikke godt nok for ejeren · oprykningen kræver ejerens
accept, ellers kan Division 2 slet ikke nås ad katalog-vejen.

**Anbefaling:** kør det, men kun hvis det startes mandag. Startes det onsdag, er
risikoen for at stå med en halvfærdig ændring midt i sæsonskiftet større end gevinsten,
og så hører det til som første opgave i det næste sæson-vindue.

## Hvad denne undersøgelse IKKE dækker

- **Selve beslutningen.** Intet er valgt, intet er skrevet.
- **En arketype med både garanteret bjergfinale og garanteret enkeltstart.** Ingen af de
  nuværende arketyper garanterer begge dele. Det er den mekaniske grund til at Division
  3 hidtil har betalt hver bjergdag med en enkeltstart. En sådan arketype ville løse
  problemet ved roden og gøre alle fremtidige bjergløb bedre. Det er en
  produktionskode-ændring med egne tests og hører ikke til i en undersøgelse — men det
  er efter min vurdering den rigtige langsigtede investering, større end de to løb.
- **De seks sæsons-finale-afvigelser.** Uændrede; det er måleartefakter på meget små
  stikprøver.
- **Et CodeRabbit-fund der ændrede tallene.** Første kørsel udledte kandidaternes
  parcours-nøgle anderledes end den rigtige import gør, så kandidaterne fik et andet
  parcours end de ville få i virkeligheden. Det er rettet og hele kørslen gentaget, og
  konklusionen gik fra to løb til tre. Det er samtidig det bedste bevis på at navnene
  skal være låst før den endelige måling.
- **Dag-for-dag-programmet.** Scorecardet måler fordelinger, ikke placeringen af det
  enkelte løb.

## Dom

**Bekræftet.** Problemet er reproduceret, rod-årsagen er skarpere end før (reservationen
binder, ikke forsyningen alene), og der findes en konkret kombination af tre nye løb og
en reservations-ændring der bringer alle fire divisioner i mål uden at nogen mister sin
enkeltstart og uden at nogen anden regel går fra grøn til rød.
