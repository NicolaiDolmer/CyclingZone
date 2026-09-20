# Sådan tilføjer du en evne

Ejer-krav 13/8: *"vi skal lave systemer fra nu af, så de nemmere kan håndtere at der tilføjes en ny evne."* Denne note er acceptkriteriet for [#3665](https://github.com/NicolaiDolmer/CyclingZone/issues/3665).

Før evne-registret krævede en ny evne redigering af mindst syv parallelle lister der ikke kendte til hinanden — og glemte du én, fejlede intet; den drev bare stille. Nu er det fire skridt.

> ~~**Læs først:** [#3668](https://github.com/NicolaiDolmer/CyclingZone/issues/3668) — rod-fixet bør ske FØR der tilføjes nye evner.~~ **Lukket 15/9.** Forudsætningen er indfriet: undersøgelsen ([`docs/audits/2026-09-15-3668-ability-scale-investigation.md`](audits/2026-09-15-3668-ability-scale-investigation.md)) viste at kontrast-forstærkningen slet ikke kører i prod, og at skævheden i stedet kom fra to additive alders-led i `abilityDerivation.js`. De er fjernet i [#5268](https://github.com/NicolaiDolmer/CyclingZone/issues/5268), og målt over hele bestanden fødes alle fire mentale evner nu i samme spænd som `descending`/`positioning`. En ny evne arver ikke længere en skævhed.
>
> **Det du skal gøre i stedet:** vis at din nye evne fødes i det spænd. Mønstret ligger i `backend/scripts/dry-run-5268-mental-abilities.js` (`birthScaleReport`) — en read-only kørsel mod prod der stiller den nye evnes fødsels-median/p90 op ved siden af `descending` og `positioning`.

## 1. Én registry-post

`backend/lib/abilityRegistry.js` — tilføj en post i `ABILITY_REGISTRY`:

```js
{
  key: "cornering", category: "technical", i18nKey: "rider:racePreview.derived.cornering",
  shortLabel: "COR", icon: "◐", derivation: { source: "skill" },
  inContrast: false, inClassifier: false, storageOrder: 16, displayOrder: 16,
}
```

| Felt | Betyder |
|---|---|
| `key` | kolonnenavnet i `rider_derived_abilities` og evne-nøglen overalt |
| `category` | `physical` · `technical` · `mental` — styrer grupperet visning |
| `i18nKey` | fuld i18n-nøgle til det lange navn (EN først, DA under) |
| `shortLabel` | 2-3 tegns kolonne-label. Oversættes **ikke** (#487) |
| `icon` | glyf til den grupperede evne-visning |
| `derivation` | `{ source: "pcm", stat }` eller `{ source: "skill" }` |
| `inContrast` | med i kontrast-forstærkningen? Se advarslen om #3668 ovenfor |
| `inClassifier` | input til ryttertype-klassifikatoren? **Normalt `false`** — tabellen er frosset, se nedenfor |
| `storageOrder` | plads i `VISIBLE_ABILITIES` (lagrings-/derivations-orden) |
| `displayOrder` | plads i frontendens grupperede visning |

Begge ordener skal forblive `1..n` uden huller — en test håndhæver det.

## 2. Én DB-kolonne

`smallint` på `rider_derived_abilities`, i en idempotent migration. Husk kolonne-grant'en (`riders-column-grant-guard` i CI fanger den hvis du glemmer).

Verificeret 15/9 på `database/2026-09-15-5268-mental-abilities.sql` — den er skabelonen: `ADD COLUMN IF NOT EXISTS`, `GRANT SELECT (kolonne) ON public.rider_derived_abilities TO anon, authenticated`, `COMMENT ON COLUMN`, og `NOTIFY pgrst, 'reload schema'` til sidst. **Kolonnen skal være nullable og uden DEFAULT:** `deriveAbilities` begynder at skrive evnen i samme deploy, så kolonnen skal eksistere før backenden ruller, og en DEFAULT på 0 ville lyve om de eksisterende ryttere (0 er ikke "endnu ikke beregnet"). En NULL evne tæller ikke i `ratingForRole()` — **men det gjorde den indtil [#5321](https://github.com/NicolaiDolmer/CyclingZone/issues/5321)**, fordi `Number(null)` er 0. Den sætning stod her som et løfte koden ikke holdt, og det kostede hele bestandens synlige rating 15-17/9. Nu holder `abilityValue()` den, og to vagter beviser det. Mellemtilstanden er kun sikker så længe evnen også står uden for display-opskrifterne — se trin 4.

**Skal eksisterende ryttere have en værdi, er det ikke SQL-arbejde.** Læg data-migrationen i et Node-script med `--dry-run` som default (mønster: `backend/scripts/dry-run-5268-mental-abilities.js`). To grunde: `auto-migrate.yml` kører SQL'en automatisk ved merge, og en mutation af hele bestanden må ikke kunne ske som bivirkning af en merge; og en SQL-kopi af derivations-formlen ville være en anden kilde til sandhed der driver fra JS'en ved første kalibrering.

## 3. Én derivations-regel

- `source: "pcm"` → tilføj PCM-stat-mapningen i registry-posten; `abilityDerivation.js` samler den op automatisk via `REGISTRY_PRIMARY_STAT`.
- `source: "skill"` → udled evnen i `abilityDerivation.js`' skill-gren.

For en MENTAL evne: giv den sin egen prior (profil + deterministisk, centreret støj salted pr. `(rytter, evne)`) og lad være med at bygge den på alder — det var præcis rodårsagen i #3668. Byg den heller ikke på rå PCM-stats: ejer-beslutning 15/9, *"intet skal være vægtet på PCM-stats mere"*. Profil-leddet skal komme fra de evner der allerede er udledt (`teamwork` ← positioning/tactics/durability, `leadership` ← tactics/positioning; spec §4 trin 1), omregnet med `abilityFrac` så den nye evne lever på samme skala som dem. Konstanterne hører i `MENTAL_PRIOR`, ikke spredt i formlerne, og din evne skal stå EFTER sine kilder i `deriveAbilities`.

**Undtagelsen er dokumenteret og snæver:** `leadership` BRUGER alder, fordi lederskab pr. design er lavt hos unge og topper sent (GDD D-030, spec L1). Vægten er bevidst lille — et tungt alders-led er netop den fejl taktik havde, og gaten (fødsels-median/p90 i samme spænd som `descending`/`positioning`) fælder det. Vil din nye evne også bruge alder, skal begrundelsen stå i en ejer-besluttet spec, ikke i en kommentar, og tallet skal måles mod gaten før merge. Se `docs/PROGRESSION_RULES.md` §1.1.

## 4. Plads i mindst én visnings-opskrift — men først når evnen har værdier på ALLE ryttere

`backend/lib/weights/displayRecipes.js`. **Dette er ikke valgfrit** — vagt 1 fejler bygningen hvis en registry-evne ikke tæller nogen steder.

Vagten findes fordi `positioning` og `tactics` indgik i **nul** af de 8 gamle opskrifter, selvom begge påvirker løbene (positionering dæmper uheldssandsynlighed og indgår i den tekniske finale; taktik indgår i udbruds-villighedens fallback). En spiller kunne træne dem uden at se effekt i noget tal, og intet fejlede.

> ### ⛔ Reglen der kom af [#5321](https://github.com/NicolaiDolmer/CyclingZone/issues/5321) (ejer-go 17/9-2026)
>
> **En ny evne må ikke ind i display-opskrifterne før den har værdier på alle ryttere.**
>
> `displayRecipes` er RATING-tallet spilleren ser.
>
> **Sådan gik det galt 15/9** ([#5268](https://github.com/NicolaiDolmer/CyclingZone/issues/5268)): `teamwork` og `leadership` fik en vægt i fire opskrifter mens kolonnerne var NULL for alle 8.731 eksisterende ryttere. `Number(null)` er 0, så evnen talte som et ægte nul i både tæller og nævner, og hele bestandens synlige rating faldt uden at en eneste rytter havde flyttet sig. Nogle flader viste oven i købet et andet tal end andre, fordi ikke alle flader hentede de to kolonner. Spillerne meldte det i #general dagen efter.
>
> **Den defekt findes ikke længere** — `abilityValue()` (#5321) holder NULL ude af både tæller og nævner, så en vægt på en kolonne der er NULL for hele bestanden ændrer i dag ingen ratings.
>
> **Risikoen der er tilbage er den delvise backfill.** I det vindue hvor nogle ryttere har fået en værdi og andre ikke har, regnes de to grupper på hver sin opskrift-bredde: de udfyldte ryttere flytter sig, de tomme står stille, og to ryttere på samme skærm er ikke sammenlignelige. Det er stadig et synligt tal der ændrer sig uden ejerens go — bare for en delmængde i stedet for for alle.
>
> **Ejerens tre regler (17/9):** (a) én rating overalt, (b) spillernes synlige ratings må aldrig falde uden ejerens vidende, (c) nye evner tæller først med i ratingen når de reelt er i spillet.
>
> **Sådan gør du i praksis:**
>
> 1. Sæt evnens key i `PENDING_DISPLAY_ABILITIES` (`backend/lib/weights/displayRecipes.js`) i stedet for at give den en vægt. Vagt 1 sammenligner PRÆCIST mod den liste, så en evne der falder ud af opskrifterne ved et uheld stadig fælder bygningen.
> 2. Kør data-migrationen (Node-script, trin 2) så alle ryttere har en værdi.
> 3. Først DEREFTER: giv evnen en vægt, fjern den fra `PENDING_DISPLAY_ABILITIES`, og opdatér `frontend/src/lib/__fixtures__/ratingGolden.5321.json` i **samme PR** med et link til ejer-go'et. Golden-testen er rød indtil da — det er meningen.
>
> Golden-fixturen er frosset med vilje. En rød golden-test er ikke støj der skal opdateres væk; den er beskeden om at nogen er ved at flytte et tal på spillerens skærm.

Efter du har rettet opskrifterne:

```bash
node scripts/generate-ability-registry.mjs
```

Vagt 3 (ingen opskrifts evne-sæt må være delmængde af en andens) kan fælde dig selv når du kun TILFØJER: gør du én opskrift bredere, kan en anden pludselig være indeholdt i den. Kør `node --test backend/lib/abilityRegistryGuards.test.js` før du går videre.

## 4b. Antallet er pinnet

`EXPECTED_ABILITY_COUNT` i `abilityRegistryGuards.test.js` skal opdateres i samme PR. Det er med vilje: en evne der forsvinder ved et uheld skal fælde bygningen, ikke bare give et mindre tal. Det samme gælder de to `VISIBLE_ABILITIES.length`-assertions i `abilityDerivation.test.js`. Er antallet nævnt i spillervendt tekst (`help.json` en+da siger "rated 0-99 on N abilities"), skal den følge med — ellers står der et forkert tal på Hjælp-siden fra dag ét.

## Vagterne der holder dig ærlig

Alle kører i `backend-tests` (required check) — `backend/lib/abilityRegistryGuards.test.js`:

1. **Hver registry-evne optræder i ≥1 visnings-opskrift** — undtagen dem der står i `PENDING_DISPLAY_ABILITIES`, og sammenligningen er præcis. Ellers er evnen usynlig for spilleren.
1b. **`PENDING_DISPLAY_ABILITIES` nævner kun keys der findes i registret.** En stavefejl dér ville ellers kunne sluge en ægte orphan.
2. **Hver opskrift-evne har en registry-post.** En stavefejl ville ellers tælle som en manglende evne og trække ratingen skævt.
3. **Ingen opskrifts evne-sæt er delmængde af en andens.** [#3592](https://github.com/NicolaiDolmer/CyclingZone/issues/3592) målte at fire typepar var uadskillelige af netop den grund. Vagten fandt et femte (`climber ⊆ gc`) på sin allerførste kørsel.
4. **Frontend-filerne er genereret, ikke håndholdte.** Byte-sammenligning mod generator-output.
5. **Ratingen pr. rolle er frosset på et fixture-sæt** (#5321) — `frontend/src/lib/ratingNullIsNotZero.5321.test.js` + `backend/lib/ratingFromAbilities.5321.test.js`. De to vagter deler én fixture (`frontend/src/lib/__fixtures__/ratingGolden.5321.json`) og kører både i frontendens og backendens suite. De holder også server og klient på præcis samme tal og på at en NULL-kolonne aldrig tæller som 0.

## Det du IKKE skal røre

De fire vægt-tabeller i `backend/lib/weights/` har hver sit formål og sin egen ejer-dokumentation. En ny evne hører normalt kun hjemme i `displayRecipes`.

| Tabel | Bestemmer | Hvem ændrer den |
|---|---|---|
| `displayRecipes` | rating-tallet spilleren ser | rating-fundament v3 |
| `classifierWeights` | hvilken type en rytter er | **frosset** — kræver eksplicit ejer-ophævelse |
| `capsShapingWeights` | hvordan lofter formes og evner vokser | trinnet efter #3592; kræver prod-mutation og ejer-go |
| `valuationWeights` | markedsværdi | #3448/#3353; kræver bevis for R3 |

Tabellerne **duplikerer** bevidst hinandens indhold i stedet for at dele en literal. Det er hele pointen med splittet: en rettelse ét sted kan ikke smitte af på de tre andre. Rør du en af dem, skal du kunne bevise hvad der flytter sig.

## Kilder

- Spec: `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md` §D2/§D3
- Registret: `backend/lib/abilityRegistry.js`
- Generator: `scripts/generate-ability-registry.mjs`
