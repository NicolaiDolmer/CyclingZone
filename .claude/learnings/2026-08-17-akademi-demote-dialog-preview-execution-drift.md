# Postmortem · 2026-08-17 · akademi-demote-dialogen lovede ét, gjorde et andet (løn + løb)

## Hvad skete der?
To Discord-rapporter om den samme dialog (`AcademyTransferConfirmModal`,
demote-retning: senior → akademi), forskellige symptomer:

- **#3784** (@jeppek, 14/8): dialogen lovede en ungdomsløn på **324 CZ$**.
  Rytteren endte på **5.191 CZ$** efter selve flyttet.
- **#3805** (@friisisch, 15/8, opfølgning på @jeppek's 14/8): en rytter der
  blev flyttet MIDT i et igangværende etapeløb ryg ud af feltet, men dialogen
  fortalte kun om "kommende løb ryddet" — som viste **0**, fordi flyttet
  bevidst ikke rører igangværende `race_entries` (resultat-/snapshot-
  invarians).

## Root cause
Klassisk preview/udførelse-drift — dialogen og selve flyttet brugte to
FORSKELLIGE beregninger, fodret med forskellige data:

**#3784:** `RiderManageActions.jsx`'s `openDemote()` beregnede den viste løn
med en frontend-JS-kopi af formlen (`marketValues.projectYouthSalary`), fodret
med rytter-objektet fra `RiderStatsPage.jsx`'s SELECT. Den SELECT hentede
ALDRIG `current_production_value` — så `salaryFromProduction` faldt tilbage
på `BASE_VALUE_FALLBACK` (1000) og viste `round(1000 × 0,3238) = 324` for en
rytter i division 2, uanset hans faktiske produktion. Selve flyttet
(`academyTransfer.js`'s `demote()` → `demoteSalary()` → `computeFrozenSalary`)
regnede med en FRISK, korrekt SELECT der rent faktisk hentede
`current_production_value` — og landede på den ægte løn (5.191 for den
rapporterede sag). Samme rate-tabel, samme formel — divergensen var
UDELUKKENDE hvilken data hver side af dialogen fik.

**#3805:** dialogens racesCleared-tæller (og `demote_rider_to_academy`-RPC'ens
faktiske sletning) tæller KUN fremtidige løb (`status='scheduled' AND
stages_completed=0`) — korrekt for det den måler. Men `riderEligibility.js`
filtrerer `is_academy=true` fra ved udtagelse/afvikling UANSET løbets status,
så en rytter der demotes midt i et igangværende løb (`stages_completed>0`)
falder reelt ud af feltet, mens hverken tælleren eller dialog-teksten nævnte
den konsekvens. `docs/GAME_INVARIANTS.md` bekræfter at akademi-ryttere er
udelukket fra ALLE senior-squad-cap-tællinger og løb-berettigelse — så det er
IKKE en bug at rytteren udgår (invarianten er tilsigtet); bugget var at
dialogen ikke sagde det.

## Fix
1. Ny backend-route `GET /api/riders/:id/academy-demote-quote`
   (`backend/routes/api.js`) kalder LIGE PRÆCIS `demoteSalary()` — samme
   funktion `demote()` selv bruger — på en fuldt frisk server-side SELECT.
   Ingen frontend-JS-kopi af løn-formlen tilbage i demote-stien.
2. To nye, delte tællere i `backend/lib/raceEntryCleanup.js`:
   `countFutureRaceEntries` (racesCleared-preview) og `countOngoingRaceEntries`
   (racesOngoing — NY). Sidstnævnte kaldes BÅDE af quote-routen (preview) og
   af `academyTransfer.js`'s `demote()` selv (den faktiske konsekvens,
   returneret i svaret) — samme funktion begge steder, ingen mulighed for at
   de to tal driver fra hinanden.
3. `RiderManageActions.jsx` (rytterprofilen) og `TeamPage.jsx` (holdsidens
   roster) kalder begge den nye quote-route i stedet for at duplikere
   løn-formlen/racesCleared-forespørgslen selv.
4. `AcademyTransferConfirmModal.jsx` viser nu BÅDE "Kommende løb ryddet" og
   "Løb rytteren udgår af" (ny række, kun vist når > 0) + en ærlig note-variant
   (`demoteNoteOngoing`) når rytteren rent faktisk udgår af et igangværende
   løb. Modalen viser "..." og låser bekræft-knappen mens quoten hentes, i
   stedet for at vise et forkert tal FØR data er klar.

**Beslutning #3805 (dokumenteret her, ikke i selve løbsafviklingen — den er
urørt):** valgte retning B ("advar ærligt"), ikke A ("bloker flyttet").
`docs/GAME_INVARIANTS.md` beskriver akademi-udelukkelse fra løb-berettigelse
som en TILSIGTET, ubetinget invariant — at blokere demote ville modarbejde
den, ikke reparere en bug.

## Forhindret-fremover
- `backend/lib/academyTransfer.test.js`: nye regressionstests låser at
  `demoteSalary()` (samme funktion, samme input) giver IDENTISK resultat for
  preview og udførelse — og dokumenterer eksplicit den gamle,
  manglende-data-formel der reproducerer 324 vs. 5.191.
- `backend/lib/raceEntryCleanup.test.js` (ny fil): dækker
  `countFutureRaceEntries`/`countOngoingRaceEntries`-prædikaterne isoleret +
  bekræfter at `countFutureRaceEntries` er enig med `clearFutureRaceEntries`
  (den funktion der rent faktisk sletter) om hvad "fremtidigt" betyder.

## Læring
En "spejlet formel" (kommentarer der siger "spejler X, hold i sync") er en
tidsindstillet bombe selv når selve formlen er korrekt — divergensen her kom
ikke fra to forskellige formler, men fra at den ene side manglede et
SELECT-felt. Når en bekræftelses-dialog viser et tal en efterfølgende
handling gør autoritativt, skal dialogen kalde DEN SAMME funktion (typisk via
et backend preview-endpoint), ikke en frontend-kopi fodret med hvad end
kalder-siden tilfældigvis har hentet. Samme mønster som #2796 (`projectYouthSalary`
uden `division` faldt tilbage til den globale sats) — en tredje variant af
"korrekt formel, forkert/manglende input" i præcis samme dialog-familie på
under en måned. Overvej et generelt forward-guard (kald-site-scanner, som
`salaryProjectionDivision.test.js` allerede gør for `division`) for
"preview-funktion kaldt uden de samme felter som udførelsen SELECT'er".
