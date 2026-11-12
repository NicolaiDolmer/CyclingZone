# #7855 trøjejagt efter ejerens tre valg (12/11)

Status: design før kode (AGENTS regel 36). Alt bag den eksisterende slukkede kontakt `jersey_hunt_7855`. Intet tændes her.
Tal, målinger og kalibrering ligger privat: `balance-internals/7855/2026-11-12/` (OneDrive). Her kun i ord.

## Udgangspunkt (uafhængig dom 12/11: IKKE KLAR)

Målt med dommens harness (syntetisk felt, AI-ordrer gennem produktions-adapteren, s5_profiles_v3) mod main, gentaget mod merge-basen i dette spor med samme resultat:

1. **Bjergpoint fra feltet er en fælde.** En hjælper med "Hent bjergpoint" fra start fik ingen bjergpoint i nogen af dommens jagede toppe, fordi udbruddet tager pointpladserne først. Det, der virkede, var "Gå i udbrud" og derefter jagt efter første top, men så gik første top tabt.
2. **Opgaven slår evnen helt.** I samme gruppe stod jægeren altid foran alle andre kæmpende (sprinterkaptajner, trøjeføreren, AI-holdenes jægere), også en svag hjælper foran stærke sprintere. Fire jægere fra samme hold tog feltets fire forreste pladser i hver spurt.
3. **Gratis oven på et hårdt led.** Trætheden regnes efter dagens hårdeste led, så "Hent point, derefter tempo" gav pointene uden ekstra træthed.

Det, der virker og skal blive ved: slukket og "tændt uden valgt jagt" er bit-identisk; andre rytteres tid og placering ændres aldrig af en jæger (kun passagepoint flytter sig); gruppen afgør først.

## Ejerens tre valg og kontrakten

### A. Udbrud og jagt sammen fra start

Reglen "udbrud kan kun være første opgave" består. Jagten bliver en **tilføjelse til udbrudsleddet**, ikke et nyt led:

```
{ task: "breakaway", hunt: "hunt_kom" }      // Gå i udbrud + Hent bjergpoint
{ task: "breakaway", hunt: "hunt_points" }   // Gå i udbrud + Hent point i spurterne
```

- `hunt` er kun gyldig på et udbrudsled (som altid er første led), kun når løbet kører med kontakten, kun for de roller der må få jagt-opgaven, og kun når udbrudsleddets strækning (start til næste leds rutepunkt, ellers mål) har en passage af den art. Fejlkoderne er de eksisterende (`stage_plan_unknown_task` slukket, `stage_plan_task_not_for_role`, `stage_plan_hunt_no_climb`/`_no_sprint`) plus `stage_plan_hunt_needs_breakaway`.
- Motoren: rytteren prøver udbruddet præcis som i dag (`try_break` udledes af første led som før). Hans jagt gælder fra start på udbrudsleddets strækning, i den gruppe han sidder i. Kommer han med, kører han om pointene derfra, også på første top. Kommer han ikke med, kører han om pointene fra sin gruppe.
- Har planen et "når han er sat"-led efter udbrudsleddet, gælder dagens regel: for en udbrudsrytter er "sat" at han ikke er i udbruddet, så jagten slutter, når han ikke kom med. Uden et sat-led jager han hele strækningen.
- Indsatsen er udbrudsleddets (`TASK_EFFORT.breakaway`); prisen for jagten er pr. passage (C).
- Bagudkompatibelt: `legacyOrderFromPlan` er uændret (udbrudsforsøg fra første led). `planWithoutJerseyHunt` fjerner `hunt` (tilbagefaldet ved slukket kontakt eller "stop" er et rent udbrudsled). Gamle rækker uden `hunt` er uændrede.

### B. Evnen afgør mod dem, der kæmper

