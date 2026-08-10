# `.in(ids)` sprang URL-grænsen og efterlod 762 ryttere uden evner

**Dato:** 2026-08-10 · **Issues:** #3576, #3615 · **PR:** fix/3615-derive-batch

## Hvad skete der

Kompensations-kuldet (#3576) indsatte 762 akademi-kandidater fordelt på 192 hold.
Umiddelbart efter fejlede `deriveForRiderIds` med et bart `Error: Bad Request` på sin
FØRSTE select. Rytterne var oprettet, men stod uden physiology, evner, ryttertype og
base_value — altså præcis #1478-tilstanden.

Rodårsagen: PostgREST sender `.in("id", ids)` som en del af query-STRENGEN. 762 UUID'er
er ~28 kB URL, og Supabase afviser den med "Bad Request" uden at nævne længden nogen
steder. Fejlbeskeden peger på ingenting.

## Hvorfor det ikke var opdaget før

`deriveForRiderIds` har kørt i produktion siden #1478 uden problemer, fordi ingen tidligere
kalder nogensinde gav den nok id'er:

| Kalder | Typisk antal | Under grænsen? |
|---|---:|---|
| Søndags-drip (192 hold × 2) | 384 | ja, knap |
| Signup-kuld pr. hold | 3-5 | ja |
| Heal-sweeps | få | ja |
| **Kompensations-kuld (192 × 4)** | **762** | **nej** |

Grænsen har altså ligget der hele tiden som en latent fælde. Et større spillerfelt ville
have ramt den via det almindelige søndags-drip, og en relaunch — der deriver hele
peletonen — ville have ramt den med sikkerhed.

## Hvad reddede situationen

**#3576-fixet, landet få timer forinden.** Notifikationerne var netop flyttet til EFTER
derive-kaldet, så da derive fejlede, var der sendt **nul** beskeder. Ingen spiller fik
"New academy talent has arrived" om et kuld der ikke kunne vises. Havde rækkefølgen været
den gamle, ville 192 managere have fået mail om 762 tomme ryttere — nøjagtig det symptom
#3576 blev oprettet for.

Fejlen bekræftede altså værdien af sin egen forudgående rettelse, tilfældigt samme aften.

## Rettelse

`selectByIdsBatched` i `backfillCores.js` portionerer alle `.in(ids)`-opslag i bidder af
200. Begge selects i `deriveForRiderIds` (riders + rider_derived_abilities) går gennem den.

Regressionstesten tæller den største id-liste der når frem til `.in()` og fejler over 200.
Bevist mod den gamle kode: *"største IN-opslag havde 762 id'er — over grænsen."*

## Lærdom

**En URL-længde-grænse melder sig ikke som en længde-fejl.** `Bad Request` uden detaljer på
en query der virker med færre rækker er næsten altid query-strengens størrelse. Kig efter
`.in()` med en liste der er vokset.

**Batching af writes beskytter ikke reads.** Filen havde allerede `UPSERT_BATCH = 500` og
`WRITE_CONCURRENCY = 25` — men ingen tilsvarende grænse på læsestien. Skrivestien var
gennemtænkt; læsestien var det ikke, fordi ingen havde givet den nok id'er endnu.

**Skalerings-fælder afsløres af det første kald der er større end normalt.** Kompensations-
kuldet var bare 2× søndags-drippet. Når en ny kalder giver en gammel funktion væsentligt
mere data end den plejer, er det værd at spørge hvad der bryder ved 10×.

## Følgefejl fra samme kørsel (rettet undervejs)

- `--finish`-opsamlingen brugte `notifications.team_id`; tabellen adresserer på `user_id`.
  Holdene skal mappes til ejere først, ellers dobbelt-notificeres alle ved en gentagelse.
- To hold manglede notifikation efter første opsamling. Én var korrekt dedup
  (`RECENT_DUPLICATE_WINDOW_MS` = 24 t, holdet fik en drip 9/8 kl. 23). Den anden kom med i
  anden kørsel — transient. At `--finish` er idempotent gjorde det til et no-op-problem.
