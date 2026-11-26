# 26/11: Kontraktloftet gjaldt ikke på alle oprettelsesveje (#7138, PR #8763)

**Symptom:** Kontrakter kunne oprettes eller forlænges ud over det fælles loft, fordi kun nogle veje (auktion, transfer) brugte loftet, mens akademi-optag, akademi-transfer, batch-forlængelse, holdflytning og buyout regnede længden selv. Sæsonnummeret blev desuden læst forskelligt (aktiv sæson, men ingen fallback i sæsonpausen, og to aktive sæsoner gav PGRST116).

**Rodårsag:** Ingen fælles funktion for "kontraktens slutsæson" og "hvilken sæson regner vi fra". Hver vej havde sin egen kopi.

**Rettelse:** `cappedContractTerm(start, length)` og `resolveContractSeasonNumber(supabase)` i `backend/lib/contractSeed.js`, brugt af alle oprettelsesveje. Sæson: aktiv → første kommende → seneste afsluttede + 1; ved to aktive tages den nyeste.

**Forebyggelse:** Nye kontraktveje skal bruge de to funktioner (tests i `contractSeed.test.js` dækker loft, pause og PGRST116). Regel skrevet i `docs/ECONOMY_RULES.md` ("Fælles kontraktloft", "Sæsonpausen").
