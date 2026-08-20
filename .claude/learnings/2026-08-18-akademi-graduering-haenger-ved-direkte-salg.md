# Postmortem · 2026-08-18 · Akademi-graduering hang ved direkte salg (#2793)

## Hvad skete der?
En solgt akademi-rytter talte hverken i akademi-regnskabet (P&L) eller i
transfer-profit. `academy_graduation` havde 0 rows i prod. PR #3288 løste
en del af problemet tidligere; resten stod tilbage som et bølge 3-følgefund
efter #3845 (akademi-ryttere kan nu sælges DIREKTE via auktion eller
transfermarked, uden om det almindelige graduerings-vindue).

## Root cause
To separate ting viste sig at gemme sig bag samme issue:
1. **Læse-stien var allerede fixet** (PR #3288/tidligere arbejde): `academyPnl.js`s
   salgs-detektion matcher på ALLE nogensinde signede `academy_intake`-rækker
   mod gennemførte auktioner/transfers, uafhængigt af `is_academy` — så
   #3845's direkte salg krævede ingen kodeændring der, kun en låsende test.
2. **Skrive-stien manglede**: når en akademi-rytter der ALLEREDE havde en
   PENDING `academy_graduation`-row (turneret 22, i override-vinduet) blev
   solgt DIREKTE via #3845 i stedet for graduerings-vinduets "sell"-handling,
   blev raekken aldrig resolvet. `academyGraduationSweep` ville senere finde
   den efter deadline og forsøge at auto-resolve en rytter der allerede har
   skiftet ejer — risiko for en phantom sælg-auktion (`createGraduateAuction`)
   for en rytter sælgeren ikke længere ejer.

## Fix
Ny `resolvePendingGraduationOnSale(supabase, { teamId, riderId, now })` i
`backend/lib/academyGraduation.js` — resolver en evt. pending row til
`status: 'sold'`, samme mønster som `academyTransfer.js`s `promote()`
allerede brugte for manuel promote (`status: 'promoted'`). Kaldes fra
`auctionFinalization.js` og `transferExecution.js` lige efter
`graduatePatch`-updaten, gated på `graduatePatch.is_academy === false`.
Best-effort: en fejl her vælter ALDRIG selve salget (pengene er allerede
flyttet), kun logges.

## Forhindret-fremover
Ny test i `auctionFinalization.test.js` og `transferExecution.test.js` der
låser fast at en pending `academy_graduation`-row resolves til 'sold' ved
direkte salg. Ny test i `academyPnl.test.js` der låser fast at en
akademi-rytter solgt DIREKTE via auktion (is_academy stadig true) tælles
med i salgs-poolen.

## Læring
Når et nyt salgs-flow (#3845: direkte salg af akademi-ryttere) åbner en vej
UDENOM et eksisterende state-machine-flow (graduerings-vinduet), skal alle
steder der SKRIVER til state-machinens tabel gennemgås for hængende rows —
ikke kun de steder der LÆSER fra den. Læse-stien var allerede robust
(matcher på rådata, ikke status), men skrive-stien havde ingen der ryddede
op efter den nye genvej.
