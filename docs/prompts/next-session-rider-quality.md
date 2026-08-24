# Prompt til næste session — rytter-generering og måleinstrumentet

> Skrevet 24/8 som handoff fra Supabase-fejltriage-sessionen. Copy-paste hele denne fil som første besked.

---

## Kontekst du skal kende

Forrige session startede med "er der noget galt på Supabase?" og endte med at reparere Division 4 i prod. Undervejs afdækkede den en række problemer i rytter-generering og i de vagter der skal beskytte den. Dit arbejde bygger videre derfra.

**Læs først:** `docs/RIDER_GENERATION.md`. Det er et nyt SSOT for hvordan ryttere skabes, og det bærer kilde på hver påstand (fil:linje, commit-hash eller målekommando). Afsnit 7 lister fire kodekommentarer der siger det stik modsatte af koden under dem. Afsnit 8 lister hvad vi ikke har afklaret. **Dokumentet ligger i PR #4179 som er draft — læs det fra branchen `feat/4178-navne-pools`.**

**Hvad der blev lavet i prod 24/8 (#4172):** Alle 48 Division 4-hold sad i pulje A og B; C-H havde nul. Rod-årsag: `d4PoolCount = 2` i `pyramidCompression.js:255`. Holdene er spredt til 8 puljer à 24, og puljerne er fyldt med 2.880 **eksisterende frie** ryttere i stedet for nygenererede. S3-løb uden tilmeldinger gik fra 157 til 1.

## Den centrale erkendelse

**Vi kan i dag ikke måle om en ændring forbedrer eller forværrer spillet.**

`npm run race:gate` kører tre hardcodede seeds. Målt på 30 tilfældige seeds fejler den på **6 af 30** med koden på main. De tre CI-seeds er tilfældigvis blandt de heldige.

Da vi udvidede rytter-navnelisterne, faldt gaten. Vi målte 24 mod 19 beståede af 30 — men kan ikke afgøre om det er reel forringelse eller støj, fordi instrumentet støjer mere end signalet. Gaten kan hverken frikende eller dømme en ændring.

Det blokerer alt videre kvalitetsarbejde på motoren. Derfor er det første opgave.

## Opgaver, i anbefalet rækkefølge

**1. Gør `race:gate` troværdig (#4180).**
Enten markant flere seeds med dom på aggregatet, eller bånd der afspejler den reelle seed-varians. Kravet er at gaten skal kunne skelne en ægte regression fra tilfældig variation. Mål før og efter: hvor mange af 30 tilfældige seeds består?

**2. Adskil navne-RNG fra stat-RNG (#4180).**
Navne og rytterstats trækker fra samme strøm, så længere navnelister giver færre navnekollisioner, færre RNG-kald, og en forskudt strøm: samme seed producerer helt andre ryttere. En ren tilføjelse af navne bør ikke kunne ændre en eneste rytters stats. Bemærk at selve adskillelsen flytter populationen én gang — det er uundgåeligt.

**3. Genoptag PR #4179 (navne-pools, #4178).**
Den udvider fra 15 til 22 clusters og 18×28 til 40×60 pr. cluster. Verificeret: 52.800 kombinationer, nul dubletter, 6.438 backend-tests grønne, og 0 % kunstige mellem-initialer ved 10.000 ryttere mod dagens 34 %. Den er kun draft fordi gaten faldt. Når 1 og 2 er på plads, kan den måles ordentligt og merges.

**4. Ryd de forældede sandheder.**
- Fire kommentarer i `riderValuationTypeDampening.js:3`, `starterSquadAllocator.js:45`, `routes/api.js:518` og `:523` (se RIDER_GENERATION.md §7)
- `GAME_INVARIANTS.md` siger base_value bruger "model v3". Det har været forkert siden 25/7 — derive-kæden loader V4. **Filen er frossen, så spørg ejeren før du retter.**
- Lære: skriv hvor et feature-flag *bor*, ikke hvad det *står på*.

**5. Forward-guard på `d4PoolCount` (#4172, #4159).**
Defaulten skal være antallet af D4-puljer, ikke 2, ellers gentager S3→S4 præcis samme fejl. Hører sammen med #4159's tredobbelte vagt.

**6. `all_races_completed` mangler empty-pool-undtagelsen.**
`seasonTransitionReadiness.js:107` tæller råt `.neq("status","completed")` uden det filter som `assessSeasonEndBlockers` fik i #3038. `inEmptyPool` er desuden ordret duplikeret i `stageScheduler.js:150` og `seasonTransitionReadiness.js:167`. Saml dem ét sted.

## Åbne spørgsmål du skal tage stilling til med ejeren

**`TYPE_MEAN_ADJUST` (RIDER_GENERATION.md §8).** Generatoren justerer tier-basen pr. arketype som modvægt mod **v3**-modellens type-offsets. Men den aktive model er V4, og 23/8 blev type-dæmpningen slået til, som regulariserer offsets mod 0. Modvægten kan kompensere for noget der ikke længere er der. Målt: sprintere er nr. 6 af 8 typer på værdi i den nuværende generator, mod nr. 8 af 8 i den gamle bestand. Rammer kun tier 1/2, da tier 3/4 klemmes til et fire-points vindue.

**Skal Division 4 have flere ryttere pr. AI-hold?** De 144 nye AI-hold fik 20 ryttere hver (ikke `AI_SQUAD.TOTAL_SIZE` = 24), fordi der kun var 3.183 brugbare frie. Der er 303 frie tilbage på markedet.

## Faldgruber der bed i forrige session — undgå dem

**Stol ikke på kodekommentarer.** Fire af dem løj direkte. Verificér i koden eller mål det.

**Mål på frisk data.** En analyse af rytterværdier blev brugt som bevis for at generatoren var skæv. Den byggede på 6.530 ryttere skabt under ældre regler, hvoraf nul var skabt siden det relevante flip. Konklusionen var forkert. Spørg altid: *hvornår blev disse tal til?*

**PostgREST topper stille ved 1000 rækker.** Et naivt `.select()` rapporterede 1000 tilmeldinger i stedet for de faktiske 4.982. Brug `fetchAllRows` fra `supabasePagination.js` med en stabil `.order()`.

**Kør generalprøven.** Den fangede en fejl der ville have efterladt prod i halv tilstand natten før sæsonstart. Den er ikke ceremoni.

**Søg dubletter grundigt før `gh issue create`.** #4172 blev oprettet uden at finde #4170, som beskrev samme problem fra symptom-siden.

**Skriv ikke et SSOT ud fra formodning.** Tre moduler blev listet i ejerskabstabellen uden at være åbnet; ét af dem viste sig at være dev-tooling. Ejeren skal ikke være orakel — hver påstand skal kunne efterprøves uden nogens hukommelse.

## Praktisk

- `stage_scheduler_enabled` blev sat `off` af #4172-scriptet. Verificér at ejeren har tændt den igen før du gør noget andet.
- Auto-mode-classifieren blokerer `--live`-kørsler og redigering af `.claude/settings.json`. Bed ejeren køre eller give adgang; omgå den ikke.
- `sanitize-secrets.sh` giver falsk positiv på lange filnavne (ramte et almindeligt `ls backend/scripts/`). Værd at justere mønsteret.

## Start med at spørge

Før du går i gang: spørg ejeren om prioriteringen mellem **måleinstrumentet** (opgave 1-3, som låser op for alt videre motorarbejde) og **oprydningen** (opgave 4-6, som er billigere og fjerner kendte fælder). Stil ét spørgsmål ad gangen, med tallene inde i selve spørgsmålet.
