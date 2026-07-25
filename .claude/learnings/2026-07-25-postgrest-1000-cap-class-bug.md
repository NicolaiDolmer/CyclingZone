# PostgREST's 1000-række-loft er en KLASSE-bug — jag klassen, ikke forekomsten

**Dato:** 2026-07-25 · **Refs:** #2907 (PR #2931), #2932 (PR #2935), historisk #2391/race_results

## Hvad skete

Cutover-auditen fandt at `loadHumanSeasonEndTeams` hentede ryttere uden paginering: 2.652 ryttere på menneskehold mod PostgREST's tavse 1.000-loft → første payroll + bestyrelses-evaluering ville køre på ~38 % af feltet, og bestyrelsesdommen skriver `budget_modifier` der binder sponsorindtægt i 3 sæsoner. Under fixet (#2931) fandt backwards-check-sweepen at `boardWeekendFinalization.js` havde PRÆCIS samme bug — med en kommentar der endda sagde "Paritet med loadHumanSeasonEndTeams" — og den kører efter HVER løbsweekend. Ugentlige board-evalueringer har altså kørt på partielt datagrundlag i ukendt tid (kan ikke repareres retroaktivt).

## Rodårsag

`.select().in()/.eq()` ser komplet ud og virker perfekt indtil datasættet passerer 1.000 rækker — så trunkerer PostgREST TAVST. Rytterbestanden voksede forbi loftet i takt med signups; ingen test fanger det, fordi test-fixtures er små.

## Læring

1. **Én forekomst af en tavs-trunkerings-bug = kør klasse-sweep med det samme.** #2931's sweep fandt #2932 samme dag. Grep-mønster: `.from("riders"|"race_results"|"finance_transactions"...).select` uden `fetchAllRows`/`.range(`.
2. **Enhver query mod en tabel der VOKSER med spillere/løb skal bruge `fetchAllRows` + stabil `.order("id")`** — også når den er "langt under loftet i dag" (season_standings er på 367/1000 og vokser med hver signup).
3. **Forward-guard-opskrift der virker:** mock supabase med 1000-række-sider via `.order().range()`-kæden og assert alle sider forbruges (se `#2907`-testen i economyEngine.test.js + fakeSupabase `.range()`-support fra PR #2935).
4. **Opfulgt 25/7 (#2951, PR-sweep samme dag):** season_standings (×4 kaldsteder økonomi-motor + 1 i boardWeekendFinalization), board_profiles + teams i loadHumanSeasonEndTeams/boardWeekendFinalization, finance_transactions-dedup (payDivisionBonuses), board_plan_snapshots-dedup (repairSeasonEndFinanceAndBoard), og loans i admin-season-end-preview-routen — alle nu pagineret via fetchAllRows. **Stadig bevidst udskudt** (samme klasse, lavere prioritet, ikke i #2951-scope): `updateStandings`'s ufiltrerede `teams`-select (legacy RPC-fallback-sti, 367 rækker 25/7) + samme funktions `season_standings`-penalty-select (bundet af team-count); `processSeasonStart`'s egen `teams`-query (156 rækker). Tag disse hvis en ny sweep-runde prioriteres.
