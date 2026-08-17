# Postmortem · 2026-08-18 · AI-team wipe/delete-stier manglede inflight-rytter-guard (#2086)

## Hvad skete der?
53 af 57 droppede ryttere i Vuelta Burgalesa forsvandt fra `riders`-tabellen 29-30/6,
midt i løbet, formentlig via en sim-rytter-oprydning. #2074 lukkede hullet 3/7 med en
BEFORE DELETE-trigger på `riders` (`trg_block_rider_delete_inflight`, live i prod) der
kaster hvis rytteren har entries i et igangværende løb — men to eksisterende
kode-stier i `aiTeamGenerator.js` (`deleteAiTeamById`, `clearAllAiTeams`) sletter
stadig ryttere med et ufiltreret `.delete()` UDEN at pre-tjekke inflight-status.
De ville derfor nu i stedet CRASHE mod DB-triggeren — for `clearAllAiTeams`
(relaunchens engangs-wipe af ALLE AI-hold) ville en enkelt ramt rytter rulle HELE
batchen (op til 500 hold) tilbage, i stedet for at springe det ene hold over.

## Root cause
`removeAiTeams` (#2269) pre-tjekker allerede `getInflightRaceIds`/
`teamHasInflightEntries` før den sletter — men `deleteAiTeamById` (heal-sweep-retry)
og `clearAllAiTeams` (relaunch-wipe) blev tilføjet uafhængigt og fik aldrig samme
guard. #2074-DB-triggeren (3/7) lukkede DB-laget generelt, men gjorde disse to
kode-stier sårbare for en NY fejlklasse: en unhandled throw der aborterer hele
operationen, i stedet for enten en succesfuld sletning eller en ren skip.

## Fix
`backend/lib/aiTeamGenerator.js`: ny delt helper `getBlockedRiderIds(supabase,
riderIds)` — samme inflight-definition som `getInflightRaceIds`/DB-triggeren (ingen
`race_type`-filter). Begge funktioner filtrerer nu blokerede ryttere fra FØR
`.delete()`: de øvrige ryttere + holdet slettes som før, det/de berørte hold
markeres `pending_removal_at` (genbruger #2187-heal-sweep-mekanikken) i stedet for
at kaste. Ingen adfærdsændring i normaltilfældet (0 blokerede ryttere).

## Forhindret-fremover
34 unit-tests i `aiTeamGenerator.test.js` (deraf 3 nye #2086-tests) dækker både
`deleteAiTeamById` og `clearAllAiTeams` med en rytter i et igangværende løb.
DB-triggeren fra #2074 forbliver det egentlige sidste forsvarslag for ALLE
raw-SQL/script/admin-API-sletninger — denne fix er defense-in-depth for de to
app-lags-stier der ellers ville ramme den og crashe synligt.

## Læring
Et delt DB-lags-forsvar (trigger) lukker IKKE automatisk app-lags-hullerne der gav
anledning til det — det omdanner dem bare fra "tavs data-korruption" til "unhandled
throw". Når en ny guard-migration lander (#2074, 3/7), skal ALLE eksisterende
delete-stier for samme tabel grep'es igennem og enten få samme pre-check eller et
eksplicit try/catch på guardens fejlkode — ikke antages dækket, fordi DB'en nu
"fanger" det. Verificeret ved grep: `getInflightRaceIds`/`teamHasInflightEntries`
brugt konsekvent på tværs af transfer/auktion (#1995), squad-enforcement (#2617),
contractExpiryRelease — kun de to AI-team-wipe-stier manglede den.
