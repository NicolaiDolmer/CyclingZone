# Session-prompt: trin 7, potentiale skal betyde FART, ikke HØJDE (#3746)

**Skrevet 15/8 ved close-out af tilbagerulnings-sessionen.**
**Model-anbefaling:** arkitekt-model i hovedtråden. Det her er en design-session først, en byggesession bagefter.

---

## Læs det her afsnit før du gør noget som helst

Ejeren har tre gange på en uge måttet rette et system vi lige havde "verificeret". Han er træt af det, og han har ret. Denne sessions succeskriterium er **ikke** at levere hurtigt. Det er at levere noget der ikke skal rettes igen.

Han har bedt eksplicit om, i egne ord:

> "Det er voldsomt vigtigt, at det er en meget grundig opdatering der designer sammen med mig, stiller mange spørgsmål og viser mange ting visuelt. Det er helt vildt vigtigt, at vi arbejder i meget høj kvalitet i næste opdatering. Tjekker eget arbejde meget grundigt efter og sørger for at tingene er tænkt virkeligt godt igennem. Grundighed er voldsomt vigtigt."

Det betyder konkret:

- **Design med ham, ikke for ham.** Stil spørgsmål løbende. Ét eller få ad gangen, aldrig et dossier på 15 (bidt hårdt 4/8). Hver med din egen anbefaling.
- **Vis visuelt.** Brug `show_widget` før beslutninger, ikke efter. Hver gang du beder ham vælge mellem to modeller, skal han kunne SE forskellen. Det virkede 15/8: han skiftede mening om taget da han så barerne, og han fangede selv at fladt tag ville gøre potentiel rating ens for alle sprintere.
- **Verificér dit eget arbejde hårdt.** Kør gates. Kør suiten mod baseline i samme worktree, ikke mod hukommelsen. Læs diffen mod `origin/main` FØR du committer en fil du har hentet fra en anden branch.
- **Ingen scope-nedskæring på grund af tid.** Han kender kapaciteten. Flag rækkefølge og risiko, ikke "der er ikke tid".

---

## Hvad der skete 14.-15./8, kort

