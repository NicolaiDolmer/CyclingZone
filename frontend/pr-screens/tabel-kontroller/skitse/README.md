# Skitser: kontrolområdet over tabeller (#8280)

Levende wireframes: den ægte side i preview-mocken (ingen login, ingen backend, ingen prod-data), hvor kontrollerne over tabellen bygges om i browseren med kittets egne klasser (Select/Input sm, Segmented, DataTable-rammens værktøjslinje) og tokens. Tabellen, rækkerne, flag og mærker er spillets egne. Intet her importeres af appen. Mappen ligger bevidst uden for `frontend/src`: skitsens markup bruger kun klasser, der allerede findes i appens CSS, og #5449-vagten (`tailwind.config.test.mjs`) kræver, at alt med klasser under `src` scannes af Tailwind.

- `sketchLib.mjs`: hjælpere der kører inde i siden (markup, ark, annoteringer, måling).
- `recipes.mjs`: retning A, B og C for Rankings, Rytterdatabase og Mit hold.
- `shots.mjs`: starter Vite i preview-mock-tilstand i samme proces, tager billederne og lukker serveren igen.

Kør (tungt, under semaforen i en bølge):

```
node frontend/pr-screens/tabel-kontroller/skitse/shots.mjs          # alle tre retninger
node frontend/pr-screens/tabel-kontroller/skitse/shots.mjs C        # kun én
```

Uddata: mappen over denne (`frontend/pr-screens/tabel-kontroller/`) (ét billede pr. retning + `maalinger.json`).

**Målingen:** kontrolområdet er afstanden fra bunden af sidehovedet (`main header`) til toppen af første datarække; kontroller er alle synlige trykflader i det område (knapper, selects, felter, faner, skitsens tekst-valg og kolonneoverskrifter med valg). Rankings' tre hub-faner og Mit holds faner tæller med både før og efter.

**Kendte begrænsninger:** preview-mocken har to hold og to ryttere, så billederne viser få rækker; målingen er uafhængig af antallet. `CZ_CHROMIUM` peger på en anden Chromium, hvis Playwrights egen version ikke er hentet på maskinen (scriptet finder ellers selv den nyeste `chromium_headless_shell-*`).
