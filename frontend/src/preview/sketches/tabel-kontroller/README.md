# Skitser: kontrolområdet over tabeller (#8280)

Levende wireframes: den ægte side i preview-mocken (ingen login, ingen backend, ingen prod-data), hvor kontrollerne over tabellen bygges om i browseren med kittets egne klasser (Select/Input sm, Segmented, DataTable-rammens værktøjslinje) og tokens. Tabellen, rækkerne, flag og mærker er spillets egne. Intet her importeres af appen; filerne er `.mjs`, så hverken Tailwind, appens bundle eller slop-vagterne ser dem.

- `sketchLib.mjs`: hjælpere der kører inde i siden (markup, ark, annoteringer, måling).
- `recipes.mjs`: retning A, B og C for Rankings, Rytterdatabase og Mit hold.
- `shots.mjs`: starter Vite i preview-mock-tilstand i samme proces, tager billederne og lukker serveren igen.

Kør (tungt, under semaforen i en bølge):

```
node frontend/src/preview/sketches/tabel-kontroller/shots.mjs          # alle tre retninger
node frontend/src/preview/sketches/tabel-kontroller/shots.mjs C        # kun én
```

Uddata: `frontend/pr-screens/tabel-kontroller/` (ét billede pr. retning + `maalinger.json`).

**Målingen:** kontrolområdet er afstanden fra bunden af sidehovedet (`main header`) til toppen af første datarække; kontroller er alle synlige trykflader i det område (knapper, selects, felter, faner, skitsens tekst-valg og kolonneoverskrifter med valg). Rankings' tre hub-faner og Mit holds faner tæller med både før og efter.

**Kendte begrænsninger:** preview-mocken har to hold og to ryttere, så billederne viser få rækker; målingen er uafhængig af antallet. `CZ_CHROMIUM` peger på en anden Chromium, hvis Playwrights egen version ikke er hentet på maskinen (scriptet finder ellers selv den nyeste `chromium_headless_shell-*`).
