# Session-prompt — rytterne skal kunne stoles på, nu

**Ejer-mandat 13/8, ordret:** *"Jeg vil gerne have, at managers stoler på deres ryttere fra i dag af. … Jeg vil bare have at vide, at der er styr på rytterne i dag. Det er det managers er lovet."*

**Form:** workflow-session — ejeren har eksplicit godkendt multi-agent-orkestrering. **Model:** Opus 5, høj reasoning; sonnet-workers.
**Datoerne i `sessionsplan-3662.md` er ophævet for dette arbejde.** Rækkefølgen indenfor pakken gælder stadig; kalenderen gør ikke.

---

## Prompt (kopiér ind som første besked)

> Rytterne skal kunne stoles på, og det skal være i dag. Det er det managers er lovet.
>
> Brug en workflow-session. Læs først `docs/sessions/2026-08-13-rytterne-skal-kunne-stoles-paa-prompt.md` — den bærer alt der allerede er besluttet og målt, så du ikke skal gætte eller regne det igen. Derefter #3664-tråden (designsessionens 8 beslutninger) og `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md`.
>
> **Trin 1 — landing 1:** #3666 + #2454 + #3667 deployet sammen, plus #3671. Ét deploy, én spillerbesked, nul rytterdata der flytter sig.
> **Trin 2 — landing 2:** positionerings-loftet hæves for de fem roller der belønner den. Egen PR, egen besked, og du spørger mig FØR du kører prod-mutationen.
>
> Ingen af de låste beslutninger genåbnes. Stil spørgsmål ét ad gangen med anbefaling først, og vis mig tingene visuelt undervejs — prosa er ikke nok når det er tal eller før/efter.

---

## Hvad der ALLEREDE er låst — genåbn ikke

