# En goals-rebuild ejede hele arrayet — og slettede andres mål (#4865)

**Dato:** 2026-09-06 · **Issue:** #4865 (Refs #4856, #4863) · **Klasse:** stille datatab

## Symptom

11 hold havde 23/8 et accepteret bonustilbuds ekstra-mål (`source: "bonus_offer"`,
target 1) i `board_profiles.current_goals`. 5/9 havde INGEN hold et bonus-mål —
hverken i `current_goals` eller `board_mandates.goals`. De 200.000 CZ$ pr. tilbud
var udbetalt. Kravet var væk. Ingen fejl i nogen log.

## Rod-årsag

`POST /board/sign` (`backend/routes/api.js`) byggede `current_goals` som et
**friskt** array (`buildBoardProposal` → `finalizeBoardGoals`) og upsertede det
oven i rækken. Alt hvad en ANDEN sti tidligere havde lagt i arrayet forsvandt
lydløst. `autoAcceptPendingPlan` (`backend/lib/boardAutoAccept.js`) havde
nøjagtig samme upsert-form og samme hul.

Bonus-målet overlevede sæsonskiftet (`economyEngine.processTeamSeasonEnd` sætter
kun `negotiation_status = 'pending'` og rører ikke målene), så det stod stadig i
den pending sæson-3-plan da spilleren signerede den — og forsvandt dér.

## Hvordan stien blev udpeget (og de andre udelukket)

* **`negotiated: true` er et fingeraftryk.** Flaget kan kun sættes af
  `buildNegotiatedGoal` via et ikke-tomt `negotiationIndexes`.
  `autoAcceptPendingPlan` sender ALTID `[]`. Alle 11 live-rækker bar mindst ét
  `negotiated: true`-mål ⇒ signerings-stien, ikke cronen.
* **Notifikationerne bekræftede det.** 0 af de 11 brugere har nogensinde fået en
  `notif.boardAutoAccepted.title` i vinduet 23/8-1/9; Team Majer fik en T-3-
  reminder 28/8, altså havde cronen endnu ikke overtaget da rækken allerede stod
  `completed`.
* **`focus` ændrede sig for 3 hold** (fx `star_signing` → `youth_development`).
  Auto-accept bevarer `existingBoard.focus`; kun `/board/sign` skriver et nyt
  focus fra request-body'en.

## Fælden vi næsten gik i: `updated_at` daterede ingenting

Alle 11 rækker stod med `updated_at = 2026-09-01 14:05:28.501` — samme
millisekund som 621 andre rækker. Det så ud som en bulk-skrivning der havde
slettet målene. Det var det ikke: `boardWeekendFinalization.js` (kaldt fra
`raceRunner.js` efter hver løbsweekend) skriver `updated_at: now.toISOString()`
med ÉT `now` for hele kørslen, og rører kun `satisfaction`, `budget_modifier`,
`season_start_satisfaction` og `season_start_anchor_season_id`. Samme forklaring
på den "uforklarede" bulk 5/9 14:05:11.578: 664 rækker, og præcis 0 af dem
tilhører et AI-/bank-/frosset/test-hold — nøjagtig funktionens egen
holdfiltrering.

**Lære:** en delt `now` i en løkke gør `updated_at` til et kørsels-stempel, ikke
et rækkes-stempel. Det kan ikke bruges til at datere en ændring, og det
overskriver sporet efter den sti der faktisk ændrede noget. Led efter et
FELT-fingeraftryk (her `negotiated: true`) i stedet.

## Fix (forward-guard)

`preserveExternalGoals` (`backend/lib/boardGoals.js`): en rebuild ejer kun de mål
motoren selv genererer (ingen `source`, eller `club_dna`). Mål med en fremmed
`source` bæres med over, dedupliceret på `bonus_offer_id` (eller indhold for
rækker fra før #4856). Wiret ind begge steder; `BOARD_AUTO_ACCEPT_SELECT` henter
nu `current_goals`. Test:
`backend/lib/boardGoalsRebuildGuard.test.js` — "rebuild af goals taber aldrig et
bonus_offer-mål" plus en end-to-end-kørsel af auto-accept-cronen (fejler før,
består efter).

## Sideobservation (ikke rettet her)

`appendBonusGoalToBoardProfile` skriver `JSON.stringify(...)` ind i jsonb-kolonnen
`current_goals`. Præcis de 11 ramte rækker stod derfor som jsonb-`string`, alle
øvrige 638 som `array`. Læsestien tåler begge (`parseBoardGoals`), men det er
dobbelt-encoding og gør SQL-analyse tungere. Reparationsscriptet skriver rigtige
arrays.
