# Gentagen fejl: Grand Tour 21-etape-fordeling (2026-06-27)

## Symptom
Ved prestige-kalender-rebuilden byggede jeg etape-fordelingen i frihånd: 21 etaper som **1 etape/dag i 21 dage**, alle 3 Grand Tours oven i hinanden. Ejeren fangede det ("gået galt med grand tours IGEN på de 21 etaper … du kan ikke huske det fra gang til gang"). Det er samme klasse-fejl som blitz-hændelsen (`2026-06-27-d3-reset-blitz.md`) — kalender-model bygget på antagelser i stedet for den låste spec.

## Rod-årsag
Sprang `superpowers/specs/2026-06-27-race-calendar-model-design.md` over (den var IKKE i `docs/`, kun i repo-rod `superpowers/specs/`) og udledte modellen fra ejerens chat-beskeder alene. Misforstod "5/4/3/2 løbsdage kørt om dagen" som **5 samtidige løb/dag** (1 etape/løb) i stedet for **komprimerings-cap = etaper/dag pr. løb = antal tids-slots** (derfor gav ejeren netop 3 slots til div 3 = 12/15/18).

## Den korrekte konvention (LÅST — læs FØR enhver kalender-rebuild)
- **Grand Tour = 21 etaper komprimeret til ~5-6 reelle dage**, IKKE 21 dage. Lægges som **spredt rygrad** (ca. dag 1/12/23) så de 3 GT'er **ikke overlapper hinanden** — men mindre løb + klassikere kører samtidig undervejs (overlap er ønsket, bare ikke GT-på-GT).
- **"5/4/3/2 løbsdage om dagen"** = komprimerings-cap / tæthed pr. dag pr. division = antal tids-slots. Div 1=5 (11/13/15/17/19), div 3=3 (12/15/18).
- **Løbsdage pr. division = præcis** 140/112/84/56 (= cap × 28 dage).
- **Prestige-rang** (ikke etape-antal): Grand Tour → Monument → World Tour → ProSeries → Class 1/2. Monumenter (1 etape) hører derfor i div 1.
- **Monumenter binding-fri** (game_day i højt bånd) — stjerner aldrig låst i en GT når et monument kommer.

## Læring
1. **Find OG læs den låste model-spec før du rører kalender-koden** — også specs i repo-rod `superpowers/specs/`, ikke kun `docs/`. `grep -ri "grand tour\|21 etaper\|løbsdage"` på tværs af HELE repoet, ikke kun docs/.
2. **Når ejeren gentager "du laver det forkert igen": stop og søg den eksisterende konvention** i stedet for at gætte en tredje variant.
3. **Bekræft mental model mod et ejer-billede/eksempel** før en stor rebuild — ejeren sendte til sidst et Gantt-billede der entydigt viste komprimeret rygrad + overlap; det burde jeg have efterspurgt tidligere.
4. Implementeret korrekt i `raceCalendarLanePacker.js` (bane-model: density-baner, GT komprimeret over density-1 baner, klassikere fylder til præcis tæthed). Spec: `docs/superpowers/specs/2026-06-27-calendar-prestige-stage-spread-design.md`.