Trin 4 (#3741) hævede alle fire rolle-tag. Det brød et løfte fra Discord 11/8 om at "voldsomt få lander deroppe": 748 ryttere kunne pludselig nå over 95, og 1.840 evne-pladser landede på 99. Spillerne opdagede det selv samme aften. Dagen efter kom også +2 og +3 spring på én træning, som ejeren kaldte "pjat, noget der bør rettes".

Tilbagerulningen ligger i PR #3791 (merget 15/8). Den satte tagene tilbage til trin 3's værdier og stoppede blødningen, men den er **ikke en model**. Den er en pause.

**Rod-årsagen er værd at forstå, fordi den er systemisk:** 99-klippet BLEV målt korrekt. Det stod i gates-rapporten 14/8 som "evne-pladser på 99: 0 → 1.840". Men det stod under overskriften "Nyt fund" ved siden af fem grønne gates, i stedet for at VÆRE en gate. Rapporten konkluderede derfor godkendt. **Et fund uden gate stopper ingenting.** Det er den fejl der skal være umulig efter denne session.

---

## Ejerens fem krav, som er gates nu

`backend/scripts/spillervendteGates3709.mjs` findes og kører. Den måler de tal spilleren aflæser, ikke simulerede slutresultater. Alle fem tal kommer direkte fra ejeren 15/8.

| # | gate | krav | status efter #3791 |
|---|---|---|---|
| S1 | taget sætter ingen over 95 | 0 ryttere | ✅ 0 |
| S2 | taget rammer aldrig 99-klippet | 0 pladser | ✅ 0 |
| S3 | største spring på én dag | ≤ +2 | ✅ +2 (rå 2,48) |
| S4 | bedste rytter: 20 → 90 | 286-386 dage | ❌ 228 dage |
| S5 | fart-spænd bedste mod dårligste | 2,5-3,5x | ❌ 1,13x |

**S4 og S5 er hele denne sessions opgave.** De kan ikke løses af et tag, kun af farten.

S5 er det mest alarmerende tal i forløbet: i dag når en rytter med potentiale 1 til 82, mens potentiale 6 når 90. Talent er næsten ligegyldigt for udviklingsfarten. Hele forskellen ligger i taget.

**Kør gates FØR du ændrer noget**, så du har din egen baseline. Snapshottet er ikke committet: `--snapshot=C:/Dev/CyclingZone/docs/snapshots/3591/riders_full.json`.

---

## Beslutninger ejeren traf 15/8. Genåbn dem ikke.

| # | Spørgsmål | Svar |
|---|---|---|
| 1 | Hvad bestemmer evne-taget? | **Fladt tag sat af rollen.** Potentiale styrer farten. Han så det visuelt og kaldte det "en rigtigt god ide". |
| 2 | Hvordan vises potentiale? | **Prognose**, ikke tag. Profilen viser hvor rytteren realistisk ender, ikke hvor højt han teoretisk kan nå. |
| 3 | Hvor mange må have en evne over 95? | **0 nu, under 10 efter fem sæsoner.** Kommer man derop skal det være fordi en manager har trænet rytteren derhen. |
| 4 | Største daglige spring? | **Aldrig +3.** Cirka 1,5 point/uge for de bedste. |
| 5 | Tid fra 20 til 90 for spillets bedste? | **Cirka 12 sæsoner (336 dage).** |
| 6 | Fart-spænd bedste mod dårligste? | **Cirka 3 gange.** |
| 7 | Hvor mange evner over 90 pr. rytter? | **En, måske to.** Fokusvalget skal være managerens vigtigste værktøj. |
| 8 | Arvede ryttere over det nye tag? | **Behold evnen, ingen videre vækst.** Gulvet `max(tag, nuværende)` som i dag. Ingen mister noget. |

---

## Åbne spørgsmål du SKAL stille ham, med visuals

Disse er ikke afklaret. Stil dem én eller få ad gangen, med en anbefaling og et billede til hver.

**A. Hvor fladt er "fladt"?** Skal alle rolleklasser have hvert sit tag (fx signatur 92, sekundær 80, håndværk 70, andenRolle 55, svaghed 25), eller skal taget variere en smule med potentiale endnu? Vis to sprintere med potentiale 2 og 6 side om side under begge.

**B. Hvordan beregnes prognosen?** Den skal være stabil, ellers har vi genopfundet problemet. Forslag: en simulering af rytterens egen fart, alder og nuværende evne frem til 30 år, vist som et bånd. Vis ham hvad båndet gør når rytteren træner godt i en sæson mod dårligt.

**C. Skal prognosen afhænge af hvordan spilleren træner?** En prognose der antager perfekt træning lyver for den der træner spredt. En der antager nuværende plan ændrer sig hver gang man skifter fokus. Begge har en pris.

**D. Hvad sker der med scouting-båndet?** #1162 garanterer at det eksakte loft ikke må kunne aflæses. **Bemærk: fladt tag gør den garanti nærmest triviel**, fordi taget ikke længere røber potentiale. Det er en gevinst der bør nævnes for ham, ikke en risiko.

**E. Løbslære-fokus (trin 2) er aldrig bygget.** Specens §2.3 flytter `positioning`, `tactics` og `aggression` til et nyt fokus. Med kun én til to evner over 90 pr. rytter bliver fokus-størrelser et balance-håndtag. Skal trin 2 med i samme opdatering?

---

## Filer og kontrakter du kommer til at røre

| Fil | Hvad |
|---|---|
| `backend/lib/riderProgression.js` | `loftByPotential` flades ud, `rateByPotential` spredes til 3x |
| `backend/lib/dailyTraining.js` | `dailyAbilityDelta` — væksten er gap-proportional, se nedenfor |
| `backend/scripts/spillervendteGates3709.mjs` | dine gates. Udvid dem, slæk dem aldrig uden ejer-go |
| `backend/scripts/rytterudviklingScorecard.js` | de gamle fem gates. Kræver `--baseline` til en worktree på main |
| `frontend/src/components/rider/ScoutablePotentiale.jsx` | viser potentiel rating i dag; skal vise prognose |
| `backend/lib/scoutingReport.js` | `ratingFromAbilities`, bruges af begge |

**Afledte flader der SKAL med i afledningstjeklisten:** scout-båndet (#1162), `predictBaseValueV4` i økonomien, #3503's G3-præcision, og loft-bånd-inversionen #3679 som allerede er kendt fejlende.

---

## Det ene stykke mekanik du skal forstå før du rører raten

Væksten er **gap-proportional** (`dailyTraining.js:106`):

```
gap             = loft − nuværende evne
dagens fremgang = gap × alders-budget × rolle-rate / 28
```

Raten er altså **en andel af den resterende afstand**, ikke point pr. dag. Konsekvensen er kontraintuitiv, og den kostede mig en fejl 15/8: **sænker man loftet, går udviklingen langsommere**, fordi gappet skrumper. Ejeren spurgte direkte til det, og forklaringen overbeviste ham.

Det betyder at tag og rate ikke kan kalibreres hver for sig. Ændrer du det ene, skal det andet efterjusteres, og kun gates kan fortælle dig hvor meget.

Det betyder også noget vigtigt for S4: fordi man altid kun lukker en andel af resten, **nærmer man sig taget asymptotisk og ankommer aldrig**. Skal 90 kunne nås, skal taget ligge et stykke over 90. Med S1's krav om at taget aldrig må nå 95 er vinduet altså cirka **92-94**. Verificér det selv frem for at stole på tallet her.

---

## Faldgruber fra denne uge. Alle sammen ægte.

1. **Cwd hopper.** Bash-værktøjets working directory sprang tilbage til hoved-checkoutet midt i sessionen, så `git checkout -b` skiftede branch i hovedrepoet i stedet for i worktreen, og en `grep` med relativ sti læste den forkerte fil. **Brug `git -C <sti>` og absolutte stier hele vejen.**
2. **Hent aldrig en hel fil fra en anden branch.** Jeg kørte `git checkout <branch> -- lib/training.js` og rullede dermed hele #3762 tilbage, inklusive `recovery`-intensiteten. Fanget kun fordi jeg tjekkede diffen mod main. Lav ændringen manuelt i stedet.
3. **Patch note-versioner kollideres af parallelle sessioner.** 7.130 var taget af en anden session mens jeg arbejdede. Tjek `origin/main` lige før push.
4. **Mål med faciliteter og staff.** Min første spring-gate gav 2,23 uden dem og 2,79 med. Uden dem måler du et scenarie ingen spiller er i, og spillernes +3 kom netop derfra.
5. **`repair3570`s frosne selvtest fyrer ved enhver konstant-ændring.** Det er designet sådan. Tilføj ledger-poster i `FACIT_MODELDRIFT`, redigér aldrig `DRYRUN_FACIT`.
6. **Aggregater skjuler det spillerne ser.** Median-potentiale 46 → 60 lyder som en justering. "Jakub er ikke længere done som climber" er hvad det var. **Lav en før/efter-tabel for fem navngivne ryttere fra prod før du beder om merge.**
7. **18 testfiler fejler på main** uden env/secrets (cron, discord, seasonTransition, routes, audits). Kør altid suiten mod ren main i samme worktree først, og sammenlign, ellers drukner dine egne fejl.

---

## Start sådan her

1. Læs `docs/NOW.md` og tjek "🤖 Working agent" for andre aktive sessioner.
2. Læs `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md`, især §2.2, §2.5, beslutning 8 og hul 5. Trin 7 er allerede beskrevet der.
3. Kør `spillervendteGates3709.mjs` og få din egen baseline.
4. Læs Discord siden sidst. `scripts/discord/.sweep-daily-*.md` dækker en dag hver. Spillerne er den bedste kilde til hvad der faktisk er galt, og de opdagede begge denne uges fejl før vi gjorde.
5. **Stil spørgsmål A til E med visuals, før du skriver kode.**

Ejerens ord ved close-out 15/8: *"Ikke noget mere med at designe noget, som aldrig bliver lavet. Hvis vi designer en fed løsning, så skal den laves."*
