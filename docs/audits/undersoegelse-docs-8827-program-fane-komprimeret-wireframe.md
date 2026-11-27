# Undersøgelse: #8827 Program-fanen (W1 v2), "vanvittig scrolling, enorm tabel"

Spor: `docs/8827-program-fane-komprimeret-wireframe` (kind: investigate, #5220). Ingen kode ændret; kun denne rapport og et levende wireframe i `docs/design/w1-v2-program-komprimeret/`.

## Hvad jeg undersøgte

- PR #8827 (body, filer, ejerens kommentar 27/11: ikke go, "vanvittig mængde scrolling og en enorm tabel") og natfundene i #8847.
- `AllRidersTable` i `frontend/src/components/training/r5/ProgramWeekV2.tsx` på PR-branchen `fix/8813-w1-v2-codex-fund` (linje ca. 1068-1150).
- `docs/design/TASTE.md` (P5, P10/D-047, P12, P18, P21, tjeklisten) og `docs/design/PAGE_TEMPLATES.md` (T2).
- Data: programkataloget i `frontend/src/preview/trainingProgramsMock.js` og pas-navnene i `frontend/public/locales/en/rider.json`. Rytternavnene er opdigtede; ingen spillerdata.

## Årsagen i koden (bekræftet)

`AllRidersTable` skriver alle fem pas pr. dag som én tekst sat sammen med " · " (`dayText`), med `align-top` og ombrydning:

- I dag og I morgen: op til fem pasnavne i én celle, så cellen bliver 4-8 linjer høj.
- Computer: kolonnen "Next days" er en `<ul>` med fem linjer pr. rytter (en linje pr. dag), så hver række er mindst fem linjer høj.
- Telefon: navnecellen har en underlinje "gruppe · Own plan: program" (bryder ejerregel 17/11 og P12), og dagscellerne bliver smalle tekstsøjler.

Reproduceret med et genskabt "før" (samme markup-mønstre, 30 ryttere, preview-katalogets programmer), målt med Playwright:

| Bredde | Før: tabelhøjde | Efter: tabelhøjde | Vandret scroll |
| --- | --- | --- | --- |
| 1440 | ca. 3.300 px | ca. 1.200 px | ingen (begge) |
| 390 | ca. 4.400 px | ca. 1.440 px | ingen (begge) |

Med 45 ryttere (som i #8847) giver før-udgaven ca. 5.000 px på computeren, som natfundet sagde. Ejerens klage er altså reel og skyldes rækkehøjden, ikke antallet af kolonner.

## Forslaget (wireframe, ikke bygget)

Filer: `docs/design/w1-v2-program-komprimeret/wireframe.html` (`?state=before|after`, under 768 px = telefon), `before-*.png`, `after-*.png`, `compare-390.png`, `compare-1440.png`.

- Én linje pr. rytter, 36 px på computeren og 44 px på telefonen (P16).
- Hver dag er én kolonne med ét ord i fuld tekst: dagens hårdeste belastning (Race, Hard, Medium, Easy, Recovery, Rest, No session). Intensiteten findes allerede pr. pas (`INTENSITY`), så intet er opdigtet.
- De fem pas i fuld tekst ligger i hover-kortet (P18) på computeren og i ugen, man åbner ved at trykke på navnet. Det er dér detaljen hører hjemme, ikke i tabellen.
- Egne kolonner, ingen blandede celler: Rider (kun flag og navn, P12), Type, Group, Plan (Group plan / Own plan / No program), Program, og dagene fra i dag (Today, Tomorrow, Friday ... Tuesday). Today har den nedsænkede baggrund.
- Telefon (D-047): navn + tre kolonner (Today, Tomorrow, Program) uden vandret scroll; kolonne-knappen "3/11" bytter resten ind (P21).
- Kontrollerne står i én titellinje inde i rammen (All riders, This week, søg, kolonne-knap). Én gold: Save plan i sidehovedet. Hairlines, ingen skygger ud over hover-kortet, stroke-ikoner, tabulære tal.

## Fix-plan (når ejeren har givet billede-go)

1. `ProgramWeekV2.tsx`, `AllRidersTable`: erstat `dayText` i cellerne med en `dayLoad` (højeste intensitet blandt dagens fem pas, Race over alt), og giv hver dag sin egen kolonne i rækkefølge fra i dag; drop `<ul>`-kolonnen "Next days" og navnecellens underlinje.
2. Byg tabellen på `DataTable` (T2): `mobileDefaults` = Today, Tomorrow, Program; navnekolonnen `sticky: true`; kolonne-knappen i toolbar-slottet. Sorterbar på alle kolonner (tjekliste 7a) i stedet for `data-sort-exempt`.
3. Hover-kort (P18) med dagens fem pas i fuld tekst og "Open the week".
4. Locale: nye nøgler til belastningsordene og Plan-kolonnen (en først, da, plus es/fr/nl) i `trainingR5.json`.
5. e2e `7947-training-w1-v2.spec.ts`: højden af "All riders"-tabellen med fixturen under en loftsværdi pr. projekt, ingen vandret scroll på 390, og billeder 390/1440 til ejeren.

Risiko: lav-middel. Ændringen er kun visning bag den slukkede kontakt `training_w1_v2`; ingen data, motor eller API ændres. Det følsomme er at belastningsordet skal regnes ens med det, ugen og motoren viser (samme `INTENSITY`-kilde, ingen ny regel), og at `DataTable`-skiftet ikke rører de andre faner.

## Dom

bekraeftet + fix-plan
