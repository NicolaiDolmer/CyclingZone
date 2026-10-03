# Generatorens rytterbindinger (#5860)

**Mandat:** ejerens Codex-session 3/10; backend-brandfix uden spillertekst eller prod-skrivning.
**SSOT:** `docs/CALENDAR_RULES.md` §2b/§8 og `docs/ASSISTANT_RULES.md` §1. Én rytter pr. løbsdag; igangværende etapeløb binder hele spændet. Faktisk deltagelse følger rytteren efter holdskifte.

- [x] Læs #5693/PR #5697 og nyere deltagelsesvagt. Det eksisterende pre-delete-fix dækker kun ændrede enheder for samme hold.
- [x] Observer fire fejlende generator-tests: frosset løb hos tidligere hold og immutable participation, med og uden batch-RPC. Næste løbsdag og anden sæson er kontrolcases.
- [x] Indlæs kanonisk `race_entries.binding_span` og relevante `race_day_participation` pr. kandidat og sæson med stabil paginering; indekser efter rytter i en ny `.ts`-kerne. S4 havde 195.600 entry-day-rækker: ét span pr. entry undgår dette store sweep-load.
- [ ] Lås eksterne enheder uafhængigt af ejer/pulje/trup. Egne regenererbare enheder fordeles fortsat samlet; manuelle og frosne udtagelser bevares. Deltagelsesdage er præcise enkeltdage.
- [ ] Genbrug bindingerne ved UQ-retry. Fejlede læsninger må aldrig tolkes som ledige ryttere.
- [ ] Verificér regressionerne og #5693-kontrol, preflight og FULL gennem verify-lock, TypeScript, uafhængigt read-only review og CodeRabbit.
- [ ] Read-only dry-run og målte tal på issue. Ingen data-reparation, flags eller migration.
- [ ] PR, tilladt merge-kø, production READY/main-checks og straks issue-status.

**Patch notes:** ingen spillertekst ændres i dette Codex-spor jf. OPERATING_PLAN; Claude samler eventuel spillerkommunikation.
**Afgrænsning:** regenerate-endpointets separate binding-hul og fallback-restore-huller må ikke erklæres løst af generatorens preload.
