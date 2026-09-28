# Spillerforklaring: træning pr. løbsdag (28/9, #5885)

> **Status:** Godkendt retning fra ejeren 28/9: få ting, simpelt, ingen tal og faktorer. Postes FØRST når PR #5880 er merged og live (ungdomsfix + etapeløbsregel A), og efterkontrollen #5879 har set det virke.
> **Stemme:** Nicolais (jeg-form, "Hep!", kort, ærlig, ":)" sparsomt). EN først, DA bagefter.
> **Ingen tal:** skriv aldrig 1.35/1.60/0.35 eller lign. til spillerne (ejer 28/9: "for meget information").
> **Visuel side:** `docs/player-comms/2026-09-28-race-day-training.html` (også publiceret som privat Claude-artifact; ejeren deler linket).

## Kernen (skal gå igen overalt, ordret eller næsten)

**EN**
1. Every real day has 5 race days.
2. On each race day, a rider either races or trains. Never both (the only exception: rest days in a stage race, see 4).
3. Racing trains what the stage demands (flat, hills, mountains, cobbles…) at medium intensity. Training trains what you pick.
4. Stage races: on a day he rides a stage, the rest of that day is training. A full day without a stage in the middle of a stage race is a rest day.
5. It's all settled in the evening after the last race (from 20:00).

Tip: pick races that suit the rider, and use the free race days to train what the race doesn't give him.

**DA**
1. Hver rigtig dag har 5 løbsdage.
2. På hver løbsdag kører rytteren løb ELLER træner. Aldrig begge (eneste undtagelse: hviledage i et etapeløb, se 4).
3. Løb træner det etapen kræver (fladt, bakker, bjerge, brosten …) på mellem-intensitet. Træning træner det, du vælger.
4. Etapeløb: på en dag hvor han kører en etape, er resten af dagen træning. En hel dag uden etape midt i et etapeløb er hviledag.
5. Det hele gøres op om aftenen efter sidste løb (fra kl. 20).

Tip: vælg løb der passer til rytteren, og brug de frie løbsdage på det løbet ikke giver ham.

## Forum: svar i tråden "Dialy training vs Race Training" (EN)

> Hep!
>
> Thanks for the good questions, and thanks Dolamba for translating. Here's how it works, short version:
>
> 1. Every real day has 5 race days.
> 2. On each race day, a rider either races or trains. Never both (the only exception: rest days in a stage race, see 4).
> 3. Racing trains what the stage demands at medium intensity. Training trains what you pick.
> 4. Stage races: on a day he rides a stage, the rest of that day is training. A full day without a stage in the middle of a stage race is a rest day.
> 5. It's all settled in the evening after the last race.
>
> So a one-day race only uses 1 of his 5 race days that day. The other 4 are the training you picked.
>
> About the junior climbers in a flat race: you're right, they get flat training from those stages, not climbing. That's the trade: results and all-round riders vs. pure specialisation. If you only want climbing development, keep him out of flat races, that's a legit choice. Or pick races that suit him, then racing and development point the same way.
>
> One correction to something I said on Discord: the level of the race doesn't change development yet, only the type of stage. Racing at the right level is where I want to go, and I'll tell you when it's in.
>
> And a bug fix: U23 and junior races now count as racing too. Before the fix they could end up as a rest day.
>
> I made a visual walkthrough with the most common questions: [link]
>
> Dolmer

## Discord #dansk-snak: samlet svar (DA)

> Hep! Samler lige svarene på træningsspørgsmålene ✌️
>
> 1. Hver rigtig dag har 5 løbsdage.
> 2. På hver løbsdag kører rytteren løb ELLER træner. Aldrig begge (eneste undtagelse: hviledage i et etapeløb, se 4).
> 3. Løb træner det etapen kræver på mellem-intensitet. Træning træner det du vælger.
> 4. Etapeløb: på en dag hvor han kører en etape, er resten af dagen træning. En hel dag uden etape midt i et etapeløb er hviledag.
> 5. Det hele gøres op om aftenen efter sidste løb.
>
> **Skal jeg ændre træning efter dagens etaper?** Nej, tværtimod. Løbet træner allerede etapens evner. Brug de frie løbsdage på det løbet ikke giver ham.
>
> **Hvornår tæller det jeg sætter nu?** I aften. Den plan der står, når aftenens kørsel går i gang, er den han træner.
>
> **Kan mindre hold indhente de store?** Alle divisioner har de samme 5 løbsdage om dagen, bonussen for at klikke selv er væk, og AI-holdene kører efter samme regler. Kører du færre løb, har du flere løbsdage til præcis den træning du vil have.
>
> **Rettelse fra mig:** løbets niveau betyder ikke noget for udviklingen endnu, kun etapetypen. "At køre på sit eget niveau" er dér jeg vil hen, og jeg siger til når det er med.
>
> **Fejl rettet:** U23- og juniorløb tæller nu også som løb. Før kunne de ende som hviledag.
>
> Visuel forklaring her: [link]

## Discord #dansk-strategi: formspørgsmålet (ubesvaret, DA)

> Du gør ikke noget forkert 🙂 Form bygges kun op, når trætheden ligger i midten. Efter et etapeløb er han træt, og hårde dage holder ham træt, så formen bliver ved med at falde. Giv ham let træning eller restitution til trætheden er nede i midten, så stiger formen hurtigt igen.

## help.json (en + da): forslag til Codex

Følg `frontend/src/pages/helpFlagGates.js` (per-løbsdag-teksterne vises når `training_tick_per_race_day` er on). Brug kernen ovenfor. Mindst:

- Ny/omskrevet sektion under `sections.dailytraining`: punkt 1-5 fra kernen.
- FAQ: "Can my rider train on a day he races?" / "Should I change training to match today's stage?" / "What happens during a stage race?" / "When does a change count?" / "Does the level of the race matter?" (svar: ikke endnu, kun etapetypen).
- Opdatér eksisterende tekster der siger noget andet om etapeløbets hviledage (grep `stageRaceRestDayFaq`, `raceDaysPerRaceDay`).
- Ingen tal/faktorer i teksten.

## Patch note (EN først, én version)

- **Training (fixed):** U23 and junior races now count as racing, like senior races. Before, they could end up as a rest day.
- **Training (improved):** Stage races: on a day your rider rides a stage, the rest of that day's race days are training. Only a full day without a stage in the middle of a stage race is a rest day.
