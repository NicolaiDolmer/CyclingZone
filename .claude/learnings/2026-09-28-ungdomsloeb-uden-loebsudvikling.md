# Ungdomsløb gav hvile i stedet for løbsudvikling (28/9)

**Symptom (fundet før første kørsel):** En U23- eller juniorrytter, der kørte et ungdomsløb på en løbsdag, ville få hvile i stedet for etapeprofilens medium-session.

**Root cause:** `loadRaceDayStagesByRider` (`backend/lib/raceDayStageLookup.js`) fandt kun løb i holdets `league_division_id`. Ungdomsløbene ligger i egne gruppe-divisioner (16-35 i S4), som holdet peger på via `u23_league_division_id` / `junior_league_division_id`. Bindingen (`race_entry_days`) er ikke divisions-scopet, så rytteren var "bundet, men kørte ikke" og fik `rest` (`dailyTrainingEngine.js`, `boundRestToday`).

**Fix:** Opslaget læser alle tre divisions-id'er fra `teams` og henter sæsonens løb i dem. Akserne er ens (5 løbsdage pr. dato, samme nummerering i alle trupper; verificeret i prod 28/9: dato d = løbsdag 5d..5d+4 for senior, U23 og junior).

**Læring:** Når en ny trup/akse tilføjes (#5644 ungdomskalender), skal hver læser, der scoper på `league_division_id`, have ungdomsdivisionerne med. Grep efter `league_division_id` i træningsstien ved næste trup-ændring.
