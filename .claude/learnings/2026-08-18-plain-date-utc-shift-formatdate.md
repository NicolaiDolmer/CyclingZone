# Postmortem · 2026-08-18 · Ren dato formateret som UTC-midnat viste "dagen før" (#3724)

## Hvad skete der?
Trænings-kvitteringens header på rytterprofilens Træning-fane ("Since 1 May
2026") kunne vise **dagen før** sæson-starten for en spiller i en tidszone
vest for UTC. Kosmetisk, men en forkert dato vist til spilleren. Fundet af
den byggende agent selv i PR #3717, ikke af en spiller.

## Root cause
`seasonStart` kommer fra DB som en ren dato-streng ("YYYY-MM-DD", intet
klokkeslæt). Den delte helper `formatDate()` i `frontend/src/lib/intl.js`
byggede `new Date(dateString)` direkte. Per ISO 8601 parses en dato-ONLY
streng som **UTC-midnat**. Når `Intl.DateTimeFormat` derefter formaterer den
i viewerens LOKALE tidszone, ruller ethvert offset vest for UTC (fx
America/Los_Angeles, UTC-7) kalenderdagen én dag tilbage: "2026-05-01" blev
til "Apr 30, 2026".

`formatDate()` er en delt utility brugt af ~15 player-facing steder
(sæson-start, rytter-udviklingens `trackedSince`/`snapshot_date`,
sæson-finansrapportens `start_date`/`end_date`, m.fl.) — alle ramt af
præcis samme mønster, fordi de alle går gennem samme rene-dato→UTC-parse.

## Fix
`frontend/src/lib/intl.js`: ny `toLocalDate()`-helper der genkender en ren
`YYYY-MM-DD`-streng og bygger `Date`'en af LOKALE år/måned/dag-komponenter
(`new Date(y, m-1, d)`) i stedet for at lade `new Date(streng)` UTC-parse
den. Brugt af `formatDate`, `formatDateTime` og `formatRelativeTime`. Fuld
ISO-timestamps (med `T`/klokkeslæt) rammer ikke regex'en og opfører sig
uændret. Én rod-fix retter alle ~15 kaldesteder på én gang — ingen af dem
skulle ændres enkeltvis.

`frontend/src/pages/PatchNotesPage.jsx` havde allerede det korrekte mønster
(`new Date(\`${iso}T00:00:00\`)` — tvinger lokal-tid-parsing) og var IKKE
ramt; brugt som reference for hvad "rigtigt" ser ud som.

Admin-only rå `new Date(iso).toLocaleDateString(...)`-kald der bypasser
`formatDate()` (fx `SeasonCycleSection.jsx`, `AdminRetentionPage.jsx`,
`GrowthCustomersTab.jsx`) er IKKE rettet i denne PR — de er interne
admin-flader, ikke spiller-vendte, og dermed lavere prioritet end
stretch-issuets scope. Flagget her til evt. senere oprydning.

## Forhindret-fremover
Regressionstest i `frontend/src/lib/intl.test.js` sætter eksplicit
`process.env.TZ = "America/Los_Angeles"` (vest for UTC) og verificerer at
`formatDate("2026-05-01", …)` giver "May 1, 2026", ikke "Apr 30, 2026".
Testen blev kørt mod den UFIXEDE kode først for at bekræfte at den rent
faktisk reproducerer buggen (fejlede med "Apr 30, 2026" som forventet) —
ikke kun at den er grøn efter fixet.

## Læring
En "ren dato" (ingen klokkeslæt) må ALDRIG gå gennem `new Date(streng)`
efterfulgt af lokal-tidszone-formatering — det er implicit en UTC→lokal
konvertering af noget der aldrig var et UTC-tidspunkt. Byg altid Date'en af
lokale komponenter (eller formatér eksplicit i UTC) for kalenderdage. Fordi
`formatDate()` er en ÉT-punkts delt utility, retter roden ALLE kaldesteder
på samme tid — search for "delt lib-fix > per-kaldested-patch" når en bug
sidder i en generisk formatter, ikke i den enkelte komponent der viste den.
