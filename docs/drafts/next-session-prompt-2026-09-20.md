# Næste session: ejeren vælger og rangerer de næste 10 ting frem mod sæsonskiftet 27-28/9

> Forrige session: 19/9 (ejer-kort hele dagen). Alt besluttet står i issues #5405, #5267, #4924, #5383 og i `docs/NOW.md`. Ejeren sagde 19/9 (ordret): "Jeg har brug for, at være mere indover de næste 10 ting der produceres, for at vide at vi rent faktisk vælger de rigtige ting og den rigtige rækkefølge i forhold til det sæsonskifte der snart sker."

## Prompt (kopiér herfra)

Læs `docs/NOW.md`, `docs/drafts/next-session-prompt-2026-09-20.md`, `docs/audits/2026-09-19-saesonskifte-overblik.md` og `docs/audits/2026-09-19-loefter-til-spillerne-mod-status.md` først. Vis mig overblikket (version 2, med mine løfter til spillerne) som FIL, og lad mig vælge og rangere de næste 10 ting. Start intet byggespor, før jeg har valgt.

## Arbejdsform (ejer 19/9, bindende for sessionen)

- Første kort: `docs/audits/2026-09-19-kort/saesonskifte-overblik-v2.png` + `loefter-status.png` som FIL. Ejeren vælger og rangerer; orkestratoren anbefaler IKKE en top 10 uopfordret, men svarer ærligt på "hvad går i stykker, hvis det ikke er klar".
- INTET spor startes uden for ejerens liste. Højst 2-3 spor ad gangen, så han ser hvert resultat, før det næste går i gang.
- Ét kort ad gangen, almindeligt sprog, billede som fil i samme tur, prod-tal. Find aftalen FØR du spørger: grep regel-doc'en (TRAINING_RULES/CALENDAR_RULES), ikke kun issue-kommentarer. **140 løbsdage er LÅST (15/9); spørg aldrig om tallet.**
- Før en spiller-afstemning eller udmelding: hver mulighed skal være bevist byggelig ved en kørsel. Ejeren skriver og poster selv.

## Hvad der ligger klar til beslutning (rækkefølgen er ejerens)

1. **Den største enkeltbeslutning:** skal U23/junior med i S4 eller vente til S5? Overblikket læser U23-sporet (ryttere, kalender, trup-flader, Graduation Day) som ikke-nåeligt til 27/9; det kolliderer med ejerens løfter 6, 17, 18, 19. Se løfte-rapportens punkt (b) og (d).
2. **Nye bjergløb til kataloget** (PR #5414, udkast): tre løb med virkelige forbilleder (O Gran Camiño, Österreich-Rundfahrt, Volta a Portugal) + en reservations-ændring bringer alle fire divisioner i mål på bjerg OG enkeltstart i tørkørsel. Kræver ejer-valg: navnene, og at de ligger én klasse over deres virkelige. Billede: `balance-internals/2026-09-19-s4-kalender-kvalitet/nye-bjergloeb.png` (lokalt). Nødløsning hvis det ikke nås: byttet "mulighed A" (PR #5412).
3. **Forsynings-kontrol** (PR #5413, intern, read-only, reviewet): venter på "merge".
4. **S4-kalenderen synlig senest man 21/9:** forudsætningerne er merget (#5407 #5408 #5409). Mangler: S4-rækken (`upcoming`) + `--apply`, hvert skridt med eget ejer-go (CALENDAR_RULES §2d, UDEN `--uniform-tilt`). Overblikket peger på at årsmødet/mandater er tavst døde uden S4-rækken (#4838; tallet "237 hold" er ikke eftertjekket af orkestratoren).
5. **Afstemning A/B om træningsdagenes placering:** materialet ligger i `docs/audits/2026-09-19-kort/afstemning-*` (EN+DA, kort + detaljeret). Begge måder er prøvepakket grønne på #5169; træningssiden af begge kræver B4 (#5264). Vinder B, skal ejeren godkende ny ordlyd i 25/8- og 18/9-reglen.
6. **1-99-skalaen:** udmelding senest man 21/9 (potentiale punkt 6).
7. **Kontrast:** tekst-vagten fandt ca. 1.300 elementer under 3:1 fordelt på 7 farvepar (forslag til nye værdier står i PR #5410's body og `docs/audits/2026-09-19-5383-tekst-overflow-fund.md`). Eget kort med før/efter.
8. **Mail inden 24/9, Quad9-branden (#5323: Sentry-aflæsning ikke gjort), drejebog for skiftet (findes ikke), løn-fejlen ved pension i samme skifte (#4153), løbsdags-vagten (#4159):** se overblikket.

## Oprydning der IKKE blev gjort 19/9 (ærligt)

- **De forældreløse mapper er IKKE slettet.** Frisk scanning 19/9: kun 7 er helt tomme; ca. 880 indeholder en junction/symlink (typisk `node_modules` → delt mappe). En rekursiv sletning kan følge linket og slette MÅLETS indhold. Kræver et script der fjerner links uden at følge dem, testet på én mappe først, og nyt ejer-go (det gamle go gjaldt "mapper med nul filer"). Lav prioritet mod skiftet.
- **`FEATURE_STATUS.md` er 41 tokens over budget** (genereret fil; natrapporten 18/9 foreslår at hæve loftet eller droppe en kolonne). Ejer-/orkestrator-valg.
- `scripts/dev/wipeSeason3Calendar.mjs` mangler fem FK-tabeller mod dagens skema (fund i #5409); ret eller pensionér.
- To `riderShortName`-funktioner (lib/riderName.ts og planner/plannerShared.js) bør samles.

## Åbne PR'er ved sessionens slutning

#5414 (udkast nye bjergløb, docs) · #5413 (forsynings-kontrol) · #5412 (bjergdage-bytte, docs) · #5169 (kalender, merges ikke som den er) · #5264 (B4, rettes før merge) · #5281 (B3, flip-dagen) · #3512 · Dependabot #5379 (grøn; merge uden kørende laner + `npm run sync-deps`) #5356 (rød).
