# "Bearer undefined" slap forbi serverens tomt-token-værn

**Dato:** 2026-08-28 · **Issue:** #4347 · **Opfølgning:** #4348 · **Fundet af:** daglig Sentry/Railway-triage

## Hvad skete der

Frontendens `authHeaders()` byggede headeren sådan:

```js
Authorization: `Bearer ${session?.access_token}`
```

Når sessionen var død, blev `session?.access_token` til `undefined`, og template-strengen gjorde `undefined` til **teksten** `"undefined"`. Headeren blev `"Bearer undefined"` — ikke en manglende header, men en tilstedeværende header med ubrugeligt indhold.

Serverens første værn så sådan ud:

```js
const token = req.headers.authorization?.replace("Bearer ", "");
if (!token) return res.status(401).json({ error: "Unauthorized" });   // ← passeres
const { data: { user }, error } = await supabase.auth.getUser(token); // ← bad_jwt
```

`"undefined"` er en ikke-tom streng, så `if (!token)` var falsk. Kaldet gik videre til `getUser()` og blev til en 401 `bad_jwt`.

Layout-komponentens heartbeat kører `setInterval(..., 60000)` så længe `session`-state er sat, og intet i den løkke læste statuskoden. En død session blev derfor ved med at sende `"Bearer undefined"` hvert 60. sekund indtil fanen blev lukket.

Sidegevinst-fejl: `fetchOnlineCount` tjekkede aldrig `res.ok`, så 401-kroppen `{ error: "Invalid token" }` blev parset som et normalt svar. `data.count` var `undefined`, og `setOnlineCount(data.count || 0)` skrev **0** på skærmen. Spilleren så "0 online" i stedet for "du er logget ud".

## Hvorfor det ikke blev opdaget før

Tre lag så hver især ingenting:

1. **Sentry:** 401-grenen kaster ikke — den logger og returnerer. Ingen sag blev oprettet. Fejlen fandtes kun som `console.warn`-linjer i Railway-loggen.
2. **Klienten:** hvert eneste kaldested var pakket ind i `try/catch` eller `.catch(() => {})` med en "non-kritisk, fejler stille"-kommentar. Det var bevidst og rigtigt for netværksfejl — men det skjulte også en fejl der ramte hver gang.
3. **Serveren:** værnet var skrevet mod den rigtige antagelse (*"vores egen SPA sender ALDRIG et request uden token"*) men testede den forkerte ting. Det tjekkede for *fravær* af et token, ikke for et *ubrugeligt* token.

## Rod-årsagen bag rod-årsagen

`authHeaders()` var skrevet forfra **26 gange** i `frontend/src`. Ikke importeret 26 steder — nedskrevet 26 gange, i fire indbyrdes forskellige varianter. 22 af dem havde værnet `if (!token) return null`. Fire havde det ikke.

Det er ikke et uheld at netop fire manglede det. Når en funktion bor 26 steder, er der 26 chancer for at glemme et detaljespørgsmål, og ingen mekanisme der spreder rettelsen til de øvrige. De 22 korrekte kopier beviser at forfatterne *kendte* det rigtige mønster — de kunne bare ikke håndhæve det.

## Hvad blev gjort

- Værnet lagt i alle fire uværnede kopier; kontrakten er `null` = "ingen session", som de 22 øvrige.
- 24 kaldesteder tilpasset. To af dem kunne ikke tage en tidlig retur (den ville springe efterfølgende, nødvendigt arbejde over) og fik `if (h)` i stedet.
- `fetchForumUnread` viste sig allerede at håndtere `null`-headers — endnu et tegn på at `null` var den tilsigtede kontrakt hele vejen.
- Ny i18n-nøgle `api.session_expired` så kontrakt-handlingerne kan sige "Din session er udløbet" i stedet for en tom fallback.
- Forward-guard: `authHeadersSessionGuard.test.js` scanner **hele** `frontend/src` og fejler hvis nogen `authHeaders()`-definition kan sende et uverificeret token. Verificeret: rulles fixet tilbage i `Layout.jsx`, fejler testen med præcis den filsti.

## Læringer

**Et værn skal teste den tilstand du frygter, ikke den du forestiller dig.** `if (!token)` beskyttede mod "ingen header". Den faktiske fejltilstand var "header med skrald i". Optional chaining inde i en template-streng laver stille `undefined` om til data — `${x?.y}` er `"undefined"`, ikke tomt.

**Test bredt når fejlen er "nogen glemte det".** En test af de fire kendte filer ville have været grøn dagen efter og ladet kopi nr. 27 gentage fejlen. Guarden scanner hele træet, så den også dækker filer der ikke findes endnu. Den slags fejl skal fanges strukturelt, ikke per kendt forekomst.

**"Fejler stille" skal betyde "fejler sjældent".** Mønsteret `.catch(() => {})` er rigtigt for et netværksudfald hver hundrede gang. Det er forkert når fejlen indtræffer hver gang for de berørte spillere — så er tavsheden ikke robusthed, men blindhed. Værd at overveje om de non-kritiske kald burde tælle deres fejl og larme ved vedvarende fejl frem for kun ved den enkelte.

**Duplikering rammer sjældent jævnt.** Skaden var ikke at koden stod 26 gange — det var at de 26 kopier drev fra hinanden, og at driften var usynlig indtil nogen talte dem. Optællingen tog to minutter og var det der gjorde fejlen forståelig.

## Løse ender

- **#4347 punkt 2 og 3 er stadig åbne:** heartbeatet stopper nu af sig selv, men logger ikke spilleren ud — fanen ser fortsat indlogget ud med frosne tal.
- **#4348:** saml de 26 kopier i `lib/supabase.ts`, hvor 18 af filerne allerede henter `getSession` fra.
