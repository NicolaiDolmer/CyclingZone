# Flip-announce draft — FACILITIES_ENABLED (anvendes ved ejer-flip, Plan B)

## Patch note (indsæt øverst i frontend/src/data/patchNotes.js — bump til næste version, fx 6.64)
{
  "version": "6.64", "date": "<flip-dato>", "label": "Beta",
  "changes": [{
    "category": "new", "audience": "player", "topic": "Club",
    "en": { "title": "Build your club: facilities and staff",
      "body": "Spend your surplus on five facility tracks (training, scouting, medical, academy, and commercial), each with five tiers, and hire a chief for every track. Prices are shown in CZ$ and in seasons of profit, so you can see the real cost. Facilities absorb your winnings and unlock effects as each engine comes online, starting with training." },
    "da": { "title": "Byg din klub: faciliteter og staff",
      "body": "Brug dit overskud på fem facilitets-spor (træning, scouting, medicinsk, akademi og kommerciel), hver med fem tiers, og ansæt en chef for hvert spor. Priser vises i CZ$ og i sæsoners overskud, så du kan se den reelle pris. Faciliteter opsuger din gevinst og låser effekter op efterhånden som hver motor lander, med træning først." },
    "refs": [1441]
  }]
}

## Help (indsæt i public/locales/{en,da}/help.json under sections — ny "club"-sektion)
EN: sections.club = { "label": "Club", "whatClub": { "title": "What is the Club?", "text": "The Club is where you invest your surplus in facilities and staff. There are five facility tracks, each with five tiers. Each tier costs a one-off price (shown in CZ$ and in seasons of profit) plus a small per-season upkeep. Every track also has a chief you can hire. The facility sets the ceiling, the chief sets how much of it you use, so both matter. The commercial track is a pure long-term investment toward merchandise and never pays for itself directly." } }
DA: sections.club = { "label": "Klub", "whatClub": { "title": "Hvad er Klubben?", "text": "Klubben er hvor du investerer dit overskud i faciliteter og staff. Der er fem facilitets-spor, hver med fem tiers. Hvert tier koster en engangspris (vist i CZ$ og i sæsoners overskud) plus en lille drift pr. sæson. Hvert spor har også en chef du kan ansætte. Faciliteten sætter loftet, chefen sætter hvor meget af det du udnytter, så begge betyder noget. Det kommercielle spor er en ren langsigtet investering mod merchandise og betaler sig aldrig direkte tilbage." } }

## A4b-tillæg (staff-rigdom — #2220, merges FØR flip, admin-only indtil flip)

**Hvorfor ingen live patch-note nu:** A4b er admin-gated (`facilities_enabled`-flag false → kun admins ser /klub + /staff på prod). Ingen player-facing ændring før ejeren flipper. Ved flip, UDVID patch-note-body'en ovenfor (6.64) med staff-profil-sætningen nedenfor.

**Tilføj til patch note-body (en):** " Every chief now has a clickable profile with an overall rating and ability columns, so you can compare candidates by strength and specialization before hiring, and a season-cost strip on the club page shows upkeep and payroll against your balance."

**Tilføj til patch note-body (da):** " Hver chef har nu en klikbar profil med en samlet rating og evne-kolonner, så du kan sammenligne kandidater på styrke og specialisering før du ansætter, og en sæson-omkostnings-stribe på klub-fladen viser drift og lønninger op mod din saldo."

**Help — udvid `sections.club` med en `staffProfiles`-post (en):** { "title": "Staff profiles and specializations", "text": "Click any hired chief to open a profile that mirrors a rider's: an overall rating drives how much of the facility's effect is realised, and ability columns show their coaching dimensions (physical, mental, technical) and level focus (youth, junior, senior). A chief's specialization matters — a physical-youth coach lifts young riders' physical training more than a generalist. When hiring, candidates show their overall and top specialization so you can pick the best fit for your squad and budget." }

**Help (da):** { "title": "Staff-profiler og specialiseringer", "text": "Klik på en ansat chef for at åbne en profil der spejler en rytters: en samlet rating afgør hvor stor en del af facilitetens effekt der realiseres, og evne-kolonner viser coaching-dimensioner (fysisk, mental, teknisk) og niveau-fokus (ungdom, junior, senior). En chefs specialisering betyder noget — en fysisk-ungdoms-coach løfter unge rytteres fysiske træning mere end en generalist. Ved ansættelse viser kandidater deres overall og top-specialisering, så du kan vælge den bedste til din trup og dit budget." }
