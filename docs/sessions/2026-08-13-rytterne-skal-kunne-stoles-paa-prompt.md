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
> Leverancen er **landing 1**: #3666 + #2454 + #3667 deployet sammen, plus #3671. Ét deploy, én spillerbesked, nul rytterdata der flytter sig.
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
| `capsShapingWeights` røres ikke i #3666 | Eget trin; det er den eneste del af pakken der ændrer eksisterende ryttere |
| Tre landinger | Denne session leverer landing 1 |

## Målt allerede — brug tallene, gentag ikke arbejdet

Alt read-only mod prod 13/8.

- **Ny potentiale-fordeling** (n=8.747): p25 33 · median **44** · p75 55 · maks **85** · std 15,0 · 0 % klampet. Dagens til sammenligning: median 59, maks 99, 3,7 % klampet.
- **Lofterne var aldrig ødelagte.** Ikke én evne har loft ≥95 hos mere end en håndfuld ryttere; medianlofter 9-46. De "99'ere" i #3592 var fabrikeret af normaliseringen (`O_ELITE = 67,38` → 99).
- **Typen kan ikke flakke.** Alle 8.731 levende ryttere har `archetype_draw`, og `primary_type` matcher trækket i **100 %**. Klassifikatoren rammer nul eksisterende ryttere.
- **Den nye skala er MINDRE træningsfølsom.** Andel ryttere hvor det viste tal ikke flytter sig på en uge: 28,8 % i dag → **38,3 %** efter. Det er ærligt, men det betyder at denne landing isoleret set forværrer følelsen af at træning ikke virker, indtil #3643 lander.
- **Halvbredderne:** dækning af rytterens egen rolle pr. halvbredde er målt for begge skalaer. `[9,6,4,3]` reproducerer dagens indsnævring (36/26/17/13 % mod dagens 34/25/15/10 %). Toppen står bevidst på 3 og ikke 2: båndets midtpunkt er kun forskudt en halv halvbredde, så 2 ville pinne loftet til ±1 point. Fuld udledning: [#3666-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/3666#issuecomment-5283254052).
- **Scout-gulvet er i vejen.** `minHalfWidthByScoutRating` giver 5,0 ved spejder-overall 40, som er default for **150 af 203 menneskehold**. Med `[9,6,4,3]` bliver niveau 2 og 3 identiske for dem, og niveau 1 ligger ét point væk. **#3671 skal afgøres i samme omgang** — en simpel nedskalering løser det ikke.

## Scope

**Skal med:**

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

## Én åben beslutning ejeren skal tage

**Skal capsShaping (#3592, nedskåret) med i denne omgang?**

Den er den **eneste** del af rytter-pakken der ændrer eksisterende rytteres lofter. Ejeren låste 13/8 at den skulle vente til efter cutover, netop fordi den flytter rytterdata og kræver prod-mutation, backup og negativ-kontrol (spec §5 gør det til et stopsignal).

Mandatet *"styr på rytterne i dag"* kan læses begge veje. Spørg ejeren eksplicit, første gang du taler med ham:

- **Uden capsShaping (anbefaling):** landing 1 alene. Beskeden bliver *"tallene betyder noget nyt — men din rytter er præcis den samme"*, og den kan bevises med R2/R3. Det er den stærkeste tillids-besked vi kan sende efter tre uger med rystelser, og den har nul risiko.
- **Med capsShaping:** flere ryttere får rigtigt formede lofter med det samme, men beskeden bliver *"tallene ER lagt om OG din rytters loft har flyttet sig"* — to ting på én gang, hvilket er præcis det #3458 Del C forbyder.

## Kilder

#3664 (designsessionen, 8 beslutninger + målinger) · #3666 · #2454 · #3667 · #3671 · #3592 · `rating-fundament-v3`-spec · `docs/HOWTO_ADD_ABILITY.md`
