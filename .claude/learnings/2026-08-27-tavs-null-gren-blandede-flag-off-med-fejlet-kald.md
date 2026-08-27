# Tavs null-gren: "flaget er slukket" og "kaldet fejlede" delte render-gren

**Dato:** 27/8 2026 · **Issue:** #4165 · **PR:** fix/4165-silent-null-planning

## Symptom

ez4prebren i Discord 23/8 kl. 23:05 dansk tid: *"Er jeg den eneste, der ikke kan
komme ind i planlægningen pt?"* Fra mobilen. Fem minutter senere: *"Det er kun
planlægning, alt andet virker."*

(Issuets kildeangivelse mærker tråden *"23/8 21:05-21:10 (UTC)"*. Første udkast af
denne postmortem skrev 21:05 om til CEST i stedet for at konvertere fra det.
To timer forkert, og nok til at en logsøgning ville ramme det forkerte vindue.)

Om en genindlæsning hjalp, siger tråden to forskellige ting, og det er ikke
afgjort. bobby2106 (21:09): *"Du skal bare genindlæse, og så er den der done"*, og
issuets egen titel siger "fejler på mobil **indtil** hard-reload" med *"På desktop
løser CTRL+F5 det"* i brødteksten. ez4prebrens svar til bobby, *"Kommer bare frem
med det samme"*, læses nemmest som at fejlen kom igen straks, men det er en
tolkning, ikke en måling. Der er ingen evidens der afgør det.

Issuet stod fire dage senere stadig med "Skal undersøges: hvad fejler konkret?".

## Rodårsag

Ikke mobil-specifik. Tre hypoteser blev afkræftet med målt evidens: der er ingen
JS-breakpoint i planlægnings-træet (mobil/desktop-skiftet er ren CSS), der findes
ingen service worker, og HTML'en serveres med `max-age=0, must-revalidate`.

En fjerde, *var backenden nede i netop det minut?*, er **ikke** afkræftet. Et
tidligere udkast skrev "backenden var oppe og rask i netop det minut" som målt
evidens, men det står ikke til at måle: Railway-HTTP-logs for 23/8 findes ikke
længere (samme grund som står under "Hvorfor det ikke blev opdaget"), og de to
mest sandsynlige afvisninger var ulogget i begge ender. At Sentry ikke viser noget
den aften beviser intet her: 401 og 400 nåede aldrig Sentry. Hypotesen står
åben, og instrumenteringen i dette fix er dét der lukker den næste gang.

Den rigtige rodårsag stod i koden hele tiden:

```js
// RaceHubBoard.jsx, før fixet
if (!headers) { setLoading(false); return; }   // ingen token: tavs
try {
  const res = await fetch(url, { headers });
  if (res.ok) setData(await res.json());        // ikke-2xx: tavs
} catch { /* netværk - board forbliver i forrige tilstand */ }
...
if (!data?.enabled) return null;                // og så tegnes der INTET
```

Den sidste linje er hele bugget. Den blander to helt forskellige tilstande
sammen: *feature-flag off* (legitim, boardet skal være skjult) og *kaldet
lykkedes ikke* (fejl, manageren skal vide det). Uden fejl-state falder begge ned
i samme gren. Resultatet er en flade uden spinner, uden besked og uden retry.

Bemærk hvad denne rodårsag gør ved reload-spørgsmålet: er fejlen deterministisk
(401 på en død session, 400 "No team found"), kan en genindlæsning ikke reparere
noget, for den kører det samme fejlende kald igen og tegner det samme intet. Er
fejlen derimod transient eller en stale chunk, virker et reload. Fladen så ens ud
i begge tilfælde, og det er præcis derfor hændelsen ikke kan afgøres bagudrettet.

Samme mønster fandtes i `StrategyPage.jsx` og `DivisionStartLists.jsx`. Formplan-
fanen fik http/network-grenene lukket i #2849 bølge 6 (`usePlanner.js` setError →
ErrorState + retry), men dens **auth**-gren returnerede stadig tavst, og det samme
gjorde sæson-visningen på Holdudtagelses-fanen (`SeasonView.jsx`). De to faldt
derfor igennem til hver sin tom-state, *"Sæsonplanlæggeren er ikke live endnu"* og
*"Ingen løb på kalenderen endnu"* - en fejlet hentning der påstår at være en
legitim tom flade.

Kalender-fanen (`CalendarPage.jsx`) er den sjette, og den blev først fundet i
anden verifikations-runde, fordi den fejler ad en fjerde vej: den tjekkede slet
ikke `res.ok`. Et 401 fra `requireAuth` har en gyldig JSON-krop, så `res.json()`
lykkes, `data` bliver `{error:"Invalid token"}`, `!data?.season` er sandt, og
manageren får *"Ingen aktiv sæson"*. Fladens `catch`-baserede fejl-state kunne
derfor aldrig nås af en HTTP-fejl. Bemærk hvor tæt den lå på de andre: samme
endpoint som `SeasonView` (`/api/races/calendar`), i samme hub, og den fik
alligevel ikke `!res.ok`-behandlingen i første runde.

