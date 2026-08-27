# Vagten målte noget andet end den regel der håndhæves

**Dato:** 27/8 2026 (natsession før sæsonstart)
**Issues:** #4282 · #4146 · #4184 · #4219 · #4215 · #4200 · #4233

## Mønsteret

Fem uafhængige fund på én nat viste sig at være samme fejl:

| Vagt | Måler | Reglen er | Resultat |
|---|---|---|---|
| `squad_within_max` | alle `riders`-rækker | senior-kun 30-cap | 25 falske positiver af 25 |
| `debt_within_ceiling` | `amount_remaining` (inkl. rente) | hvad man må låne | 2 falske positiver |
| `raceRouteRealismScorecard` | sin egen genererede plan | den skrevne kalender | falsk rødt, 3 wipe/regen-runder |
| GT-båndet | løb med ≥21 etaper | S3's GT'er kører 17-18 | 3 løb helt umålte |
| `calendarScorecard4218` | (korrekt) | (korrekt) | kørte bare ingen steder |

Fire af fem var **ikke** datafejl. De var vagt-fejl. Og de kostede: 6 røde checks i den
natlige audit hvoraf 2 var ren støj, tre unødvendige kalender-regenereringer, og en
`audit`-workflow som NOW.md med rette kaldte "reelt dødt værn".

## De tre former fejlen tager

**1. Vagten genskriver konstanten i stedet for at importere den.**
`verify-invariants.js` havde `SQUAD_MAX = {1:30, 2:30, 3:30}` og
`DEBT_CEILING = {1,2,3}` som håndholdte kopier. Division 4 manglede i begge, og
`if (max !== undefined)` gjorde at D4-hold blev sprunget stille over — vagten var
**blind for en hel division** uden at nogen kunne se det. De kanoniske kilder
(`marketUtils.js`, `economyConstants.js`) havde D4 hele tiden.

**2. Vagten måler en nabo-størrelse der plejer at være den samme.**
Gældsloftet styrer hvor meget du må låne. Vagten målte udestående gæld. De to er ens
lige indtil første rente tilskrives — hvorefter enhver der maxer sit lån er garanteret
at bryde vagten uden at have gjort noget. Spilmotoren gjorde det allerede rigtigt
(`economyEngine.js` #2912: *"man ikke bør straffes for motorens egen kapitalisering"*).
Vagten kendte bare ikke den viden.

**Jeg gik selv i den fælde mens jeg fiksede den.** Min første anbefaling var at måle på
trukket beløb (`principal + origination_fee`). Det gav **5** brud i stedet for 2, fordi
et hold kan have flere aktive lån og have afdraget på dem. Det rigtige mål var
`amount_remaining - accrued_interest` — nøjagtig det udtryk `economyEngine` selv bruger.
**Læringen inde i læringen:** når håndhævelsen allerede regner det rigtige tal ud, så
genopfind ikke formlen — importér eller genbrug udtrykket.

**3. Vagten måler en hypotese i stedet for virkeligheden.**
`raceRouteRealismScorecard` byggede sin egen kalender og scorede den. Det gav falsk rødt
25/8. Men den farlige retning er den modsatte: et reparations-script kan ændre den LIVE
kalender uden at en plan-baseret vagt opdager noget — præcis #4155, hvor
`TIER_OVERLAP_CAP` blev brudt i alle fire divisioner uopdaget.

## Bonus-formen: vagten kan slet ikke tale

`league-size-invariant-audit.yml` kørte under `bash -e` og gjorde:

```
node audit.js --json > rapport.json     # exit 1 ved fund → steppet dør HER
node audit.js | tee rapport.txt          # nås aldrig
total=$(...)                             # sættes aldrig
```

Auditten `exit 1`'er ved fund — det er hele pointen. Men det betød at den døde før den
læsbare rapport blev skrevet, før `total` blev sat, og før artifact- og
kommentar-mekanikken. Resultatet var et rødt X **uden en eneste linje om hvad den fandt**.
En vagt der ikke kan fortælle hvad den så, er ikke bedre end ingen vagt.

Samme fælde lurer overalt hvor et script med en meningsfuld exit-kode piper gennem `tee`:
GitHub's bash har **ikke** `pipefail` som default, så `node ... | tee` returnerer `tee`'s
0 og gaten kan aldrig blive rød. Modsat fælde, samme familie.

## Reglerne der kom ud af det

1. **En vagt importerer konstanten. Den genskriver den aldrig.** En kopi driver, og
   driften er tavs. Mangler en nøgle i map'et, springes hele klassen stille over.
2. **Mål præcis det håndhævelsen måler.** Findes udtrykket allerede i motoren
   (`interestExcludedDebt`), så brug dét udtryk — ikke et der plejer at ligne.
3. **En gate skal kunne blive både grøn og rød, og det skal bevises.** Kør den mod et
   brudt input. `calendarScorecard4218` blev verificeret begge veje (exit 0 / 0 brud på
   den rigtige kalender, exit 1 / 25 brud på `--days=12`) før den blev sat i CI.
4. **En vagt der måler en plan skal også kunne måle virkeligheden.** #4176 punkt 3
   siger tre steder: CI, preflight, og mod prod. To af tre er ikke nok — forskellen
   mellem dem er netop der fejlene gemmer sig.
5. **En vagt der bliver stille når systemet ændrer sig, er ikke en vagt.** Samme læring
   som #4229 (alle fire kalender-invarianter svarede "OK — ingen aktiv sæson" gennem et
   fire timers nedbrud). GT-båndet gentog den: sæsonen blev kortere, GT'erne gik fra 21
   til 17-18 etaper, og båndet holdt op med at måle noget som helst — uden at sige det.
6. **`set -o pipefail` eksplicit i enhver CI-kommando hvor exit-koden betyder noget.**

## Den anden fejlklasse fra samme nat: filteret der ikke kendte hele reglen

#4200 og #4233 ligner hinanden mistænkeligt:

- `fillMissingTeamEntries` filtrerede på `is_frozen`, entries og afmeldinger — men
  kendte ikke `race_entry_clears`. Så en trup spilleren havde ryddet og bekræftet blev
  fyldt ud igen ved løbets start.
- `removeAiTeams` filtrerede på inflight-entries og uudbetalte præmier — men kendte ikke
  `transfer_offers`-FK'en. Så trimmen valgte et hold den ikke kunne slette, kastede, og
  efterlod puljen over target.

Begge er **et prædikat der er blevet en delmængde af virkeligheden.** Og #4233's var
værre end den så ud: fordi kandidaterne vælges i **id-orden**, og D4-A's to første
AI-hold netop var de blokerede, valgte trimmen det samme umulige hold hver eneste gang
mens 16 trimbare lå lige bagved i køen. Determinisme gør et sjældent uheld til en
permanent blokering.

**Regel:** når du tilføjer en ny grund til at springe en kandidat over, så led efter
*alle* de steder kandidater vælges. #2599 gav sweep'en ryd-reglen; løbs-tids-autofyldet
fik den først 8 uger senere.

## Forward-guards der kom med

- 3 tests i `raceRunnerAutofill.test.js` (#4200) — verificeret at fejle mod gammel kode.
- 2 + 2 tests i `aiTeamGenerator.test.js` / `aiTeamTrimHealSweep.test.js` (#4233) — samme.
- 4 tests i `raceRouteRealismScorecard.test.js` (#4219), DB-frie.
- `calendar-scorecard-gate.yml` (#4215).
- `handheldCopyGuards.test.js`-udvidelser: en ny finans-type eller træningsfokus uden
  oversættelse fejler nu i backend-tests i stedet for at drive stille (#4260).
