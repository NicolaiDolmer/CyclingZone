# 2026-05-21 — Filter-antagelse-drift: 2 crons + 1 embed med forældede filtre fundet ved prod-verifikation før sæson 0→1

## TL;DR

Pre-flight verifikation før sæson 0 → 1 transitionen kl 23:00 CEST afslørede
3 baggrunds-systemer der filtrerede team-/auction-data baseret på antagelser
der ikke længere matchede prod-virkeligheden:

1. **`processSquadEnforcementCron`** (+2 andre crons) manglede `is_frozen=false`
   filter → ville have ramt 4 frosne hold (Inuit + 3 test-hold) med tvungne
   auto-køb af 8 ryttere á 150% market value + 800K bøde per hold ≈ **32 forced
   purchases + 3,2M CZ$ bøder + 6.400 fradragspoint** kl ~23:05.

2. **`loadFinalWhistleData`** filtrerede auktioner på `seller_team_id IS NOT NULL`
   → ekskluderede 102 ud af 111 sæson-0 auktioner (alle fri-pool køb) →
   Discord-embed ville have rapporteret **9 deals / 292K volume** i stedet for
   faktiske **113 deals / 10,1M volume**.

3. Bonus: `computeFinalWhistleReport` lod én `biggestDeal` overskygge den anden
   kind → største manager-til-manager transfer blev skjult af største AI-pool
   auktion.

Begge bugs ville have ramt brugeren kl ~23:00-23:05. Begge er fixet, deployet
til prod (v3.83 + v3.84), og dækket af regressionstests.

## Hvordan blev de fundet

Brugeren spurgte "tjek om det hele kommer til at virke" før sæsonskifte.
Ved at query prod-DB direkte mod NOW.md's forventninger fandt jeg:

- **Bug #1:** `git grep '\.eq("is_ai", false)'` viste at 3 crons (`squadEnforcement`,
  `deadlineDayReport.fireDeadlineWarnings`, `cron.checkDebtWarnings`) manglede
  `is_frozen=false` mens 7 andre filer (`betaResetService`, `boardAutoAccept`,
  `boardMidSeason`, `boardSequentialNegotiation`, `economyEngine`, `seasonTransition`,
  `driftMonitor`) havde det. Inkonsekvent → ny is_frozen-feature (v3.80) blev
  ikke propageret overalt.

- **Bug #2:** Då brugeren spurgte hvad Final Whistle embed ville vise, sagde
  jeg fejlagtigt "intet at rapportere — open beta uden auktioner". Brugeren
  korrigerede mig ("der har været mange auktioner!"). Query mod `auctions`
  viste 111 completed, men kode-trace af `loadFinalWhistleData` viste at
  filteret ekskluderede dem alle.

## Rod-årsag (begge bugs)

**Filter-antagelse-drift:** Begge filtre var korrekte da de blev skrevet, men
verdenen ændrede sig under dem uden at filteret blev opdateret.

- **Squad enforcement-filteret** blev skrevet før `is_frozen` eksisterede.
  Filter-mønstret `is_ai=false, is_bank=false, user_id IS NOT NULL` matchede
  "alle aktive human-managers" indtil v3.80 introducerede en 4. dimension
  (`is_frozen`).

- **Final Whistle-filteret** blev skrevet med antagelsen at "Final Whistle
  rapporterer manager-vs-manager drama" — relevant i en moden sæson, men
  forkert i open beta hvor 90%+ af deals er pool-køb.

## Forward-guards

- **`is_frozen`-skip:** Defense in depth — `processSquadEnforcementCron`
  filtrerer ud på query-niveau + `enforceTeamSquadCompliance` har eksplicit
  early-return for direkte kald. Plus regressionstests for begge stier.

- **Final Whistle:** Inkluderer nu alle completed auctions, splitter
  `biggestAuction` + `biggestTransfer` separat, viser "fri pulje" for
  ai-pool deals. Tests dækker null-seller cases.

- **Generel disciplin:** Når et nyt team-flag/-status tilføjes (som
  `is_frozen` i v3.80), skal alle existing filtre auditeres for konsistens.
  Forslag: tilføj `grep -L 'is_frozen' backend/lib/*.js | xargs grep -l 'is_ai'`
  som CI-warning når nye filter-flags introduceres.

## Hvad jeg burde have gjort anderledes

1. **Når jeg auditerede v3.80 freeze-feature:** Jeg burde have grep'et for
   alle teams-filtre og verificeret at de nye flag-værdier blev respekteret
   overalt. Det blev ikke gjort på det tidspunkt — bugs sad latent i 1 dag.

2. **Min "intet at rapportere — open beta uden auktioner" var en gætværk.**
   Jeg antog noget om koden uden at læse implementation eller query prod.
   Det var brugeren der korrigerede mig, ikke omvendt. Memory-rule
   `feedback_runtime_verify_first` — verificér FØR claim — gælder også for
   off-handed bemærkninger i en flow-update.

## Relaterede memories

- [[feedback_backwards_check_forward_guard]] — quality-issues SKAL have begge.
  Begge fund blev fundet via backwards-check (grep for samme filter-pattern
  i hele backend).
- [[feedback_runtime_verify_first]] — bug #2 ville være fundet tidligere
  hvis jeg havde verificeret før jeg sagde "intet at rapportere".
