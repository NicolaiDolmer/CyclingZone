# 2026-09-17: Rating faldt 2-4 point for alle spillere uden at nogen godkendte det (NULL talte som 0)

## Hvad skete

PR #5280 (15/9) tilføjede Holdarbejde og Lederskab som evne-kolonner og gav dem samtidig vægt 1 i display-opskrifterne for fire roller (sprinter, gc, climber, rouleur). Alle eksisterende ryttere havde NULL i de to kolonner. Kommentaren i `backend/lib/weights/displayRecipes.js` antog at NULL ville blive sprunget over.

Den genererede `ratingForRole` gjorde `Number(abilities[ability])`, og `Number(null) === 0` er et finite tal. NULL talte derfor som 0 i både tæller og nævner. Resultat: alle flader der hentede de to kolonner (Mit hold via `ABILITY_SELECT`, Scouting-fanen via backend) viste 2-4 point lavere rating end før tirsdag. Rytterprofilens hero hentede kun de 15 gamle kolonner (eksplicit select), så dér var værdien `undefined` → NaN → sprunget over → det gamle tal. Samme rytter: 44 på Oversigten, 41 på Mit hold.

Spillerne opdagede det 16-17/9 (mandia1984, knud_r_flink, egomadsen, thelamba i #general). Ejeren så det først som "to flader viser forskelligt" (#5321). Den reelle skade var større: et usynligt ratingfald for hele populationen, sprintere og GC-ryttere hårdest.

## Hvorfor det slap igennem

- Ingen test frøs den synlige rating for et fixture-sæt. Opskriftsændringen var "kun en vægt", og der var ingen gate der målte konsekvensen på tallet spilleren ser.
- `Number(x)`-koercion før `isFinite` er en klassisk faldgrube. Den lå i generatorens template, så frontend og backend delte fejlen.
- Backfill-rækkefølgen var forkert: display-vægte kom ind FØR data (point-flytningen #5268 var stadig kun dry-run).
- Orkestratorens første hypotese (cachet chunk) var forkert; ejerens hard-reload-test afkræftede den på 2 minutter. Måling mod prod-rækken med begge opskrifter (44/41) var det der pegede rigtigt.

## Rettelse (PR #5352, ejer-go 17/9 kl. 19:35)

1. De fire vægte fjernet igen; opskrifterne verificeret byte-identiske med før 15/9. Evnerne bliver som data.
2. `abilityValue()`: kun tal (eller tal-strenge) tæller; `null`/`undefined`/tom streng/NaN springes over; ægte 0 tæller stadig.
3. Golden-guard: `frontend/src/lib/__fixtures__/ratingGolden.5321.json` fryser rating pr. rolle for 10 syntetiske ryttere (alle 8 roller, tre række-former). Læses af frontend- og backend-test (paritet). Header: må kun opdateres med henvisning til et ejer-go.
4. `docs/HOWTO_ADD_ABILITY.md`: en ny evne må ikke ind i display-opskrifterne før den har værdier på alle ryttere; opskrift + data-migration i samme PR med ejer-go.

## Regel (ejer 17/9, ordret)

"Jeg vil have, at rating er det samme overalt. Jeg vil ikke have, at spillernes ratings de kan se pludseligt er faldet over hele siden. Det må de ikke bare gøre uden jeg ved det. Skal aldrig kunne ske igen. ... De nye evner skal først regnes med, når de rent faktisk er inde i spillet."

## Forward-guard-tjek

- Golden-testen kørt rød med vilje (én vægt sat tilbage) og grøn igen efter restore.
- Backwards-check: alle flader der viser rating bruger `ratingForRole`/`ratingFromAbilities` (kortlagt i PR #5346's body); planlægger og træningsside havde egne formler og er rettet i #5346.

Refs #5321 #5351 #5280 #5268 #5352 #5346
