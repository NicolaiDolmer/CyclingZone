# Skitser: kontrolområdet over tabeller (#8280)

Levende wireframes: den ægte side i preview-mocken (ingen login, ingen backend, ingen prod-data), hvor kontrollerne over tabellen bygges om i browseren med kittets egne klasser (FilterBar, Segmented, Select, Input, DataTable-rammen). Intet her importeres af appen; filerne er `.mjs`, så hverken Tailwind, appens bundle eller slop-vagterne ser dem.

Kør (tungt, under semaforen i en bølge):

```
node frontend/src/preview/sketches/tabel-kontroller/shots.mjs          # alle tre retninger
node frontend/src/preview/sketches/tabel-kontroller/shots.mjs A        # kun én
```

Scriptet starter selv Vite i preview-mock-tilstand i samme proces, tager billederne og lukker serveren igen. Uddata: `frontend/pr-screens/tabel-kontroller/`.
