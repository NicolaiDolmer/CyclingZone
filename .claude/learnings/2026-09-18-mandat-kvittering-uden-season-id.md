# Mandat-kvittering uden season_id (#5359, CYCLINGZONE-63)

**Symptom:** Auto-accept-cronen (`board-mandate-auto-accept`) kastede 2x (17/9 19:44 + 18/9 01:14 UTC):
`board_satisfaction_events (mandate.signed) insert failed: null value in column "season_id"`.

**Rod-årsag:** `signMandate` (backend/lib/boardMandateMeeting.js) skriver to kvitteringer
(`mandate.signed`/`mandate.auto_signed` + `request.*`) til `board_satisfaction_events`, men
udfyldte aldrig `season_id`, som er `NOT NULL` siden tabellen blev oprettet (2026-06-18).
`persistConfidenceChange` i boardMandateEngine.js har altid sat den. Test-mocken accepterede
enhver payload, så fejlen var usynlig i tests. Prod har 0 `mandate.*`-kvitteringer nogensinde.

**Konsekvens:** Mandatet blev sat `active` FØR kvitteringen, så underskriften holdt; men
dual-write til `board_profiles` og svaret blev sprunget over. For de to ramte hold udfyldte et
senere kørsel `board_profiles` ~30 min efter (verificeret 18/9). Tabt: 2 formand-kvitteringer
(kosmetisk). En manager der selv underskrev på et hold med relation + formand ville have fået 500.

**Fix:** `season_id: mandate.season_id` på begge inserts. Mocken håndhæver nu NOT NULL.

**Forward-guard:** Test-mocks for tabeller med NOT NULL-kolonner skal afvise payloads uden
dem — ellers tester vi en database, der ikke findes.
