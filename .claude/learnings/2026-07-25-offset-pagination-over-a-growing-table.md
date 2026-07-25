# Postmortem · 2026-07-25 · OFFSET-paginering over en voksende tabel er en tidsindstillet bombe

## Hvad skete der?

Sæson-recappen (`SeasonEndPage`) hentede hele `race_results` for sæsonen ned i browseren med `fetchAllRows()` for at udregne tre aggregerede tal. Ved 459.347 rækker betød det 459 round-trips på i alt ~9,5 minutters databasetid **pr. sidevisning**.

Fejlen blev ikke fundet af en spiller, en fejlrapport eller en test. Den blev fundet i en driftsaudit, fordi ingen af de tre havde en chance for at finde den:

- Den kaster ikke — den er bare langsom, indtil den en dag rammer `statement_timeout` og så kaster.
- Sentry så den aldrig, fordi frontenden ikke rapporterer fangede fejl (#2891's søstererkendelse).
- Den blev målbart farlig først da tabellen voksede forbi et punkt ingen havde defineret.

## Root cause

`fetchAllRows` paginerer med `range(from, to)` → `OFFSET`. Postgres skal scanne alt foran offsettet for hver side, så prisen er kvadratisk i antal sider:

```
side 1   =    12,7 ms
side 451 = 3.662,0 ms      (288x værre)
```

Koden var korrekt da den blev skrevet. En kommentar i `economyEngine.js` fra samme periode påstod "sæson 1 har ~2.2k rækker" — den var 208× forkert da auditten læste den.

**Den dybere årsag: klienten bad om rå rækker for at udregne aggregater.** De 459k rækker blev brugt til præcis tre ting — sum pr. hold pr. løb, sum pr. hold, og count pr. rytter. Ingen af dem har brug for en eneste rå række.

## Fix

`public.get_season_recap(uuid)` laver aggregeringen server-side. 1 kald, 295 ms målt i prod, paritet 19.362.150 mod den rå sum.

Formen på svaret er `{ race_id: { team_id: prize } }` frem for en flad liste af objekter — det halverer payloaden (265 KB mod 631 KB, fordi nøglestrengene ellers gentages 4.756 gange) og er præcis det opslag klienten alligevel byggede selv.

## Det farligste var timingen, ikke langsomheden

`emitSeasonEndedNotifications` sender ved sæson-slut en besked til alle menneske-managers, og den deep-linker til netop denne side. **Den kode havde aldrig kørt i produktion.** Ved cutover ville ~150 managers ramme 9,5-minutters-siden inden for få minutter, samtidig med at databasen kørte finalization, payroll og op-/nedrykning.

En latent langsom side er ubehagelig. En latent langsom side som et endnu-aldrig-kørt code path sender hele brugerbasen ind i på samme minut er en hændelse.

## Forhindret-fremover

`SeasonEndPage.recapAggregate.test.js` gør tre ting, ikke én:

1. **Forward-guard:** forbyder at `race_results` eller `fetchAllRows` genindføres i filen.
2. **Paritetstest:** kører den gamle JS-aggregering og den nye side om side mod samme datasæt og kræver identiske kurver. Uden den er "jeg flyttede det til SQL" en påstand.
3. **Mutations-tjek af guarden selv:** guarden stripper kommentarer før den matcher (filens egne kommentarer beskriver med vilje det mønster den forbyder), så en test verificerer at strippen ikke gør guarden falsk-grøn.

## Læring

**Når en klient henter rå rækker for at udregne et tal, er datamængden en bombe med ukendt lunte.** Spørgsmålet er ikke "er det hurtigt nok i dag" men "hvad bruger vi rækkerne til" — svaret er ofte et aggregat, og så hører arbejdet hjemme i databasen.

To generaliserbare tjek, begge billige:

- **Kommentarer om datamængder forældes tavst.** `economyEngine.js:2006` sagde "~2.2k rækker" om en tabel med 459k. Ingen test fanger en forældet kommentar. Når en kommentar begrunder et designvalg med et tal, hører tallet til i en assertion eller slet ikke.
- **"Har denne kodesti nogensinde kørt i prod?"** er et selvstændigt review-spørgsmål. `season_ended`-notifikationen var merged, testet og lukket som done — og havde aldrig kørt. Samme klasse som e-mail-loopet (#2853) og `/pro` (#2806), begge fundet samme dag. Det er den blinde vinkel #2893's daglige sundhedsrapport findes for: en feature der aldrig kører producerer nul fejlsignaler, så perfekt sundhed og perfekt inaktivitet ser ens ud.

Refs #2891, #2745, #2904.