Otte ejer-beslutninger fra designsessionen 13/8, fuldt dokumenteret i [#3664](https://github.com/NicolaiDolmer/CyclingZone/issues/3664#issuecomment-5281975050):

| Beslutning | Konsekvens |
|---|---|
| De 8 visnings-opskrifter godkendt | Ligger i `backend/lib/weights/displayRecipes.js`, merged. **Rør dem ikke.** Sprint 4 / acceleration 3 hos sprinteren er eksplicit godkendt; bjergrytterens `punch 1` er en vagt-tvungen rettelse |
| Potentiel rating erstatter stjernerne 1:1 | 10 målte flader. Label kun på **hover**. Vist som **interval**. Sortering rangerer fortsat **talent** (`_scoutMid`), ikke rolle-potentiale |
| `CEIL_HALF_WIDTH_BY_LEVEL = [9, 6, 4, 3]` | Målt + ejer-besluttet. **Regn den ikke igen** — se måling nedenfor |
| `classifierWeights` er FROSSET | Hash-test håndhæver det. Ingen rytters type må kunne bevæge sig |
| `capsShapingWeights` røres ikke i #3666 | Den er **trin 2** i denne session — egen PR, egen besked, ejer-gated prod-mutation |
| Tre landinger | Denne session leverer landing 1 **og** landing 2, i den rækkefølge |

## Målt allerede — brug tallene, gentag ikke arbejdet

Alt read-only mod prod 13/8.

- **Ny potentiale-fordeling** (n=8.747): p25 33 · median **44** · p75 55 · maks **85** · std 15,0 · 0 % klampet. Dagens til sammenligning: median 59, maks 99, 3,7 % klampet.
- **Lofterne var aldrig ødelagte.** Ikke én evne har loft ≥95 hos mere end en håndfuld ryttere; medianlofter 9-46. De "99'ere" i #3592 var fabrikeret af normaliseringen (`O_ELITE = 67,38` → 99).
- **Typen kan ikke flakke.** Alle 8.731 levende ryttere har `archetype_draw`, og `primary_type` matcher trækket i **100 %**. Klassifikatoren rammer nul eksisterende ryttere.
- **Den nye skala er MINDRE træningsfølsom.** Andel ryttere hvor det viste tal ikke flytter sig på en uge: 28,8 % i dag → **38,3 %** efter. Det er ærligt, men det betyder at denne landing isoleret set forværrer følelsen af at træning ikke virker, indtil #3643 lander.
- **Halvbredderne:** dækning af rytterens egen rolle pr. halvbredde er målt for begge skalaer. `[9,6,4,3]` reproducerer dagens indsnævring (36/26/17/13 % mod dagens 34/25/15/10 %). Toppen står bevidst på 3 og ikke 2: båndets midtpunkt er kun forskudt en halv halvbredde, så 2 ville pinne loftet til ±1 point. Fuld udledning: [#3666-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/3666#issuecomment-5283254052).
- **Scout-gulvet er i vejen.** `minHalfWidthByScoutRating` giver 5,0 ved spejder-overall 40, som er default for **150 af 203 menneskehold**. Med `[9,6,4,3]` bliver niveau 2 og 3 identiske for dem, og niveau 1 ligger ét point væk. **#3671 skal afgøres i samme omgang** — en simpel nedskalering løser det ikke.

## Scope

**Trin 1 — landing 1 (nul rytterdata flytter sig):**

1. **#3666** — D1-modellen på alle visningsflader i én PR. OVR-plade + OVR-kolonner (Auktioner, Rytterdatabasen, Holdsiden, Ønskelisten), planner-kort, Overblik-radaren, Udvikling-fanens graf/loft-zone/projektion, `pickChartTypeKeys`, Scouting-kortet (omlagt: egen rolle stort, de øvrige 7 som kontekst), `statColor` genbruger evne-ankrene. `typeRatingCalibration.json` + `typeRatingScale.js` ud af visnings-stien.
2. **#2454** — potentiel rating erstatter stjernerne på de 10 flader. `labelAsTitle` bliver default. `ScoutablePotentiale` omskrives til interval.
3. **#3671** — scout-gulvet. Afgøres sammen med halvbredderne, ikke efter.
4. **#3667** — hjælpetekster + patch note, i SAMME besked som deployet.

**Koordinering:** PR #3672 (transparens-sessionens tre tekstrettelser) rører `help.json` og `rider.json` på begge sprog. **Vent til den er merged**, eller rebase på den — ellers konflikter #3667 med den. Tjek `gh pr view 3672 --json state` før du rører i18n.

**Vigtigt om arbejdstræet:** hovedmappen kan stå på en anden sessions branch. Verificér branch i selve commit-kæden, og arbejd i et worktree (`scripts/new-worktree.ps1`).

## Gates — bevis i PR-body, ikke påstand

| # | Kriterium | Mål |
|---|---|---|
| R1 | 8 opskrifter på median-rytteren | ≤6 points spredning |
| R2 | Caps/primary_type/secondary_type/potentiale uændret | 100 % |
| R3 | Markedsværdier uændret | 100 % |
| R4 | Hver af 15 evner i ≥1 opskrift | CI-vagt (findes) |
| R6 | Luft nu→loft | median ≥20 point |
| R7 | Ingen flade tilbage på gammel skala | grep-gate + e2e alle 3 projekter |
| R8 | `scoutingInversionHarness` | **kør mod `[9,6,4,3]`** — fordelings-målingen er ikke et inversions-bevis |

Frontend/i18n rører → `npm run lint` + `node --test` i `frontend/` + **hele** e2e-suiten. Visuelle ændringer → alle 3 playwright-projekter. Skærmbilleder før/efter i PR-body — ejer-krav.

## Hvordan workflowet bør formes

**Fan-out på opdagelse og verifikation. IKKE på selve redigeringen.** #3666's sikkerhed hviler på at alle flader skifter i én PR; parallelle agenter i hver sit worktree ville konflikte på de samme filer og kunne efterlade en mellemtilstand med to skalaer.

Foreslået form:
- **Fase 1, parallel:** én agent pr. flade-familie kortlægger *hvor* rating/potentiale renderes, hvilke props der bæres ind, og hvad der går i stykker. Returnér struktureret; ingen redigering.
- **Fase 2, enkelttrådet:** selve omlægningen, med kortet fra fase 1 som kravspec.
- **Fase 3, parallel + adversarisk:** én verifikator pr. gate, hver prompted til at **modbevise** at gaten er mødt. R2/R3/R8 er de vigtigste — de er hele grundlaget for at kunne sige "din rytter er den samme".
- **Fase 4:** en completeness-kritiker: hvilken flade er IKKE kortlagt, hvilken påstand er ubekræftet?

## Faldgruber

- **Verificér mod runtime, ikke mod en anden tekst.** #3591's præmis var 0 af 3.293 da den blev målt. Designsessionen fandt to ting mere ingen havde målt: en drevet frontend-kopi og et femte uadskilleligt rollepar.
- **Mocket Playwright beviser kun rendering.** Nye SELECT-kolonner eller endpoints: verificér mod ægte DB.
- **Ingen prod-mutation af eksisterende ryttere i denne landing.** Kræver en fase det, er det et stopsignal — spørg ejeren.
- **Loop-guard:** 2 CI-fejl på samme symptom → stop og spørg.
- **Vis visuelt undervejs.** Ejer-krav, gentaget tre gange i designsessionen. Widget eller preview-server før du beder om en beslutning.

## Trin 2 — LANDING 2: positionerings-loftet hæves (#3592, nedskåret)

**Ejer-besluttet 13/8.** Egen PR, egen spillerbesked, **efter** landing 1 er live. Fold den ikke ind i trin 1 — landing 1's værdi er en påstand vi kan *bevise* ("intet ved din rytter har flyttet sig"), og den overlever ikke en samtidig genberegning af lofter.

### Problemet, målt

Rolle-faktoren i `riderProgression.js` har fire trin: **1,00** signatur i primærtype · **0,82** sekundær · **0,45** neutral · **0,12** modsat. Hvilken kasse en evne havner i, aflæses af `capsShapingWeights`.

`positioning` har vægt **0 i alle otte ryttertyper** → altid neutral → altid 0,45 × grundloftet. Målt mod prod 13/8 er positionerings-loftets median **22-27 for hver eneste rolle** — fladt. En sprinters sprint- og flad-loft er til sammenligning 48. Forholdet 22/48 bekræfter faktoren 0,45 direkte i data.

Det var uproblematisk indtil i dag: positionering indgik i **nul** af de gamle opskrifter. Fra og med #3666 belønner fem roller den — så vi belønner en evne spillet forhindrer nogen i at blive god til.

### Ændringen

Giv `positioning` en **positiv vægt** i `backend/lib/weights/capsShapingWeights.js` for de fem roller hvis visnings-opskrift indeholder den: `sprinter`, `tt`, `puncheur`, `brostensrytter`, `rouleur`.

Magnituden er ligegyldig — både `signatureFactor` og `youthRoleFactor` tester kun **fortegnet** (`w > 0`). Brug 1 og skriv hvorfor.

Derefter genberegnes caps for de berørte ryttere. **Det er en prod-mutation: spørg ejeren før kørsel** (spec §5, stopsignal).

### Forventet effekt

- Positionerings-loft **22 → ~48** for ca. **5.558 af 8.747** ryttere (63 %).
- Potentiel rating **+~4 point** for dem, og tilsvarende **mere luft** mellem nu og loft — hvilket direkte hjælper på "træning føles som om den virker".
- **Ingen kan miste noget.** Lofter kan kun stige; det er ændringens vigtigste egenskab, og den skal bevises, ikke påstås.

### Gates — bevis i PR-body

| # | Kriterium | Mål |
|---|---|---|
| B1 | **Intet evne-loft falder for nogen rytter** | 100 %, diff mod snapshot |
| B2 | `primary_type` + `secondary_type` uændret | 100 % — typen kommer fra `archetype_draw`, men verificér det, antag det ikke |
| B3 | Markedsværdier uændret | 100 % — `positioning` er ikke i `valuationWeights`' 13 evner, men verificér mod ægte data |
| B4 | `potentiale`-feltet urørt | felt ikke skrevet |
| B5 | Backup-tabel + verificeret rollback-vej FØR mutationen | dokumenteret |

### En test vil fejle — med vilje

`backend/lib/weightTableSplit.test.js` hævder at de tre data-styrende vægt-tabeller er bit-identiske med tabellen før splittet. Denne ændring bryder den for `capsShapingWeights`, og **det er mekanismen der virker som designet**: fjern posten fra `IDENTICAL_AT_SPLIT` og skriv hvorfor i samme commit. Rør ikke `classifierWeights`' hash-test — den er frosset.

### Hvorfor det er sikkert nu, men ikke var det i går

Før #3665 lå caps-formning, klassifikation og markedsværdi i **samme tabel**. At give positionering en positiv vægt ville have flyttet rytteres typer og priser samtidig. Efter splittet rører den kun lofterne. Det er præcis det fundamentet blev bygget for — og B1-B3 beviser det.

## Kilder

#3664 (designsessionen, 8 beslutninger + målinger) · #3666 · #2454 · #3667 · #3671 · #3592 · `rating-fundament-v3`-spec · `docs/HOWTO_ADD_ABILITY.md`
