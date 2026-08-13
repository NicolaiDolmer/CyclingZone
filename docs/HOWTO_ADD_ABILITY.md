# Sådan tilføjer du en evne

Ejer-krav 13/8: *"vi skal lave systemer fra nu af, så de nemmere kan håndtere at der tilføjes en ny evne."* Denne note er acceptkriteriet for [#3665](https://github.com/NicolaiDolmer/CyclingZone/issues/3665).

Før evne-registret krævede en ny evne redigering af mindst syv parallelle lister der ikke kendte til hinanden — og glemte du én, fejlede intet; den drev bare stille. Nu er det fire skridt.

> **Læs først:** [#3668](https://github.com/NicolaiDolmer/CyclingZone/issues/3668). De 15 evner er ikke på samme skala indbyrdes — de 10 fysiske køres gennem kontrast-forstærkning, de 5 tekniske/mentale gør ikke. Ejer-ønske 13/8: **rod-fixet bør ske FØR der tilføjes nye evner**, så en ny evne fødes ind på en skala der holder. Tilføjer du en evne inden da, arver den skævheden.

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

## 3. Én derivations-regel

- `source: "pcm"` → tilføj PCM-stat-mapningen i registry-posten; `abilityDerivation.js` samler den op automatisk via `REGISTRY_PRIMARY_STAT`.
- `source: "skill"` → udled evnen i `abilityDerivation.js`' skill-gren.

## 4. Plads i mindst én visnings-opskrift

`backend/lib/weights/displayRecipes.js`. **Dette er ikke valgfrit** — vagt 1 fejler bygningen hvis en registry-evne ikke tæller nogen steder.

Vagten findes fordi `positioning` og `tactics` indgik i **nul** af de 8 gamle opskrifter, selvom begge påvirker løbene (positionering dæmper uheldssandsynlighed og indgår i den tekniske finale; taktik indgår i udbruds-villighedens fallback). En spiller kunne træne dem uden at se effekt i noget tal, og intet fejlede.

Efter du har rettet opskrifterne:

```bash
node scripts/generate-ability-registry.mjs
```

## Vagterne der holder dig ærlig

Alle fire kører i `backend-tests` (required check) — `backend/lib/abilityRegistryGuards.test.js`:

1. **Hver registry-evne optræder i ≥1 visnings-opskrift.** Ellers er evnen usynlig for spilleren.
2. **Hver opskrift-evne har en registry-post.** En stavefejl ville ellers tælle som en manglende evne og trække ratingen skævt.
3. **Ingen opskrifts evne-sæt er delmængde af en andens.** [#3592](https://github.com/NicolaiDolmer/CyclingZone/issues/3592) målte at fire typepar var uadskillelige af netop den grund. Vagten fandt et femte (`climber ⊆ gc`) på sin allerførste kørsel.
4. **Frontend-filerne er genereret, ikke håndholdte.** Byte-sammenligning mod generator-output.

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
