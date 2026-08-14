# Session-prompt: træningssidens struktur (#3721) + trin 2

**Model:** Opus 5 · **Indsats:** high · **Form:** design-først, ejer-godkendt mockup, derefter bygge
**Skrevet:** 15/8 aften af loft- og udviklingsfart-sessionen · **Revideret samme aften** efter selvkritik: første udgave gentog issuet og udelod dets skarpeste fund

> **#3721 er allerede grundigt skrevet, med målinger.** Læs det først og læs det helt. Dette dokument gentager det ikke — det tilføjer kun det issuet ikke kunne vide, fordi motoren under fladen er bygget om siden 14/8.

---

## Prompt (kopiér ind som første besked)

> Du designer træningssidens og rytterprofilens struktur ([#3721](https://github.com/NicolaiDolmer/CyclingZone/issues/3721)) og bygger derefter trin 2 af [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709) ovenpå. Læs i denne rækkefølge:
>
> 1. **`#3721`, helt.** Den indeholder ejerens egne ord, en måling af hvad der ligger over rosteret, og et konkret dublet-fund mellem Overblik- og Træning-fanen. Den har også tre forslag der er markeret *"skal vurderes, ikke besluttes her"* — de er ikke beslutninger, de er dine at efterprøve.
> 2. `docs/design/PAGE_TEMPLATES.md` — bindende. Tre skabeloner, ingen nye.
> 3. `docs/sessions/2026-08-16-traeningssidens-struktur-prompt.md` — dette dokument, resten af det.
> 4. `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md` §5, §6 og **§8.1 inklusive rettelsen nederst**.
> 5. `#3747` og `#3743` — to nye issues der begge lander på din flade.
>
> **Arbejd i en worktree.** `pwsh -File scripts/new-worktree.ps1 -Branch feat/3721-traeningssidens-struktur`. Tjek `git branch -a` og nyligt oprettede issues først — NOW.md er ikke et pålideligt realtids-claim på tværs af worktrees ([#3712](https://github.com/NicolaiDolmer/CyclingZone/issues/3712)).
>
> **Vis mockups og få ejer-go før du bygger.** `TrainingPage.jsx` er 1.360 linjer. Begynder du at flytte rundt i den før strukturen er godkendt, bygger du to gange.
>
> Vær kritisk over for dit eget arbejde. Sig det når du gætter.

---

## Ejerens egentlige krav til denne session

Ordret, 15/8: *"Det er meget vigtigt, at vi bygger et langsigtet godt managerspil med få quick fixes"* og *"sørger for at alle de nye funktioner er meget godt sammenhængende."*

**Sammenhæng er opgaven, ikke oprydning.** Der er fem ting på vej ind på den samme flade, og de kommer fra samme model. Bygges de som fem features, får spilleren fem ting at forstå. Bygges de som én model, får han én.

Modellen er: **et tag og en rate.** Hvor højt en evne kan nå, og hvor hurtigt den kommer derhen. Alt på siden er en visning af de to tal.

| hvad der skal på fladen | hvor det kommer fra | hvilken knap det viser |
|---|---|---|
| Kvitteringen pr. evne | trin 1, **live** | hvor langt op han er nået |
| Trænbarheds-signalet | #3747 | **begge** — og det er hele fejlen i dag |
| Et syvende fokus, `løbslære` | trin 2 | hvilke evner en retning rammer |
| Point pr. sæson pr. fokus | trin 4, spec §5.2 | raten, gjort konkret |
| Assistentens kvalitet | #3743 | hvem der vælger, når du ikke gør |

Hvis din struktur kan forklare de fem som én ting, er den rigtig. Kan den ikke, er den en liste.

## Det der er sket siden #3721 blev skrevet 14/8

Issuet er skrevet før motoren blev bygget om. Fire ting er nye:

**1. Modellen har to knapper nu.** [#3739](https://github.com/NicolaiDolmer/CyclingZone/pull/3739) (merget) og [#3741](https://github.com/NicolaiDolmer/CyclingZone/pull/3741) skiller tag og rate ad i fem rolleklasser. Lofterne er hævet hele vejen rundt, og ryttere når nu kun ~42 % af dem mod ~94 % før. **Følge for fladen: "færdig"-markeringen bliver sjælden.** Den nuværende visning er bygget til en verden hvor ryttere mættede deres loft. Det gør de ikke længere.

**2. Trænbarheds-labelen er blevet usand.** #3747, fuldt beskrevet der. Kort: den læser kun taget, og håndværk (0,95) og anden rolle (0,70) får samme label. **Det skal løses sammen med trin 2, ikke efter** — `løbslære` (positioning, tactics, aggression) består næsten udelukkende af netop de to klasser, så det nye fokus, hvis hele formål er at gøre spillets mest låste evner trænbare, vil præsentere sig som det mindst attraktive valg på siden.

**3. Assistenten er lige så god som det bedste spil.** Målt på 1.200 simulerede karrierer: `smartDefaultFocus` giver rating 28 ved 30 år, bedste manuelle strategi giver også 28. **Der findes i dag ingen målbar grund til at åbne siden overhovedet.** #3743 løser halvdelen (assistenten skal afhænge af trænerens evner). Den anden halvdel er din: siden skal gøre det synligt hvad man vinder ved at gøre det selv.

**4. Klubben har en målt værdi nu.** Facilitet + træner giver median **+12,9 %** og op til **+38,9 %** hurtigere udvikling, for 1.932 af 6.878 hold-ejede ryttere (`docs/audits/2026-08-15-3709-hul7-staff-stien-verificeret.md`). Hvis siden skal motivere en klub-investering, er det tallet.

## Rækkefølgen — min anbefaling, ikke en beslutning

Der er en ægte afhængighed mellem #3721, #3743, #3747 og trin 2, og den peger ikke entydigt.

**Anbefalet:** struktur (#3721) → #3747 + trin 2 **sammen** → #3743 sidst.

Begrundelsen: strukturen skal ligge fast før noget lægges på den, ellers gentager vi fejlen. #3747 og trin 2 kan ikke skilles ad uden at shippe en fælde. #3743 kommer sidst fordi den ændrer `smartDefaultFocus`, som styrer hvilket fokus tusindvis af ryttere trænes med i prod — den kræver egen dry-run og ejer-godkendelse, og den skal ikke ligge i en UI-PR.

**Modargumentet, som du skal tage stilling til:** siden skal forklare assistenten, og hvis #3743 ændrer hvad assistenten *er*, designer du en forklaring på noget der laver sig om. Overvej at træffe *beslutningen* i #3743 (hvor dårlig må ingen træner være?) før du designer, selvom *koden* kommer sidst.

## Groundwork, så du ikke skal finde det selv

| | |
|---|---|
| `frontend/src/pages/TrainingPage.jsx` | **1.360 linjer.** Dette er en refaktorering, ikke en justering |
| `frontend/src/components/rider/profile/RiderTrainingTab.jsx` | 531 linjer |
| `frontend/src/components/rider/profile/` | 9 faner — issuet spørger om de alle er nødvendige |
| `frontend/src/lib/useTrainingHistory.js` | henter 30 dages `training_day_runs` med `report.riders[].gains` pr. evne. En sæson er 28 dage; **filtrér på aktiv sæsons `start_date`**, ellers bløder forrige sæson ind efter sæsonskift |
| `frontend/src/lib/useTraining.js` | forbruger `focusTrainability` — det er her #3747 rammer |
| `frontend/src/lib/trainingReport.js` | `focusTrainabilityNotice`, den delte helper reddet ud af den droppede PR #3701 |
| `frontend/src/preview/seedData.js` | seed-data til preview. **Hold den opdateret** — ejeren skal kunne teste på preview før live |
| `pr-screens/3709-*.png` | skærmbilleder fra 14/8, grundlaget for issuets måling |

## Krav der ikke er til forhandling

- **Mobil er ikke en efterfølgende tilpasning.** 15 evne-linjer × en trup på 12-30 ryttere er et mobilproblem før det er et desktopproblem. Kør alle tre playwright-projekter; CI fejler ellers på mobile (#536).
- **`smartDefaultFocus` må ikke ændres som sideeffekt.** Den er verificeret bit-identisk gennem trin 3 og 4 og pinnet i en test. Ændres den, skifter tusindvis af ryttere fokus i prod.
- **Trin 2's fokus-størrelser kalibreres, ikke arves** (specen, ordret). `endurance` træner tre evner, `sprint` to, `løbslære` ville træne tre. Så længe fokus næsten intet betød, var det ligegyldigt; efter trin 4 er størrelsen et balance-håndtag. Brug `backend/scripts/rytterudviklingScorecard.js` (kræver en `--baseline`-worktree) — det er en balance-ændring med egen måling.
- **Ejer-go visuelt før merge.** Ingen undtagelse for UI.
- **Preflight:** `pwsh -File scripts/preflight-pr.ps1`. Frontend + i18n = TIER FULL: build, warning-budget, i18n-nøgler, `node --test` i `frontend/`, hele e2e-suiten.

## Hvornår er du færdig

Ikke "siden er pænere". Konkret:

1. **Rosteret er det første man ser** på `/training`. Forklaringerne findes stadig, men et sted man opsøger dem.
2. **Dubletten er væk.** Evnelisten står ét sted på rytterprofilen, og det er besluttet og begrundet hvilket.
3. **En spiller kan på under et minut svare:** hvilken af mine ryttere har mest at hente, hvad skal jeg vælge for ham, og hvad får jeg ud af det.
4. **Trænbarheds-signalet siger sandheden om begge knapper** — ikke "begrænset" om en evne hvis loft er tæt på en sekundær evnes.
5. **`løbslære` fremstår som et rigtigt valg**, ikke som det dårligste på listen.
6. **Strukturen kan bære trin 4's tabel** uden at nogen skal designe igen.

## Grænseflader til andre spor

- **Motoren er ikke din.** `riderProgression.js`, `dailyTraining.js`, `training.js` er netop ombygget. Trin 2 rører `TRAINING_FOCUSES` — det er den ene undtagelse, og den kommer med måling.
- **Økonomi-sporet arbejder parallelt** (#3393, #3729, #3730). Trin 4 flytter rytterværdier over en karriere, og spændet mellem godt og dårligt spil går fra 16 % til 158 %. Rør ikke værdi- eller lønvisninger uden at tale med dem.

## Kilder

`#3721` · `#3709` · `#3747` · `#3743` · `#3660` · `#3705` · `docs/design/PAGE_TEMPLATES.md` · specens §5, §6, §8.1 · `docs/audits/2026-08-15-3709-*.md`
