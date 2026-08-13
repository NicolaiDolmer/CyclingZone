# Session-prompt — landing 1, resten

**Status:** backend-kernen og farveskalaen er bygget, testet og pushet på `feat/3666-rating-skala-landing1`. Det der mangler er visningsfladerne, #2454, i18n og verifikation.
**Form:** almindelig session (ikke workflow — arbejdet er kendt og enkelttrådet). **Model:** Opus 5.
**Arbejd i worktreet** `C:\dev\CyclingZone-worktrees\feat-3666-rating-skala-landing1`. Branchen er pushet; der findes endnu ingen PR.

---

## Prompt (kopiér ind som første besked)

> Vi færdiggør landing 1 af rating-fundamentet. Læs `docs/sessions/2026-08-14-landing1-fortsaettelse-prompt.md` — den bærer alt der er bygget, besluttet og målt, så du ikke skal regne noget igen.
>
> Arbejd i worktreet `C:\dev\CyclingZone-worktrees\feat-3666-rating-skala-landing1`. Backend og farveskalaen er færdige. Byg resten, kør hele verifikationen, og lav PR'en.
>
> Vis mig visuelt før/efter på de flader du ændrer. Spørg ét ad gangen med anbefaling først.

---

## Hvad der ALLEREDE er bygget — rør det ikke

