# Session-prompt: træningsmodellen, hele vejen ned (#3762 + kæden)

**Model:** Opus 5 · **Indsats:** high · **Form:** design-først, ejer-beslutninger, derefter workflow-bølge
**Skrevet:** 16/8 af struktur-sessionen (#3721) · **Status ved overlevering:** fokus-panelet er bygget og pushet, resten er design

> Denne prompt gentager ikke issuerne. Den samler det de ikke kan vide hver for sig: at fem åbne issues er ét system, og i hvilken rækkefølge de kan besluttes uden at bygge det samme to gange.

---

## Hvad der skete i sessionen før

Ejeren bad om at få træningssidens **struktur** designet (#3721). Undervejs viste målingerne at problemet ikke var layoutet alene, men modellen under det. Tre fund, alle målt:

1. **Fokus-vælgeren kunne ikke bære det der var på vej.** Ejer-godkendt 16/8: den blev et **panel** med én række pr. valg og datastyrede kolonner. Bygget, grønt lokalt, ikke merget. Branch `feat/3721-traeningssidens-struktur`.
2. **Trænbarheds-labelen er delvist usand, men ikke som #3747 beskrev.** Målt over 384 type-kombinationer: `blocked` fyrer **0** gange (uopnåelig kode), `strength` er sand for 79 %, og `limited` er den tvetydige bucket. `løbslære` ville læse `strength` for 64 af 64, ikke `limited`. Det ægte trin 2-problem er `technique`, som går fra 0 % til 56 % `limited` når `positioning` flyttes ud. Korrektionen ligger på #3747.
3. **Setback har aldrig ramt nogen.** Kæden er dokumenteret i #3758. Fjernelsen er ren kodesletning uden prod-mutation.

## Systemet, som det hænger sammen

Det er ikke seks issues. Det er én model med et hul i midten, og #3762 er hullet.

```
#3762  dagstype først, session derefter        ← BESLUT DENNE FØRST
   ├── #3759  hvile som fokus                  ← overstyres af #3762
   ├── #3760  aktiv restitution                ← trin 1-valg i #3762
   ├── #3709 trin 2  løbslære                  ← en række under "færdighedsdag"
   ├── #3747  trænbarheds-signalet             ← mindre kritisk når grupperne er synlige
   └── #1895  ugerytmen                        ← gemmer #3762's trin 1-valg pr. ugedag
```

**Alt andet er blokeret af #3762.** Bygges #3759 først, migreres `training_week_plans` to gange. Bygges trin 2 først, lander `løbslære` på en akse der er ved at blive lavet om.

Målt grundlag for hastværket: **622 planer (13,6 %) står lige nu på fokus + hvile**, hvor motoren beviseligt ignorerer fokusset. Yderligere ~5 % står på fysiologiske modsigelser. Se kommentaren på #3762.

## Beslutninger ejeren skal træffe, i rækkefølge

Stil dem **én ad gangen**, i klart sprog, med anbefaling. Ikke som et dossier.

1. **Hvad koster en færdighedsdag?** Uden en pris træner alle færdigheder hver dag. Hypotese der skal måles, ikke antages: håndværks-raten (0,22) er selvbegrænsende nok. Kræver harness-kørsel.
2. **Hvordan oversættes de 179 `endurance` + hård-planer?** Forslag i #3762-kommentaren: Mellem/Tempo, ikke Hård.
3. **Skal aktiv restitution ind i første version, eller efter?** Den er koblet til #2650 (træthed er mættet: AI-median 100, human-median 90).
4. **Hvor langt går vi mod periodisering?** #2337 findes. Se "det lange spil" nedenfor.

## Det lange spil, hvis I vil bygge verdensklasse

Fire ting der ikke er issues endnu, i stigende ambition. **Ingen af dem skal bygges i denne omgang** — de er retningen at bygge #3762 så den ikke spærrer for dem.

- **Programmer frem for daglige klik.** 30 ryttere × et dagligt valg er en pligt, ikke et spil. Et *program* pr. gruppe ("mine sprintere kører dette") med ugerytmen som form er den skalerbare version og passer til #3762's dagstyper.
- **Periodisering (#2337).** En sæson har faser: base, opbygning, form, nedtrapning. I dag er hver dag identisk. Det er den mest velkendte manager-mekanik vi mangler, og #3762's dagstyper er byggeklodserne.
- **Belastning frem for to tal.** Form og træthed er i dag to separate felter. I virkelighedens modeller er form et *resultat* af belastningshistorik. Det ville gøre hvile, aktiv restitution og hårde dage til ét sammenhængende system i stedet for tre justerbare konstanter. Stor ændring, stor gevinst, hører til efter #3762.
- **Assistenten som en karakter (#3743).** Ejer-beslutning 15/8: assistentens kvalitet skal afhænge af trænerens evner. Kombineret med #3762 bliver træneren den der foreslår ugens program, ikke en usynlig fallback.

## Rækkefølge, anbefalet

| # | hvad | hvorfor nu |
|---|---|---|
| 1 | Merge fokus-panelet (#3721) | Bygget og grønt. Panelets rækker regrupperes af #3762, men strukturen holder |
| 2 | #3758 setback ud | Ren sletning, fjerner en usandhed fra fladen. Ingen gates |
| 3 | **#3762 besluttes** | Blokerer alt andet |
| 4 | #3721 struktur-PR | Ejerens oprindelige klage. Frontend-only |
| 5 | #3762 bygges + #3759 + #1895-migration | Én migration, ikke to |
| 6 | Trin 2 + #3747 | Lander på den nye akse |
| 7 | #3760, #3761, #3743, faner 9→7 | Efter |

## Hvad der IKKE må ske

- **`smartDefaultFocus` må ikke ændres som sideeffekt.** Verificeret bit-identisk gennem trin 3 og 4, pinnet i test. Ændres den, skifter tusindvis af ryttere fokus i prod.
- **Ingen migration af `training_plans` uden dry-run-diff + ejer-godkendelse.** 4.587 rækker.
- **Ejer-go visuelt før merge af UI.** Ingen undtagelse.
- **Mobil er ikke en efterfølgende tilpasning.** Kør alle tre playwright-projekter.

## Groundwork

| | |
|---|---|
| `backend/lib/dailyTraining.js` | `abilityMult` (rest → 0), `fatigueLoad` (rest −14, easy +4, normal +9, hard +16). Den motor der faktisk kører |
| `backend/lib/training.js` | `TRAINING_FOCUSES`, `focusTrainability`, `resolveTrainingModifier` (setback bor her, og kun her) |
| `frontend/src/components/training/FocusPanel.jsx` | Bygget 16/8. Datastyrede kolonner: signal-kolonnen forsvinder når intet kan påstås, point-pr-sæson-kolonnen dukker op når trin 4 leverer den |
| `frontend/src/lib/trainingFocus.js` + `.test.js` | Ren logik + 11 tests. `focusSignal('limited') === 'none'` er pinnet med begrundelse |
| `frontend/tests/e2e/3721-*.shots.mjs` | Måle- og screenshot-scripts: blok-positioner, panelet, profil-dubletten |
| `docs/design/3721-traeningssidens-struktur/mockup.html` | Struktur-forslaget i spillets egne tokens |

## Kilder

`#3762` (+ kommentar med prod-målingen) · `#3758` · `#3759` · `#3760` · `#3761` · `#3721` · `#3747` · `#3709` · `#2650` · `#2337` · `#1895` · `#3743`