Talt op: alle **seks** indgange i hubben kunne lyve - tre ved at vise intet, tre
ved at vise en tom tilstand der påstod noget konkret og forkert.

## Hvorfor det ikke blev opdaget

Tre lag svigtede samtidig.

1. **Ingen test dækkede fejl-halvdelen.** Der fandtes hverken unit- eller e2e-
   dækning for `!res.ok` eller netværksfejl i nogen af de tre tavse flader, og
   ingen af de seks dækkede auth-grenen overhovedet. Preview-
   mocken svarer altid 200 på `/api/races/distribution`, så halvdelen af
   kontrakten var utestet by design. Da fejl-halvdelen endelig FIK en guard,
   beskrev første udgave af den kun de flader fixet lige havde rørt, så den kunne
   ikke fange den sjette. Se læringen om guards nedenfor.
2. **Backenden loggede ikke sine egne afvisninger.** 401 fra `requireAuth` og
   400 "No team found" havde hverken log eller Sentry. Kun 500-grenen
   rapporterede.
3. **Klienten kastede svaret væk.** Ingen status, ingen krop, ingen telemetri.

Konsekvensen: den udløsende fejl kan IKKE bestemmes bagudrettet. Railway-HTTP-
logs for 23/8 findes ikke længere, og Discord-screenshottet er udløbet. Fixet
gør fejlklassen synlig fremadrettet; det genskaber ikke evidensen for hændelsen.

Gælden var i øvrigt allerede kendt og skrevet ned: `docs/PLANNING_CENTER_RULES.md`
§7 fund 5, *"Fem flader returnerer tavst null ved slukket flag ELLER fejlet
kald"*, efterprøvet mod koden 25/8. #4165 er den første spiller-rapport der
beviser at gælden koster i produktion. Et dokumenteret fund er ikke en løsning.
(Fundet talte fem; den rigtige optælling i hubben var seks. Se læringen nedenfor
om tal i SSOT-dokumenter.)

