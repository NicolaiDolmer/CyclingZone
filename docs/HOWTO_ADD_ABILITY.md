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

Verificeret 15/9 på `database/2026-09-15-5268-mental-abilities.sql` — den er skabelonen: `ADD COLUMN IF NOT EXISTS`, `GRANT SELECT (kolonne) ON public.rider_derived_abilities TO anon, authenticated`, `COMMENT ON COLUMN`, og `NOTIFY pgrst, 'reload schema'` til sidst. **Kolonnen skal være nullable og uden DEFAULT:** `deriveAbilities` begynder at skrive evnen i samme deploy, så kolonnen skal eksistere før backenden ruller, og en DEFAULT på 0 ville lyve om de eksisterende ryttere (0 er ikke "endnu ikke beregnet"). En NULL evne tæller hverken i `ratingForRole()` eller i træningen, så mellemtilstanden er sikker.

**Skal eksisterende ryttere have en værdi, er det ikke SQL-arbejde.** Læg data-migrationen i et Node-script med `--dry-run` som default (mønster: `backend/scripts/dry-run-5268-mental-abilities.js`). To grunde: `auto-migrate.yml` kører SQL'en automatisk ved merge, og en mutation af hele bestanden må ikke kunne ske som bivirkning af en merge; og en SQL-kopi af derivations-formlen ville være en anden kilde til sandhed der driver fra JS'en ved første kalibrering.

## 3. Én derivations-regel

- `source: "pcm"` → tilføj PCM-stat-mapningen i registry-posten; `abilityDerivation.js` samler den op automatisk via `REGISTRY_PRIMARY_STAT`.
- `source: "skill"` → udled evnen i `abilityDerivation.js`' skill-gren.

For en MENTAL evne: giv den sin egen prior (profil + deterministisk, centreret støj salted pr. `(rytter, evne)`) og lad være med at bygge den på alder eller på en anden afledt evne — det var præcis rodårsagen i #3668. Konstanterne hører i `MENTAL_PRIOR`, ikke spredt i formlerne.

**Undtagelsen er dokumenteret og snæver:** `leadership` BRUGER alder, fordi lederskab pr. design er lavt hos unge og topper sent (GDD D-030, spec L1). Vægten er bevidst lille — et tungt alders-led er netop den fejl taktik havde, og gaten (fødsels-median/p90 i samme spænd som `descending`/`positioning`) fælder det. Vil din nye evne også bruge alder, skal begrundelsen stå i en ejer-besluttet spec, ikke i en kommentar, og tallet skal måles mod gaten før merge. Se `docs/PROGRESSION_RULES.md` §1.1.

## 4. Plads i mindst én visnings-opskrift

`backend/lib/weights/displayRecipes.js`. **Dette er ikke valgfrit** — vagt 1 fejler bygningen hvis en registry-evne ikke tæller nogen steder.

Vagten findes fordi `positioning` og `tactics` indgik i **nul** af de 8 gamle opskrifter, selvom begge påvirker løbene (positionering dæmper uheldssandsynlighed og indgår i den tekniske finale; taktik indgår i udbruds-villighedens fallback). En spiller kunne træne dem uden at se effekt i noget tal, og intet fejlede.

Efter du har rettet opskrifterne:

```bash
node scripts/generate-ability-registry.mjs
```

Vagt 3 (ingen opskrifts evne-sæt må være delmængde af en andens) kan fælde dig selv når du kun TILFØJER: gør du én opskrift bredere, kan en anden pludselig være indeholdt i den. Kør `node --test backend/lib/abilityRegistryGuards.test.js` før du går videre.

## 4b. Antallet er pinnet

`EXPECTED_ABILITY_COUNT` i `abilityRegistryGuards.test.js` skal opdateres i samme PR. Det er med vilje: en evne der forsvinder ved et uheld skal fælde bygningen, ikke bare give et mindre tal. Det samme gælder de to `VISIBLE_ABILITIES.length`-assertions i `abilityDerivation.test.js`. Er antallet nævnt i spillervendt tekst (`help.json` en+da siger "rated 0-99 on N abilities"), skal den følge med — ellers står der et forkert tal på Hjælp-siden fra dag ét.

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
