# Help-copy skrevet, registrering glemt (auctions.valuation + anonymityAndReveal)

**Dato:** 2026-08-21 · **Refs:** #4064, #4066, PR #4065 · Samme fælde som #2691 (FAQ).

## Symptom
To fuldt oversatte hjælpetekster (en+da) i `help.json` blev aldrig vist, fordi
`SECTION_DEFS`-blocks-arrayet i `HelpPage.jsx` ikke registrerede dem. i18n-guards
fanger det ikke: nøglerne ER gyldige og oversatte, de bliver bare aldrig slået op.

## Rod-årsag
To-trins-registrering (copy i JSON + blocks-entry i JSX) uden guard på tværs.
FAQ fik en guard efter #2691 (`HelpPage.faqKeys.test.js`), sektions-blocks fik ikke.

## Backwards-check
Sweep fandt 16 FLERE forældreløse sections-entries (transfers, watchlist, season,
dailytraining, academy, raceSelection) — ingen brugt andre steder i koden. De
registreres ikke blindt: copy kan være skrevet mod ældre mekanik. Afvikling: #4066.

## Forward-guard
`HelpPage.sectionBlocks.test.js`: orphan-detektion begge veje, en/da key-parity,
stale-allowlist-detektion. Allowlisten kan kun skrumpe. Negativ-testet.

## Læring
Ved todelt registrering (data + rendering-manifest) skal forward-guarden bygges
FØRSTE gang fælden bider — #2691-guarden dækkede kun FAQ-halvdelen af præcis
samme struktur i præcis samme fil.