Uden for hubben lever fejlklassen videre. Fire er efterprøvet mod koden 27/8:
`RaceSelectionPanel.jsx`, `StageRoleMatrix.jsx`, `useTraining.js` (hvis tom-state
er *"Daily training is currently paused. Training programs can still be set up
now."* - ordret samme løgn som *"Sæsonplanlæggeren er ikke live endnu"* var) og
`useScouting.js` (falder tilbage til "uscoutet"). Dertil en håndfuld hooks der kun
deler den tavse **auth**-gren. En app-bred optælling er ikke lavet, og fund 5 i
SSOT'en påstår derfor ikke længere et samlet tal for hvad der er tilbage.

## Fix

De tre tavse flader fik den fejl-kontrakt Formplanen allerede havde for
http/network: `loadError` for alle fire grene (auth/http/parse/network),
`setLoading(false)` i `finally`, og en kanonisk ErrorState med secondary retry.
Fejl-grenen ligger FØR flag-grenen, og `!data?.enabled → null` er bevaret uændret
som den legitime flag-off-tilstand.

De to øvrige flader fik deres auth-gren lukket i samme rækkefølge-kontrakt:
`usePlanner.js` sætter nu `setError("auth")` (så SeasonPlannerPages fejl-gren, der
ligger før `!enabled`, rent faktisk rammes), og `SeasonView.jsx`s `failed` bærer nu
en kind i stedet for et boolean, så en død session får sin egen besked frem for
"ingen løb på kalenderen endnu". Begge tom-tilstande er bevaret som legitime.

Kalender-fanen fik hele kontrakten: `authHeaders()` returnerer nu `null` i stedet
for `Bearer undefined`, `!res.ok` har sin egen gren, parsningen sin egen, og
fejl-grenen ligger før `!data?.season`.

To ting mere, fundet ved at læse fixet efter i sømmene:

- **Fejl-fladen må ikke rive navigationen ned.** Første udkast returnerede kun
  ErrorState + "Prøv igen" i fejl-grenen, mens `ContextBand` (scope-skifteren) og
  `PoolPicker` lå i success-grenen. Et fejlet pulje- eller dagsskift efterlod
  dermed manageren med én knap, der gentager præcis det samme fejlende kald med
  samme `?pool` og `?day`. Et faneskift redder ikke: `changeTab` rydder kun `view`
  og `season`. Før fixet blev den forrige puljes data stående - en løgn, men
  navigerbar. Vælgerne holdes nu uden for `data` og monteres også ved fejl.
- **Parsningen skal have sin egen gren overalt, ikke tre steder ud af fem.** Lå
  `res.json()` i den ydre try, blev en malformet 2xx-krop rapporteret som
  `kind:"network"` - spillerens forbindelse - for en fejl der kom fra serveren
  eller en proxy. Det er forkert triage i netop det signal instrumenteringen er
  bygget til at bære.

Instrumentering, så næste rapport kan diagnosticeres:

- `reportLoadFailure()` sender en fejlet hentning til Sentry som exception med
  lav-kardinale tags (flade/kind/status). En fejlet HENTNING er ikke en
  afvisning: spilleren ramte ingen regel, fladen er nede for netop ham.
  Fire kinds, ikke tre: `auth`, `http`, `parse` og `network`, på alle seks flader.
- Backenden logger nu 401 "Invalid token" (metode, sti uden query, fejlkode,
  aldrig token'et) og 400 "No team found" (user_id).

## Læring

**En render-gren der kan nås af to årsager med modsat betydning er en bug, også
når den ser ud som en tom tilstand.** "Vis intet" er et legitimt svar på "feature
er slukket" og aldrig et legitimt svar på "jeg ved det ikke". Når de deler linje,
er den tavse variant den der rammer spilleren.

**En tom `catch` er et løfte om at fejlen ikke betyder noget.** Kommentaren i
RaceHubBoard sagde *"netværk - board forbliver i forrige tilstand"*. Ved den
allerførste hentning FINDES der ingen forrige tilstand, så løftet var forkert
præcis når det gjaldt.

**Fejl-grenen skal instrumenteres samtidig med at den bliver synlig.** Havde 401
og 400 været logget i forvejen, havde denne session taget minutter i stedet for
en hel kortlægning. Det billigste tidspunkt at gøre en fejl observerbar er før
nogen leder efter den.

**"Hjalp en genindlæsning?" er det mest diagnostiske spørgsmål i tråden, og
netop derfor må svaret ikke gættes.** Hjælper et reload ikke, udelukker det stale
chunks og cache og peger på en deterministisk fejl i kaldet; hjælper det, peger
det den stik modsatte vej (og den klasse er allerede dækket af #881's
`lazyWithRetry`). Her siger tråden begge dele, og første udkast af denne
postmortem valgte den ene læsning og skrev den videre som fastslået - helt ind i
patch-noten til spillerne. En tolkning af en Discord-replik er ikke en måling.
Skriv "ikke afgjort" og lad instrumenteringen svare næste gang.

**En tom tilstand er en påstand på linje med en fejlbesked.** "Ingen løb på
kalenderen endnu" og "Sæsonplanlæggeren er ikke live endnu" ligner uskyldig
tomhed, men de fortæller manageren noget konkret om spillets tilstand. Nås de af
en fejlet hentning, lyver de mere overbevisende end en blank side gør.

**En guard skrevet ud fra de flader du lige har rettet, er skrevet til at
acceptere resten.** Forward-guarden havde en `SURFACES`-liste med tre af hubbens
seks flader, og dens kind-løkker gik over `["auth","http","network"]` - præcis de
tre grene fixet havde lukket. Den kunne derfor ikke fange hverken kalender-fanen
eller den manglende parse-gren. En guard skal beskrive **kontrakten**, ikke
diffen: listen skal være hver flade der har kontrakten, og hvert felt kontrakten
kræver. Prøven er billig - rul hver kildefil tilbage til før-tilstanden og se
guarden fejle. Gør den ikke det, guarder den ingenting.

**Et tal i et SSOT-dokument er en påstand, og et tal du ikke selv har talt er en
gætning.** Både "fem flader" og "uden for hubben står to tilbage" var undertal;
det sidste oversprang blandt andet `useTraining.js`, hvis tom-state siger *"Daily
training is currently paused"* når hentningen fejler. Enten tæller du efter, eller
også skriver du ikke tallet. "Fire er efterprøvet, en app-bred optælling er ikke
lavet" er et ærligt dokument; "to tilbage" er et forkert et, og det er værre end
ingen optælling, fordi det ser afsluttet ud.

**Tidszoner: konvertér, lav ikke om på etiketten.** Kilden mærkede tråden
*"21:05-21:10 (UTC)"*; postmortem'ens første udkast skrev "21:05 CEST" og flyttede
dermed hændelsen to timer. Ved en logsøgning er det forskellen på at finde noget
og at konkludere at der intet var.

**Skriv ikke en hypotese som afkræftet, når det lag der kunne afkræfte den er
væk.** Samme dokument påstod "backenden var oppe og rask i netop det minut" og -
tolv linjer længere nede - at Railway-HTTP-loggene for dagen ikke findes mere.
Begge dele kan ikke være sandt. Fraværet af Sentry-støj beviser ikke noget om et
lag der aldrig rapporterede til Sentry.
