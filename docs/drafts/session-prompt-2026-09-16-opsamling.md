# Session-prompt: opsamling 16/9 (eller 17/9)

Ejeren bad 16/9 formiddag om en session hvor vi "catcher op paa den slags ting". Det er denne.
Tre emner ligger og venter. Ingen af dem er bygget. Ingen af dem maa bygges foer ejeren har sagt ja.

Trin 0: laes `docs/NOW.md`. Koer `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek
`.claude/run/wave-active.json`. Koer `npm run sync-deps` FOER backend-tests: `zod` mangler lokalt,
saa `routes/api.test.js`, `routes/raceStrategy.contract.integration.test.js` og
`routes/rankings.test.ts` fejler med `Cannot find package 'zod'`. De tre fejl er IKKE en regression.

Du er orkestrator (Fable). Du udfoerer aldrig selv byggearbejde. Byg KUN via
`.claude/workflows/wave.js`, model eksplicit. Eet delpunkt pr. kort, eet eksempel med prod-tal,
een anbefaling. Laes issuets seneste kommentarer FOER kortet. Merge kun paa ordret "merge".

---

## 1. Loft-designet - langsigtet loesning (HOEJEST, ren samtale)

Ejeren 16/9 ordret: "Kan vi lige tale om en langsigtet loesning paa dette og disse ting senere i dag
eller i morgen?" Han vil IKKE have endnu en lap.

**Rodproblemet, som er stoerre end de to evner:** `abilityRoleClass` er **binaer paa fortegn**
(`backend/lib/riderProgression.js`). Enhver positiv caps-vaegt - ogsaa vaegt 1 - giver `signatur`
og dermed tag 93. Klassen siger altsaa ikke hvor meget en evne betyder for en type; det goer vaegten.
Derfor var et loft det eneste vaerktoej der fandtes, og derfor ramte det skaevt:

| Evne | Vaegt | Type(r) | Hvad loftet paa 70 koster |
|---|---|---|---|
| `aggression` | 3 | baroudeur | 8,4 ratingpoint - **fjernet 16/9, #5297** |
| `teamwork` | 1 | climber, rouleur | 1,6 / 1,8 ratingpoint - staar stadig |
| `leadership` | 1 | gc, sprinter | 1,5 / 1,8 ratingpoint - staar stadig |

Det forklarer thelambas "gc og sprinter ca. -2". `MENTAL_ABILITY_TAG_CEILING` er nu
`{tactics: 55, teamwork: 70, leadership: 70}` og skal staa uroert indtil ejeren har valgt.

**Det der skal paa bordet:** et loft kan ikke skelne mellem en rytter der EJER en evne og en der
BRUGER den. To retninger findes allerede i kodebasen:
- **Vaegtet rolleklasse** - lad tag'et falde med vaegten i stedet for at vaere binaert.
- **Gulv i stedet for loft** - spejl `GC_PUNCH_FLOOR = 80` (#4634/#4098), som loeser den omvendte
  version af samme problem.

Forbered forskellen i tal FOER kortet, saa ejeren ser hvad hver retning goer ved de fire typer.
Byg intet uden et ja.

**Konsekvens for punkt 3:** #5268-point-flytningen boer afvente denne beslutning. Flyttes 8.160
rytteres point nu, sker det under en formel der er paa vej til at aendre sig igen.

## 2. Sponsor #4860 / PR #5263 - HAR EN DEADLINE

Ejeren har tre gange udskudt den, to af gangene fordi forklaringen ikke landede ("Jeg ved ikke hvad
du snakker om"). Forklaringen der virkede 16/9, brug den igen:

> Prisen paa en sponsoraftale afhaenger i dag af hvilken DAG manageren klikker. Vaelger han foer
> foerste loeb, findes der ingen resultater, og han faar laveste sats. Vaelger han efter en god uge,
> faar han op til 40 % mere for praecis samme aftale. Den der er hurtigt ude bliver straffet; den der
> slet intet goer faar automatisk bedste sats ved saesonskiftet. Hjaelpeteksten siger allerede at
> belobet laases naar saesonen starter - det er ikke det koden goer.

Konkret: Team WolkerWessels valgte 27/8, dagen foer foerste S3-loeb, og laaste 368.000. Han ligger
nr. 1 af 48 i D2, hvilket svarer til 515.200. Forskel 147.200 paa basen, 160.000 CZ$ for saesonen.
30 hold laaste laveste sats mellem 23/8 og 28/8; samlet ca. 3,0 mio. CZ$.

Billede: `docs/audits/2026-09-15-5267-visuals/4860-sponsor-foer-efter.png` - vis det i SAMME tur
som kortet. PR #5263 er draft.

**DEADLINE: de 33 aftaler laases endeligt naar S4 starter 27/9.** Rettelsen (genpris ved
aktivering mod de endelige standings) retter dem automatisk i overgangen - men kun hvis den er live
inden da. Efter 27/9 kraever det manuel datareparation. Sig det tal til ejeren.

## 3. To apply-go-kort (ejer ser tal live, EEN mutation ad gangen)

- **Evne-point-flyt #5268:** `infisical run --env=prod -- node backend/scripts/dry-run-5268-mental-abilities.js --dry-run`.
  V1 vs V2, anbefalet V2, evt. ANDEL da massen ellers stiger 54 %. **Afventer punkt 1.**
- **Trup-backfill #4619:** `node backend/scripts/backfill-4619-riders-squad.js --dry-run`.
  282 u23 / 249 junior, valg A. Uafhaengig af punkt 1, kan tages naar som helst.

Spillerbesked skrives af ejeren i begge tilfaelde.

---

## Status ved indgang (16/9 kl. ca. 10:20)

**Merget i dag:** #5297 (`a9de617a0`, fighter-loftet) og #5287 (`4602bb445`, patch note 7.277).
#5288 er flippet til `claude:done`. #5240 var sat til merge efter `update-branch`; **tjek om den
naaede igennem** (`gh pr view 5240 --json state,mergedAt`) - CI koerte forfra da sessionen sluttede.

**Parkeret af ejeren 16/9 - genaabn dem ikke af dig selv:**
- **#5281 (B3, fjern manager-klik-bonussen):** helt groen, men **IKKE bag flag**. Merges den alene,
  mister 62 af 371 hold deres +25 % uden at faa B4's erstatning, som ligger bag
  `training_tick_per_race_day` (off). Ejeren: vent paa B4.
- **#5267 loebsdage:** udskudt 1-2 sessioner. Ejeren 16/9: "Jeg husker det som om, at det hele
  naermest foeltes forkert." Han kunne ikke pege paa hvad. Spoerg IKKE igen foer han selv tager det
  op. Fakta der holder: D1 havde 86 loebsdage i S3; "140" er etaper (5 klokkeslaet x 28 dage).
- Dermed ogsaa parkeret: **#5169** (loebsdage 140) og **B4 #5264**s 7x5-grid. #5264 er desuden
  CONFLICTING og kan ikke `update-branch`es - den kraever en worker der fletter main ind i
  worktreet `C:\Dev\CyclingZone-worktrees\feat-4847-race-day-close-trigger`.

**Discord:** udkastet til korrektionen i traaden "New stats - Teamwork and leadership" ligger i
`docs/drafts/discord-2026-09-16-fighter-loft-korrektion.md`. **Tjek om ejeren har postet den**, foer
du naevner den igen. Han poster selv.

**#5296 welcome-mail (priority:high):** symptomet er formentlig en falsk alarm. Resend viser mailen
afsendt og delivered 10/9, 11/9, 12/9 (x2) og 15/9 kl. 23:08, kaeden
`Confirm Your Signup` -> `Your team is on the start line` -> `Day 1` intakt, ingen bounces. Mistanken
er flyttet til **mail-drift-vagten** (tidsvindue/tidszone eller kandidat-definition), ikke
udsendelsen. Naeste skridt: laes vagtens egen kode og sammenlign dens kandidat-query og vindue med
det udsendelsen bruger. Roer ikke mail-stien foer det er gjort. Evidens i issuet.

**Smaa worker-opgaver hvis der bliver luft:** #5289 (raa noegle `SELECTION.HUNTER` paa dansk
planlaegningsside) og #5290 (etapeloeb i morgen vises som "i dag"). Begge afgraensede, sonnet.

**Roer ikke:** #5285 tilhoerer en anden sessions boelge (#5284) og har 3 aegte CI-fejl. Tjek
`wave-active.json` FOER spawn.

**Token-hygiejne:** `docs/NOW.md` er trimmet til 1.199 tok (WARN, under fail-graensen 1.200 - den
ligger taet, saa trim gammelt vaek foer du skriver nyt). AGENTS.md og FEATURE_STATUS.md er fortsat
over budget; det er praeeksisterende.
