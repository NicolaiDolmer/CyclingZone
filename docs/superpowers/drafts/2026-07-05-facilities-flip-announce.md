# Flip-announce draft — FACILITIES_ENABLED (anvendes ved ejer-flip, Plan B)

## Patch note (indsæt øverst i frontend/src/data/patchNotes.js — bump til næste version, fx 6.64)
{
  "version": "6.64", "date": "<flip-dato>", "label": "Beta",
  "changes": [{
    "category": "new", "audience": "player", "topic": "Club",
    "en": { "title": "Build your club: facilities and staff",
      "body": "Spend your surplus on five facility tracks — training, scouting, medical, academy, and commercial — each with five tiers, and hire a chief for every track. Prices are shown in CZ$ and in seasons of profit, so you can see the real cost. Facilities absorb your winnings and unlock effects as each engine comes online, starting with training." },
    "da": { "title": "Byg din klub: faciliteter og staff",
      "body": "Brug dit overskud på fem facilitets-spor — træning, scouting, medicinsk, akademi og kommerciel — hver med fem tiers, og ansæt en chef for hvert spor. Priser vises i CZ$ og i sæsoners overskud, så du kan se den reelle pris. Faciliteter opsuger din gevinst og låser effekter op efterhånden som hver motor lander, med træning først." },
    "refs": [1441]
  }]
}

## Help (indsæt i public/locales/{en,da}/help.json under sections — ny "club"-sektion)
EN: sections.club = { "label": "Club", "whatClub": { "title": "What is the Club?", "text": "The Club is where you invest your surplus in facilities and staff. There are five facility tracks, each with five tiers. Each tier costs a one-off price (shown in CZ$ and in seasons of profit) plus a small per-season upkeep. Every track also has a chief you can hire — the facility sets the ceiling, the chief sets how much of it you use, so both matter. The commercial track is a pure long-term investment toward merchandise and never pays for itself directly." } }
DA: sections.club = { "label": "Klub", "whatClub": { "title": "Hvad er Klubben?", "text": "Klubben er hvor du investerer dit overskud i faciliteter og staff. Der er fem facilitets-spor, hver med fem tiers. Hvert tier koster en engangspris (vist i CZ$ og i sæsoners overskud) plus en lille drift pr. sæson. Hvert spor har også en chef du kan ansætte — faciliteten sætter loftet, chefen sætter hvor meget af det du udnytter, så begge betyder noget. Det kommercielle spor er en ren langsigtet investering mod merchandise og betaler sig aldrig direkte tilbage." } }