| Del | Hvor | Status |
|---|---|---|
| Opskriften ind i loft-båndet | `backend/lib/scoutingReport.js` | Færdig. `ratingFromAbilities` delegerer til `ratingForRole` |
| Halvbredder `[9,6,4,3]` | samme fil | Færdig, ejer-besluttet |
| Relativt scout-gulv (#3671) | `backend/lib/scoutEngine.js` | Færdig. Verificeret bit-identisk ved fuld scouting |
| Stjerne-sporet afkoblet | `backend/lib/scouting.js` | Færdig. Rest-båndet er bit-identisk med før |
| Kalibreringen ud af visnings-stien | `backend/routes/api.js:~1806` | Færdig. `calibratedBands` fjernet |
| `precision`-blok til #3671 | `scoutPrecisionInfo` i `scoutingReport.js` | Færdig. Frontend mangler at bruge den |
| `primaryKey` i scouting-rapporten | `api.js` | Færdig (til D4's omlægning) |
| Frontend-modellen | `frontend/src/lib/riderRating.js` | Færdig. Signaturerne er UÆNDREDE, kun implementeringen skiftet |
| Farveskalaen + CI-vagt | `statColor.js`, `statColor.contract.test.js` | Færdig, ejer-godkendt 14/8, 8/8 grønne |
| Backend-tests | | Hele suiten exit 0 |

**Den vigtigste arkitektur-beslutning at kende:** `riderTypeRating(abilities, typeKey)` og `riderOverallRating(rider)` har beholdt deres navne og argumenter. ~20 kaldsteder på tværs af hero, fire tabeller, fire planner-flader, radaren og Udvikling-fanen virker derfor allerede mod den nye model uden at være rørt. Det er den tekniske garanti mod en mellemtilstand med to skalaer. **Lav ikke om på det.**

## Gjort siden kravspec'en blev skrevet (14/8, samme dag)

| Punkt | Status |
|---|---|
| ~~1. Falsy-gates~~ | **Færdig.** Otte steder skiftet til `Number.isFinite` |
| ~~3. Radaren~~ | **Færdig.** 0-40-domæne, ringe på evne-ankrene, egen rolle i guld + "læser højest"-linje. Nye i18n-nøgler `role`/`readsHighest`/`notARanking`, `bestAs` fjernet |
| ~~7. buildVerdict-tærskler~~ | **Færdig.** 2/3/8 lagt ind + boundary-test der pinner dem |
| ~~9. Seed og mock~~ | **Færdig.** Seed regnet med de ægte funktioner; mocken manglede helt en `rider_derived_abilities`-handler, så profilens evner aldrig kunne ses på preview |
| Tests | `statColor.test.js` + `riderRating.test.js` omskrevet. Frontend 1873/1873, backend exit 0 |

**Advarsel om preview:** `preview_start` kører fra **hovedmappen**, ikke fra worktreet. En preview startet den vej serverer `main`s kode og viser derfor ikke dine ændringer. Start dev-serveren med worktreet som cwd, ellers verificerer du den forkerte kodebase. Det kostede tid i sidste session.

## Hvad der mangler — omfang og rækkefølge

Tallene er talt i koden 14/8, ikke skønnet.

| # | Opgave | Omfang | Synlig for ejeren? |
|---|---|---|---|
| 1 | `statPlateStyle`-kaldstederne får form | 14 kaldsteder | **Ja — vis før/efter først** |
| 3 | Scouting-kortet D4 + #3671's UI | 1 komponent, payload klar | **Ja** |
| 2 | #2454 potentiel rating | 10 flader + **ny backend-sti** | **Ja** |
| 4 | Udvikling-fanen | 2 filer, balance-følsomt | Delvis |
| 5 | Dead code | 4 filer + **12 backend-scripts** | Nej |
| 6 | #3667 hjælp/FAQ/patch notes | i18n en+da + NOW.md | **Ja — spillerbeskeden** |
| 7 | Snapshots + e2e | 56 png, 3 specs | Nej |
| 8 | PR med bevis | | |

**Anbefalet rækkefølge: 1 → 3 → 2 → 4 → 5 → 6 → 7 → 8.** Begrundelse: 1 og 3 er små og synlige, så ejeren kan godkende udseendet tidligt. 2 er den tunge og har en backend-afhængighed. Snapshots til sidst — de giver kun mening når alt det visuelle står stille.

**Den skjulte hage i punkt 2:** de otte tabel- og kort-flader får i dag KUN stjerne-enheder fra `POST /api/scouting/estimates`, som ikke engang henter `ability_caps`. Rating-point-båndet findes kun på de to enkelt-rytter-endpoints. Intervallet kan altså ikke vises uden en backend-ændring først. Det er én select (`ability_caps` er en jsonb-kolonne på `rider_derived_abilities`), men det er ikke ren frontend, og det er værd at planlægge som første skridt i punktet.

## Hvad der mangler — detaljer

### 2. `statPlateStyle` er nu en fyldt badge
Den returnerer `backgroundColor` + `color` + `border` i stedet for farvet tal på en tint. Kaldstederne skal have padding og radius så badgen får form — se `RiderProfileHero.jsx:235`, `TeamPage.jsx:605`, `RidersPage.jsx:424`, `WatchlistPage.jsx:269`. **Vis ejeren før/efter.**

### ~~3. Radaren~~ — FÆRDIG 14/8, se statustabellen
- Akse-domænet skal være **fast 0–40**, ikke 0–99 (linje ~44, divisoren). Målt: p90 for en rolle-rating er 29, og kun 10 af 8.747 ryttere ligger over 40 i deres bedste rolle. Med 0–99 kollapser polygonen til under en tredjedel af radius.
- Ringene sættes på evne-ankrene, så ring-afstand betyder det samme som farven.
- **"Best as" skal vise BEGGE ting** (ejer-valg): guld-aksen markerer rytterens EGEN rolle fra `archetype_draw`, og en neutral andenlinje siger hvad han læser højest på lige nu — som observation, ikke dom. Ordet "bedst" bruges ikke. Linjen skjules når de to er samme rolle. Mockup findes i sessionens historik.
- `RADAR_ORDER` er en håndholdt kopi af `DISPLAY_RECIPE_KEYS`. Læs den derfra, eller tilføj en vagt.

### 4. Udvikling-fanen
- `RiderDevelopmentTab.jsx:77` har `Math.max(1, …)` som y-gulv; modellen klamper til [0,99]. Samme gælder alle `[1,99]`-clamps i `developmentProjection.js` (l. 87, 91, 109-110) og `clampInt`-kaldene.
- `RATING_DECLINE_BY_YEARS_PAST_PEAK` (2,5/3,5/4,5 point pr. sæson, `developmentProjection.js:51-55`) er ABSOLUT og kalibreret mod den gamle skala. På den nye er 3,5 point ~25 % af en median-rytters rating — en 32-årig projekteres til gulvet på 3-4 sæsoner. **Skal re-kalibreres, og det er balance-følsomt: mål før du ændrer.**
- `pickChartTypeKeys` (`developmentReport.js:53`) og backendens primærlinje-valg (`api.js:~1868`) er to kopier af samme regel, kun bundet af en kommentar. Ændres den ene uden den anden, tegnes en linje for én rolle med en loft-zone der hører til en anden.

### 5. Scouting-kortet (D4) + #3671's UI
- Omlægning: rytterens **egen rolle stort** (niveau + loft-bånd), de øvrige 7 som støttende kontekst. `primaryKey` ligger allerede i payloadet.
- `RiderScoutingTab.jsx:52` har `pct = v/0.99` — 99 som fuld skala er bagt ind i bar-tegningen.
- #3671's UI: brug `precision`-blokken til at vise hvad næste niveau køber. **Målt: 0 af 180 kombinationer har et værdiløst niveau tilbage**, så den dæmpede knap er et sikkerhedsnet, ikke en normaltilstand. Mockup findes i sessionens historik.
- `e2e/scouting-verdict.spec.js:51-53` asserterer præcis 8 `[data-type]`-rækker og brækker af omlægningen.

### 6. #2454 — potentiel rating erstatter stjernerne
- **10 flader, verificeret.** Ni går gennem `ScoutablePotentiale`; `AcademyPage.jsx:489` og `RiderScoutingTab.jsx:251` kalder `PotentialeStars` direkte.
- `labelAsTitle` bliver **default true** (lukker #2796's anden halvdel). Den er i dag kun sat fire steder, så den kvalitative label står stadig som synlig tekst på Auktioner, Ønskelisten og Sammenlign.
- Vist som **interval** ("kan nå 42-51"), ikke ét tal. Sortering rangerer fortsat **talent** (`_scoutMid`), ikke rolle-potentiale.
- **Rytterdatabasen er undtaget** — `RidersPage.columns.test.js:47-59` forbyder potentiale dér (ejer-doktrin #1138). Det er ikke en fejl.
- `silentFailureContract.2465.test.js:50` kræver ordret `return <PotentialeStars value={null} />;` i `ScoutablePotentiale.jsx` og skal opdateres bevidst.
- **Bemærk kilden:** de otte tabel-/kort-flader får i dag KUN stjerne-enheder fra `POST /api/scouting/estimates`, som ikke engang henter `ability_caps`. Rating-point-båndet findes kun på de to enkelt-rytter-endpoints. Der skal altså en backend-sti til — `ability_caps` er en jsonb-kolonne på `rider_derived_abilities`, så det er én select, ikke en ny join.

### ~~7. buildVerdict-tærskler~~ — FÆRDIG 14/8
Erstat **4/6/12 med 2/3/8**. Fundet ved heltalssøgning der minimerer afvigelsen fra dagens fordeling af domme over hele bestanden; rammer "behold/byd"-gruppen eksakt (3.534 mod 3.534). Uden dem skifter dommen for tusindvis af ryttere uden at nogen har besluttet det.

### 8. Dead code
`typeRatingScale.js`, `typeRatingCalibration.json`, `scripts/buildTypeRatingCalibration.js` og `typeRatingScale.test.js` kan slettes når intet læser dem. **Elleve backend-scripts importerer `ratingFromAbilities`** — fire af dem er prod-mutations- eller dry-run-scripts (`dev/lofter*3591`, `dev/repair*3570`) hvis rapporterede deltaer er i den gamle enhed. Beslut: frys dem med en header-note, eller opdatér dem.

### ~~9. Seed og mock~~ — FÆRDIG 14/8
`seedData.js:1237-1280` (`SEED_PROJECTION` now:70/ceil 78-86, `SEED_SCOUTING_REPORT` kalibrerede tal op til 96) og `mockHandlers.js:386-395` er på den gamle skala. **Ejeren kan ikke godkende visuelt på preview før de er regenereret** — det er en fejl der har bidt før.

## Målt allerede — brug tallene

- Ny skala, n=8.747: nuværende rating p25 9 · median 13 · p90 29 · **maks 85**. Potentiel rating median 44 · p90 65 · maks 85. Median luft nu→loft 29 point.
- **Spec §D1's "bedste rytter viser ~72" er FORKERT** — det er 85, og han er PÅ sit loft (Marcos Ramírez, GC, 85/85). Spec'ens forklaring "toppen står tom fordi ingen har maxet sine evner" er også forkert: toppen står tom fordi ingens LOFTER når 99. Den skelnen skal ind i #3667's tekst, og spec'en skal rettes.
- 0 ryttere mangler `primary_type` eller en evne-række. Ingen migrations-risiko, kun en kontrakt-beslutning.
- **R1-gaten fejler med 1 point:** de 8 opskrifter spænder 7 på median-rytteren, gaten er ≤6. Årsagen er baroudeurens `aggression` (median 17) mod bjergrytterens `climbing` (5) — den skæve evne-skala der er udskudt til #3668. **Rør ikke opskrifterne**; skriv gate-missen i PR-body'en med henvisning til #3668.
- 12 pixel-snapshots × 3 playwright-projekter vil brække på både tal- og farveændringen. De skal fornys i samme PR.

## Gates før PR

`pwsh -File scripts/preflight-pr.ps1` · `npm run lint` i `frontend/` · `node --test` i `frontend/` · **hele** e2e-suiten på alle 3 projekter · backend-suiten (er grøn nu). Skærmbilleder før/efter i PR-body — ejer-krav.

**Husk:** ændres `patchNotes.js` i en PR, SKAL `docs/NOW.md` ændres i samme PR, ellers fejler det required `frontend-build`-check. Vælg patch note-versionsnummeret som det SIDSTE skridt efter rebase — branchen bærer allerede 7.119 og 7.120 fra transparens-arbejdet.

## Åbne punkter til ejeren

1. **#3679** — loft-båndet er inverterbart fra to scout-niveauer. Præ-eksisterende, harness ligger i `backend/lib/ceilingBandInversion.test.js` markeret `todo`. Rettelsen ændrer maskeringens opførsel og er ejer-gated.
2. **R1-missen** (7 mod ≤6) — anbefaling: land med 7 og dokumentér.
3. **Decline-konstanterne** — balance-følsomt, kræver måling før ændring.

## Kilder

#3666 · #2454 · #3667 · #3671 · #3679 · #3664-tråden (de 8 beslutninger) · `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md` · `docs/design/PAGE_TEMPLATES.md`
