# En hard rule var kun håndhævet på halvdelen af repoet, og hullet var usynligt fordi guarden var grøn

**Dato:** 25/8 2026 · **Issues:** #3385, #4222 · **PR:** #4237

## Hvad der skete

25/8 blev 6 tests i `backend/lib/raceCalendarLanePackerGtDayCap.test.js` røde. Ingen commit havde rørt dem. Testen hardkodede `resolveCalendarFrom({ firstRaceDate: "2026-08-25" })` uden at sende et `now`, og guarden i `calendarStartDate.js` afviser en første løbsdag der ikke er strengt i fremtiden. Da vægur-tiden nåede 25/8, gik testen fra grøn til rød af sig selv.

Det er nøjagtig hard rule 16: en test må aldrig læse vægur-tiden. Reglen fandtes. Den var endda markeret 🔒, altså mekanisk håndhævet, med `clock-drift-test-check.yml` som håndhæver.

Problemet var at den håndhæver kun kørte `frontend`.

## Rod-årsagen

Reglen blev født ud af #3385, hvor en **frontend**-test faldt tilbage på den rigtige klokke. Guarden blev bygget til at lukke den konkrete hændelse, og den gjorde den ene ting godt. Men reglen er skrevet universelt ("en test"), mens håndhævelsen kun dækkede den pakke hændelsen tilfældigvis ramte.

Så blev reglen markeret 🔒 i AGENTS.md. Derfra var hullet usynligt, for det stod sort på hvidt at reglen var mekanisk dækket, og det var den, halvt.

Målt på den gamle testfil (`ca50484cc`) med `scripts/fake-clock-preload.mjs`:

| Klokke | Resultat |
|---|---|
| minus 30 dage (26/7) | 6/6 grønne |
| plus 183 dage | 0/6 grønne, 6 fejl |

Altså: guarden ville have fanget den en måned før datoen passerede, hvis den havde kørt på backend. Fejlen var ikke svær at opdage. Den blev bare aldrig kigget efter det rigtige sted.

## Hvad jeg ændrede

`clock-drift-test-check.yml` kører nu begge pakker som en matrix. Undervejs tre ting værd at huske:

1. **`--import` propagerer ikke til child-processer.** Backends runner (`scripts/run-tests.js`) spawner selv Node-processer med deres eget `--import ./test-setup.js`. Et flag på forælderen når dem aldrig. `NODE_OPTIONS` arves derimod, så preload-modulet skal loades den vej med en absolut `file://`-URL.
2. **To matrix-jobs må ikke selv oprette issues.** De ville race om det samme `clock-drift-audit`-issue og overskrive hinandens body. Rapporteringen ligger derfor i et separat job der samler begge pakker.
3. **Manglende artifact skal give rødt.** Et matrix-job der crasher før upload har ikke målt noget, og "ingen fejl fundet" er så en løgn.

Baseline efter udvidelsen: frontend 2341/2341, backend 108 + 7161/7161 grønne under klokken +183 dage. Begge pakker er klokke-rene i dag.

## Læringen

**Når en regel markeres 🔒, så tjek at håndhæverens scope er lige så bredt som reglens ordlyd.** En regel der siger "en test" og en guard der kører én pakke er ikke det samme, og forskellen er præcis usynlig, fordi guarden rapporterer grønt.

Konkret at gøre næste gang en 🔒-markering sættes eller læses: læs håndhæverens faktiske scope, ikke dens navn. `clock-drift-test-check.yml` lød dækkende. `working-directory: frontend` var svaret.

Samme spørgsmål er værd at stille de øvrige 🔒-markeringer i AGENTS.md linje 12: dækker hooken eller CI-jobbet hele den flade reglen påstår?

## Resterende

Fire dev-scripts i `backend/scripts/dev/` bærer stadig samme fejlklasse (hardkodet `firstRaceDate: "2026-08-25"`, kaster fra 25/8). Ikke rørt her, fordi kalenderområdet var under aktivt arbejde samtidig. Sporet i #4239.