- En jæger med opgaven kæmper om passagen i sin gruppe, også i feltet, og slår kun dem, der ikke kører med om pointene.
- Mod andre kæmpende i samme gruppe (andre jægere, sprinterkaptajner, frie roller og udbrudsjægere, trøjens fører, AI-holdenes bjergjægere fra #6937) afgør evnen og passagens eksisterende spredning, som mellem to jægere i dag.
- Konsekvens for #6937: en bjergjæger fra stillingen står i dag forrest blandt kæmperne i sin gruppe. I en gruppe, hvor en rytter med opgaven sidder, afgør evnen i stedet mellem alle kæmpende (ellers ville en svagere bjergjæger altid slå en stærkere rytter med opgaven, og omvendt kan den stærkere ikke tabe på opgaven). Uden opgaven i gruppen er #6937 uændret.
- Intet loft på antal jægere. Fire jægere fra samme hold slår kun de ryttere, der ikke kører med.

### C. Hver spurt koster

- Hver passage, hvor opgaven fik rytteren til at køre med (han ville ellers ikke have kæmpet om den i sin gruppe), lægger et lille stykke arbejde i front oveni etapens belastning. Det gælder uanset dagens øvrige led, så jagt aldrig er gratis oven på tempo eller et angreb.
- Et jagt-led tæller selv som Middel i "dagens hårdeste indsats"; passagerne bærer prisen. Kalibreret, så en hel dags jagt alene på en typisk etape svarer til prisordet Hård som i dag (spurt og bjergtop har hver sin størrelse, fordi en typisk dag har én spurt, men flere toppe).
- Passager, han ville have kæmpet om alligevel (i udbruddet, i en lille gruppe, eller fordi rollen kæmper), koster intet ekstra: opgaven ændrede intet dér.
- Indsatsen i løbet er uændret (`TASK_EFFORT.hunt_* = protect`; prisordet Hård står).
- Kanalen: passagen bærer `hunt_work_7855` (ryttere opgaven fik til at køre med). Trætheden lægger det oveni som arbejde i front (`raceFatigue.stageWorkExposure` → `hunt7855`), holdt uden for loftet på andelen i front og arbejdsfaktoren, så en passage aldrig bliver gratis for en rytter, der allerede har kørt meget i front (Codex-review). Uden feltet er belastningen bit-identisk.

## Kendt konsekvens (til ejeren)

Med B giver opgaven kun en plads foran andre, når rytteren ellers ikke ville køre med: i praksis hjælpere i feltet. En sprinterkaptajn med "Hent point", en fri rolle eller udbrudsjæger med jagt i feltet, og alle med jagt i udbruddet kører med alligevel, så opgaven giver dem ingen bedre plads. Med C koster passagerne dem intet ekstra, men indsatsen i løbet er Hård. Det er en lille fælde for de roller. Forslag til næste trin (kræver frontend-kontrakten, som et andet spor ejer): tilbyd kun jagt til roller, hvor den ændrer noget, eller lad leddet køre på rollens egen indsats for dem.

## Bevisplan

- Frossen golden fra merge-basen (`git merge-base`, SHA i PR'en): motor-output og arbejdsandel for alle løbsprofiler med passager, etapeløb (første etape, midt i, sen Grand Tour-etape) og endagsløb, med og uden AI-ordrer og med planer uden jagt. Slukket og tændt uden valgt jagt skal give samme hashes. Fixturen genereres kun i merge-basen.
- Den eksisterende frosne raceRunner-fixture (`raceRunner7855FlagOff.json`) skal stadig være grøn.
- Faste tests for dommens scenarier: jæger mod sprinterkaptajn (evnen afgør begge veje), fire jægere fra samme hold, jagt oven på tempo-led (koster mere end samme plan uden jagt), udbrud med jagt fra start (første top), ikke med i udbruddet (jager fra feltet), #6937-bjergjæger med og uden opgaven i gruppen.
- Kontrakten: `hunt` gyldig og ugyldig, normalisering, tilbagefald, ældre rækker.
- Kalibrering af C måles privat (balance-internals) med dommens harness: hel dags jagt alene mod tempo, jagt oven på tempo mod tempo.

## Næste trin, uden for dette spor

- Frontend (holdplan-sporet): valget "Gå i udbrud + Hent bjergpoint/point" i planen, kopien af kontrakten (`StagePlanModel.ts`, paritetstest), og noten under planen: et udbrud foran tager sine point først; i udbruddet kører han om pointene derfra; kommer han ikke med, kører han om dem fra sin gruppe; han slår kun dem, der ikke kører med; hver spurt koster lidt.
- Hjælp (alle fem sprog) og patch note. Tekstforslag i PR'en.
