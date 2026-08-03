# Parallelle sessioner shippede modstridende sandheder i help-indhold (3/8)

## Hvad skete
To samtidige spor rørte samme spilmekanik samme dag:

- **Batch-session (denne):** #3211 dokumenterede i help/FAQ at chefscoutens rating ALDRIG skærper de viste potentiale-bånd — korrekt på skrivetidspunktet (buildScoutEstimates scout-param blev aldrig sendt fra api.js; fundet under arbejdet, oprettet som #3212). To eksisterende "overclaimende" help-sætninger blev samtidig nedjusteret.
- **Separat session (ejer-startet chip):** fixede wiringen (#3213) og shippede patch note 7.85 der beskrev den NYE adfærd.

#3213 mergede FØR #3211 → i ~40 min modsagde live-hjælpen live-patch-noten: hjælpen sagde "rating skærper aldrig", patch noten sagde "rating skærper nu".

## Rod-årsag
Help-tekster afledt af kode-adfærd blev skrevet i én session, mens en anden session ÆNDREDE selvsamme adfærd. Ingen af siderne kunne se den anden i flight: PR #3211 var grøn og ejer-godkendt, PR #3213 var grønt fix af et åbent issue. Konflikten er semantisk, ikke tekstuel — git og CI kan ikke fange den (forskellige filer).

## Fix
PR #3219: de to nedjusterede guide-afsnit gendannet til originalerne (korrekte igen post-#3213), FAQ-svaret omskrevet fra "Nej" til "Ja, på ét bestemt punkt". Verificeret mod api.js call sites på main.

## Læring / forward-guard
1. **Orkestrator kryds-tjekker indholds-claims mod FRISK main ved merge-tid, ikke ved skrive-tid.** Konkret: før en help/FAQ/patch-notes-PR merges, diff'es dens faktuelle claims mod merges landet på main siden PR'en blev skrevet (her afslørede `scoutPrecisionWiring.routes.test.js` i en git pull konflikten).
2. **Issue-krydsreference virkede:** #3212 blev oprettet med noten "genbesøg help-sætningerne når wiring fixes" — det var den tråd der gjorde konflikten synlig med det samme. Bliv ved med at skrive den slags koblinger på issues.
3. **Mekanik-dokumenterende PRs bør nævne den kode-SHA de er verificeret mod** (i Brugerverifikation-sektionen), så en semantisk race kan opdages mekanisk.
