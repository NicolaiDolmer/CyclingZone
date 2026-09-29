# Træn nu, tidsuafhængig træning og trætheds-prognose (design 29/9 2026)

> **Status: ejer-godkendt 29/9 (Claude-session, efter forumtråd + mockup).** Genåbn ikke beslutningerne i §2 uden ejeren.
> Mockup (godkendt): [`docs/design/mockups-traen-nu-2026-09-29/traen-nu-design.html`](../../design/mockups-traen-nu-2026-09-29/traen-nu-design.html)
> Ændrer beslutning 2 fra 6/9 (#4847): knappen kommer tilbage, bonussen forbliver fjernet.
> Forudsætning: #5928 (træthed/form opdateres én gang pr. dato, normaliseret belastning) er live og stabil.

## 1. Problemet
Træning pr. løbsdag (S4, 28/9) fjernede spillerens valg af tidspunkt. Forumtråden "Training at 20, not later"
(cyclingzone.org/forum/e8a1d2bc-4772-4990-b36f-65b35814aa44, 28-29/9, 8 indlæg) viser to behov:

1. **Spil når det passer:** "the other way of training was very flexible. Not important when you played, timezones etc." (ottendahl, +3 enige). Flere træner kl. 5-6 om morgenen og spiller ikke om aftenen.
2. **Kontrol over trætheden:** dolamba vil se dagens løb og justere. "If someone ends higher in fatigue than you expected… they're just dead after next day."

Det gamle trick (kør 2 etaper, tryk træning for at restituere, frisk til de sidste 3) var #3461-fejlen og kommer ikke tilbage.

## 2. Ejer-beslutninger 29/9
| # | Beslutning | Konsekvens |
|---|---|---|
| 1 | **Tidsuafhængigt resultat.** Datoens træningsudvikling beregnes fra rytterens form/træthed ved datoens start | Tryk kl. 06 og automatisk afregning giver bit-identisk resultat. Ingen bonus, ingen fordel af at logge ind tidligt eller sent |
| 2 | **"Træn nu" = dagen er afgjort i begge retninger** | Trykket afregner datoens trænings-løbsdage med det samme og viser udviklingen. Tilmeldte ryttere forbliver i deres løb (feltet er låst af løbet). Ikke-tilmeldte kan ikke sættes på et løb samme dato bagefter. Dagens træningsfelter kan ikke ændres; morgendagens plan kan. Et tryk ændrer aldrig en tilmelding |
| 3 | **Løbet køres på datoens starttilstand** | Morgentræning gør ikke rytteren træt til aftenens etape |
| 4 | **Træthed og form opdateres én gang pr. dato** ved aftenopgørelsen (#5928) | Uden tryk: automatisk afregning lige efter sidste etape (#5911), tidspunkt vist i spillerens tidszone; programmet kan ændres frem til da |
| 5 | **Automatiske regler** (#4854 holdregel + undtagelse pr. rytter, #5620 retur til program) | Vurderes på træthed ved datoens start (efter nattens opgørelse). Plus regel "dagen efter en etape: første felt = restitution". Giver morgenspilleren kontrol uden at være online |
| 6 | **Felt-valg: frihed til at styre trætheden legalt** | De 35 felter (7 ugedage × 5 løbsdage, TRAINING_RULES beslutning 8) åbnes for alle, ikke kun beta. Spilleren vælger selv, hvor mange af dagens felter der er restitution |
| 7 | **Prognose** | Rytterkortet viser "Træthed i aften: ca. X" (farve: grøn / gul / rød over skadegrænsen) og opdateres live, når felterne ændres, før man bekræfter. Ét tal pr. rytter i kortet, ikke pr. felt. Mobil: ét tryk væk (mobilstandard 18/9) |
| 8 | **Én samlet rapport pr. dato** (#5915) | Alle 5 løbsdage samlet; ingen "1/5 udvikling, 5x træthed" |
| 9 | Kort Hjælp-tekst | Restitutionen sker ved aftenopgørelsen for hele datoen. EN først, ingen tal |

## 3. Invarianter (skal have tests)
- I1: `resultat(tryk kl. X) == resultat(automatisk)` for alle X på datoen.
- I2: Idempotent nøgle pr. rytter + dato; dobbelt tryk, retry og aftenkørsel kan ikke give dobbelt afregning.
- I3: Et tryk ændrer aldrig `race_entries` / `race_entry_days`; en ikke-tilmeldt rytter kan ikke tilmeldes et løb på en dato, hvor han allerede er afregnet.
- I4: Træthed/form skrives kun af aftenopgørelsen (én ejer, jf. #5926).
- I5: Prognosen bruger samme funktioner som opgørelsen (ingen kopi af formlen).

## 4. Rækkefølge
1. #5928 live og stabil (forudsætning).
2. Beslutning 1-4 samlet (motor + knap + låse + tidszone).
3. Beslutning 5 (regler) og 6 (35 felter for alle).
4. Beslutning 7 (prognose).
5. Beslutning 8 kan bygges parallelt; 9 skrives undervejs.

Alt bag flag, mobil først (#3643), `PAGE_TEMPLATES.md` + `TASTE.md`. Claude laver review før endelig release.

## 5. Referencer
#4847 (omskrevet), #4850, #4854, #5620, #5915, #5928, #5926, #5911, #3461, #3455, #3763, `docs/TRAINING_RULES.md` beslutning 2 og 8.
