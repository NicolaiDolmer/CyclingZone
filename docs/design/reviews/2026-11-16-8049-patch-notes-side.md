# #8049 · Ny patch notes-side: designnote (16/11)

> Status: **skitse, intet produktkode.** Bygger videre på den skitse, ejeren godkendte 12/11
> (`patchnotes-mock.png` variant A "efter område" + `patchnotes-arkiv.png` "sådan bliver siden ikke for stor",
> i den delte private mappe `private-handoffs/2026-11-12-pc1-session/pr-review/`). Epic: #954.
> "Set" pr. bruger (#6515) er allerede leveret i PR #8169 og genbruges her, den bygges ikke igen.

## Billeder

| Fil | Hvad |
|---|---|
| `pr-screens/8049/foer-efter-1440.png`, `foer-efter-390.png` | Før (live 16/11) og efter (variant A) side om side, lys |
| `pr-screens/8049/foer-{1440,390}-{lys,moerk}.png` | Den nuværende side på cyclingzone.org (offentlig, hentet 16/11) |
| `pr-screens/8049/efter-A-{1440,390}-{lys,moerk}.png` | Variant A, første skærm |
| `pr-screens/8049/efter-A-1440-lys-noter-hele.png` | Variant A, hele siden med nummererede noter 1-7 |
| `pr-screens/8049/efter-A-390-lys-hele.png` | Variant A, hele siden på telefon |
| `pr-screens/8049/efter-B-{1440,390}-lys*.png` | Variant B (kompakt tabel pr. område) |
| `pr-screens/8049/efter-arkiv-oktober-1440-lys.png` | Arkivet med oktober foldet ud |
| `pr-screens/8049/efter-soeg-1440-lys.png` | Søgning ("auto-pris") på tværs af uger og arkiv |

Levende skitse: `pr-screens/8049/patch-notes.html` (åbn i en browser; knapperne nederst til højre skifter
variant, lys/mørk og noter). Den bygges af `pr-screens/8049/build-sketch.mjs` ud fra den rigtige
`frontend/src/data/patchNotes.js`, så alle tekster, datoer og antal er ægte. "I dag" er 16/11, og spillerens
sidste besøg er sat til 13/11 for at vise "Nyt siden sidst".

## Spillerløftet

Efter dette kan spilleren på ét blik se, hvad der er nyt i ugen inden for det område, de går op i (Taktik,
Træning, Marked …), og finde en gammel note med søgning. Før var siden en lang liste af dage (15.760 px høj på
computer), hvor samme note dukkede op som ny igen på telefonen.

## Siden (variant A, ejerens valg 12/11)

T1 (896 px), den kanoniske PageHeader og to section cards (fold-disciplinen):

1. **Sidehoved**: "Patch notes" + én linje. Højre side: én stille knap "13 nye siden sidst" med den gule
   ulæst-prik (samme prik som i menuen). Tryk viser kun de nye. Ingen banner (regel 12/11, #8070).
2. **Filterlinje på én linje**: søg (også i arkivet) · område (vælger, ikke 12 chips der ombrydes) · "Kun beta"
   (findes i dag og bevares).
3. **Kort 1, "Denne uge"** (mandag-søndag): ugens store nyhed øverst med plads til et billede fra spillet, så ét
   afsnit pr. område i fast rækkefølge, højst 3 linjer pr. område (titel + én linje tekst), "+N mere i X", og
   fejlrettelser foldet til én linje pr. område ("3 rettelser: A · B · C", "vis").
4. **Kort 2, "Tidligere uger"**: de 4 forrige uger som én linje hver (antal, de 2 vigtigste, de 3 største områder),
   tryk åbner ugen. Under en hårlinje: **arkivet pr. måned**, hvor en måned hentes først, når den åbnes.
   April til juli står som én linje, der foldes ud til månederne.

Mærker (én anatomi, hairline-pille): **Tændt for alle** (grøn), **Nyt** (blå), **Beta** (gul), **Forbedring** og
**Fejlrettelse** (neutrale). Kun tre farvesignaler, ingen guld.

### Afvigelser fra skitsen 12/11 (for at følge TASTE og PAGE_TEMPLATES)

- Ugens store nyhed står på en neutral flade (`--bg-subtle`), ikke guld-tonet (TASTE P3: aldrig guld-tint).
- Område-chips er en vælger i filterlinjen; 12 chips fylder to linjer på computer og fire på telefon (P1).
- "Nyt siden sidst" sidder i sidehovedets knaprække, ikke som kasse over indholdet (ingen bannere, 12/11).
- Arkivet ligger i samme kort som de forrige uger (højst 2 kort, fold-disciplinen).

### Variant B (til sammenligning)

Samme side, men ugen vises som en kompakt tabel: én række pr. område med det vigtigste og antal pr. mærke;
tryk folder området ud. Målt i skitsen med den rigtige uge 9.-15. nov (49 ændringer): A er ca. 1.650 px høj,
B ca. 600 px. B er hurtigere at skimme, men skjuler teksterne bag et tryk.

**Anbefaling: A for "Denne uge" (det er den, man læser), B når man åbner en ældre uge eller en arkivmåned**
(der leder man efter noget og vil have overblik først).

### Mandagsreglen

Mandag 16/11 har ugen kun 5 ændringer, mens sidste uge har 49. Er denne uge under 10 ændringer, står sidste uge
også åben (billederne viser det). Alternativ: "de seneste 7 dage" i stedet for kalenderuger.

## Kortlægning: siden og data i dag

- `frontend/src/pages/PatchNotesPage.jsx` (346 linjer): én kortliste pr. dag, kategori-segment (Alle/Nyt/Forbedret/
  Rettet), "Kun beta", søgning i titel/tekst/emne. Henter hele `/patch-notes.json` ved hvert besøg.
- `frontend/src/data/patchNotes.js` (2,2 MB kilde) er SSOT; `frontend/vite-plugins/patch-notes-json.js` udsender
  `patch-notes.json` (1.733 KB, **538 KB gzip**, 419 KB brotli) og `patch-notes-meta.json` ({version, date}) i build.
- 16/11: **1.025 versioner, 2.668 ændringer, 2.335 spillervendte** (17/4 til 16/11).
- Felter pr. ændring i dag: `category` (alle: new/improved/fixed), `audience` (alle), `da` (alle), `en` (1.719;
  658 spillervendte gamle noter har kun dansk), `topic` (2.119), `rollout` (494: live, beta, beta_to_live,
  switched_on, event), `flag` (20), `stage` (4 gamle beta), `refs`. **Intet `area`, intet billedfelt.**
- `topic` er fri tekst (over 350 forskellige værdier; før september også overskrifter som "i18n Fase 3c …").
  Fra september er det et lille fast sæt (Races, Training, Interface, Riders, Transfers, Board …).
- Mærket findes allerede: `rollout` beta → Beta; switched_on/beta_to_live → Tændt for alle; ellers `category`
  new/improved/fixed → Nyt/Forbedring/Fejlrettelse. Fordelingen af de 2.335: Fejlrettelse 887, Forbedring 941,
  Nyt 425, Tændt for alle 55, Beta 27.

### Sådan mappes de 2.335 noter til områderne

Backfill-tabel `topic` → område (står i `build-sketch.mjs` som `TOPIC_AREA`), uden at røre den gamle tekst:

| Område | Fra `topic` |
|---|---|
| Taktik | Tactics, Planning, Race selection, Team selection, Squad selection, Season planner, Assistant |
| Løb og løbsfilm | Races, Racing, Race results, Results, Race calendar, Calendar, Standings, Rankings |
| Løbsmotor | Race engine (kun 3 gamle; nye noter vælger selv) |
| Træning | Training |
| Udvikling | Riders, Rider development, Rider values, Ratings |
| Marked | Transfers, Auctions, Market, Transfer market, Scouting, Contracts, Watchlist |
| Akademi og ungdom | Academy, Youth teams |
| Bestyrelse | Board, The board, Boardroom |
| Økonomi | Economy, Finance, Finances, Sponsors, Staff |
| Brugerflade | Interface, UI, Dashboard, Notifications, Inbox, Team, Squad, Season, Forum, Onboarding … |
| Mobil | Mobile, Mobile polish, App |
| Hjælp | Help |

Dækning: **97 % siden 1/10, 95 % siden 1/9, 62 % i alt.** Hullet er april-august: 496 noter uden `topic` og
de lange overskrifts-emner. De lander i en reserve (se ejer-spørgsmål 5). "Races" blander løbsmotor og løbsfilm;
historikken lægges i Løb og løbsfilm, og nye noter vælger selv Løbsmotor.

## Datamodel

Nye, valgfrie felter på en ændring i `patchNotes.js` (dokumenteres i `docs/PATCH_NOTES_RULES.md` §2b):

- `area`: én af `tactics, races, engine, training, development, market, academy, board, economy, interface,
  mobile, help`. **Krævet på nye spillervendte noter** (samme CI-vagt som `rollout`, `scripts/check-patch-notes-version.js`).
  Gamle noter røres ikke; siden bruger backfill-tabellen.
- `highlight: true`: redaktørens valg af ugens store nyhed. Uden det vælger siden selv: Tændt for alle > Nyt >
  Beta > Forbedring, nyeste først.
- `image`: sti til et billede under `frontend/public/patch-notes/img/` (webp, højst ca. 60 KB, EN/DA-neutralt,
  ingen holdnavne). Uden billede vises nyheden uden billedfelt.
- `replaces`: version#index på en beta-note, som denne "Tændt for alle"-note afløser. Står begge i samme uge,
  vises kun den nye. (Skitsen gør det i dag ud fra `flag`, men kun 20 noter har et flag.)

Mærket afledes som i dag (ingen ny `type`), så der er én sandhed.

## Filopdeling (genereret i build, aldrig håndredigeret)

`vite-plugins/patch-notes-json.js` udsender pr. sprog (en og da; manglende sprog falder tilbage som i dag):

| Fil | Indhold | Målt gzip (16/11) |
|---|---|---|
| `patch-notes/recent.<lang>.json` | denne uge + 5 forrige, kun spillervendte | **ca. 25 KB** |
| `patch-notes/index.<lang>.json` | måneder med antal + titelindeks til søgning (dato, titel, område) | ca. 41 KB, hentes først ved søgning |
| `patch-notes/<YYYY-MM>.<lang>.json` | én arkivmåned | 15-54 KB (oktober 23 KB) |
| `patch-notes-meta.json` | uændret + `seenKey` (se nedenfor) | under 1 KB |

Åbning af siden henter altså ca. 25 KB i stedet for 538 KB (mål på issuet: under 80 KB). Den gamle
`patch-notes.json` udsendes, indtil kontakten er tændt for alle, og fjernes så. En test låser budgettet
(`recent` under 40 KB gzip), så det ikke langsomt vokser igen.

## Søgning i arkivet

Første tastetryk (debounce 250 ms) henter `index.<lang>.json` og viser træf på titler med det samme, med uge
eller måned som kilde. Træf i de seneste 6 uger søger også i brødteksten (den er allerede hentet). "Søg også i
teksten" henter arkivmånederne efter behov (i alt ca. 250 KB, kun når spilleren beder om det). Ingen server-endpoint.

## "Nyt siden sidst" via `seen_markers`

- Genbruger `markSeen("patch_notes", …)` og `useSeenMarkersSynced` fra `frontend/src/lib/seenMarkers6515.ts`
  (PR #8169). Telefon og computer er enige; localStorage er hurtig kopi og reserve. Ingen migration.
- Knappen "N nye siden sidst" og den gule prik pr. linje tæller ændringer nyere end markøren. Første besøg
  nogensinde: ingen prikker (som `computeNewDays` i dag), men menuens prik vises (som i dag).
- **Rettelse samme dag:** markøren er i dag kun en dato, så en note, der lander senere samme dag, end man
  kiggede, er ikke "ny". `patch-notes-meta.json` får `seenKey` = dato + løbenummer inden for dagen skrevet som
  klokkeslæt (fx `2026-11-16T00:03` for dagens 3. version). Det passer i den eksisterende `MARKER_PATTERN` i
  `backend/lib/seenMarkers6515.js`, sammenlignes som streng og kræver ingen backend-ændring. Teknisk valg, ikke
  et ejer-spørgsmål.
- **Ulæst-prikken i menuen** (`patchNotesUnread.js`, Layout) bruger samme `seenKey` og samme markør, så prik og
  side altid er enige.

## Kontakt til udrulning

Frontend-kontakt `patch_notes_v2_8049` via `loadAnonymousFlags` (siden er offentlig, også udlogget):
`off` = den gamle side bit for bit; `beta` = ny side for beta-testere; `on` = alle. Ingen spillerdata ændres,
ingen motor, ingen penge. Den gamle side og `patch-notes.json` slettes i oprydnings-PR'en efter `on`.

## Byggeplan i små PR'er

1. **Data og regler**: felterne `area`, `highlight`, `image`, `replaces` i `PATCH_NOTES_RULES.md` §2b, CI-vagt
   der kræver `area` på nye spillervendte noter, backfill-tabellen i `lib/patchNotes.js` med test af dækningen.
   Ingen synlig ændring.
2. **Filerne**: pluginet udsender `recent`, `index` og månedsfiler pr. sprog + `seenKey`; størrelses-test.
   Den gamle fil bliver. Ingen synlig ændring.
3. **Siden bag kontakten** (`off`): ny side (uge, område, nyhed, foldede rettelser, tidligere uger, arkiv,
   søgning, "Nyt siden sidst"), EN/DA-nøgler i `patchnotes`-navnerummet. Rigtige skærmbilleder 1440/375, lys og
   mørk, til ejeren før merge.
4. **Beta**: kontakten til `beta`, se den virke; patch note samme dag.
5. **Tænd for alle + oprydning**: `on`, slet gammel side og `patch-notes.json`, flyt registret.
6. (Eget spor, venter på #8022) "Ugens vigtigste" på dashboardet.

Ny tekst i brugerfladen (EN først, DA under): This week / Denne uge · Earlier weeks / Tidligere uger ·
Archive / Arkiv · N new since your last visit / N nye siden sidst · Search all patch notes, including the
archive / Søg i alle patch notes, også arkivet · N fixes / N rettelser · N more in X / N mere i X ·
Open week / Åbn ugen. Områdenavne og mærker som i tabellerne ovenfor (EN i `build-sketch.mjs`).

## Ejer-spørgsmål (med anbefaling)

1. **Ugens opbygning: A (linjer pr. område) eller B (kompakt tabel)?** Anbefaling: A for "Denne uge", B når en
   ældre uge eller måned åbnes.
2. **Mandagsreglen: står sidste uge også åben, når denne uge har under 10 ændringer?** Anbefaling: ja.
   Alternativ: "de seneste 7 dage".
3. **Ugens store nyhed: vælger siden selv, eller sætter vi den?** Anbefaling: siden vælger selv (Tændt for alle
   > Nyt > Beta), og `highlight` kan overstyre.
4. **Billeder: hvor kommer de fra?** Anbefaling: kun ved ugens nyhed, genbrug det skærmbillede, ejeren allerede
   har godkendt på PR'en (uden holdnavne), højst ca. 60 KB.
5. **Gamle noter uden område (april-august, ca. 500): bedste gæt eller "Andet"?** Anbefaling: "Andet", og kun
   i arkivet. Et forkert område er værre end et ærligt "Andet" (TASTE P11).
6. **Beta-note og "Tændt for alle"-note i samme uge: vis kun den sidste?** Anbefaling: ja.

## Hvad skitsen ikke viser

- Engelsk udgave (samme opbygning; skitsen er på dansk til ejeren).
- Rigtige billeder ved nyheden (pladsholder).
- Udlogget visning og første besøg uden markør.
- Telefon: første område starter ca. 700 px nede, fordi nyheden fylder; kan strammes i byg-PR'en.
