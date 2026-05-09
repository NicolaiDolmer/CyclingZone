import { useState } from "react";

const PATCHES = [
  {
    version: "2.96",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Manager · Næste sæsons forecast + 🟢/🟡/🔴 risk-tier (07g)",
        items: [
          "Manager · Ny prognose-sektion på Finanser-siden viser forventet cashflow næste sæson: sponsor + præmie − løn − lånerenter − lejegebyr = projected_net. Spændet (±20% på præmie-estimatet) viser usikkerheden, og en 🟢 grøn / 🟡 gul / 🔴 rød badge fortæller med ét blik om holdet er sundt, presset eller konkurs-tæt. Tærskler matcher 07g-spec: grøn = net ≥ +50K og gæld < 50% af loftet, gul = net mellem ±50K eller gæld 50-80%, rød = net < -50K eller gæld > 80% eller hvis underskuddet pejler mod gældsloftet inden for 2 sæsoner.",
          "Manager · Lille forecast-widget på Dashboard under squad-warning viser projected_net + risk-tier-badge så manageren kan måle finansiel sundhed uden først at klikke til Finanser-siden. Linker direkte til /finance for fuld breakdown.",
          "Manager · Kontekstuelle warnings rapporterer specifikke trusler: 'Forventet underskud', 'Gæld nær loftet (X%)', 'Med det nuværende underskud rammer du gældsloftet inden for 2 sæsoner — handl nu', 'Løn overstiger sponsor — rolig drift dækker ikke længere lønnen'. Hver warning er actionable (sælg en rytter, reducér lån, forhandl bedre sponsor).",
          "Backend · Ny pure-function `computeFinanceForecast` i backend/lib/financeForecast.js (11 unit-tests dækker 4 manager-arketyper + 7 edge cases inkl. risk-tier-grænser, sponsor-pullout, lejegebyr-vinduer). Endpoint `GET /api/me/finance-forecast` aggregerer team + roster + active loans + loan_agreements + boards + sponsor-pullouts + debt_ceiling og kalder pure-funktionen — UI er en tynd render af responsen. 448/448 backend-tests grønne (op fra 437).",
          "Hjælp · Ny FAQ 'Hvordan beregnes prognosen for næste sæson?' i Hjælp & Regler forklarer alle fem inputs (sponsor × board-modifier, prize_earnings_bonus, riders.salary, lån-renter, lejegebyr) plus risk-tier-tærsklerne og hvorfor præmie-estimatet er den variable komponent.",
        ],
      },
    ],
  },
  {
    version: "2.95",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Auktionsside viste '—' i Løn-kolonnen",
        items: [
          "Frontend · AuctionsPage Supabase-select hentede ikke `salary` for auktionerede ryttere, så Løn-kolonnen (både desktop-row og mobile-card) faldt tilbage til '—' selvom GENERATED salary-kolonnen var korrekt udfyldt i DB. Tilføjet til select-listen. Regression-test (readFileSync+regex på AuctionsPage.jsx) holder os ærlige hvis nogen fjerner et af de fire UI-renderede felter (salary, birthdate, nationality_code, potentiale) igen.",
        ],
      },
    ],
  },
  {
    version: "2.94",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Økonomi-dashboard udvidet med admin-feed + cron-korrelering (07e Fase B)",
        items: [
          "Admin · Ny 'Admin-handlinger'-sub-tab på Økonomi-sektionen viser et paginated feed af admin_log med filter på action_type (24 godkendte typer), admin user, target hold/rytter og dato-range. Klik på en row åbner en modal der pretty-printer den fulde meta-JSON, så du kan se nøjagtig hvilke felter en admin-handling påvirkede.",
          "Admin · Ny 'Korrelering'-sub-tab grupperer finance_transactions per (actor_id, source_path) med ±5s tidsvindue og lister cron-runs nyeste først med tx-count, Σ-beløb, antal hold ramt og reason-codes. Klik en run for at drille direkte ned i Transaktioner-view med pre-fyldte filtre — rydder hurtigt mistænkeligt store cron-batches.",
          "Backend · To nye admin-endpoints bag requireAdmin: `GET /api/admin/admin-log` (paginated + filtreret) og `GET /api/admin/cron-runs` (gruppe-aggregeret med konfigurerbart tidsvindue). Pure helper `groupCronRuns` i backend/lib/cronRunCorrelation.js holder grouping-logikken testbar uden HTTP/DB. CSV-bulk-export bevidst droppet fra scope — kører SQL direkte i Supabase Studio når ad hoc-eksport en sjælden gang skulle blive aktuelt.",
          "Backend · 12 nye unit-tests for cron-grouping + 4 nye route-ownership-assertions (admin-log + cron-runs admin-protection, default 7-dages vindue, NULL-actor-filter). 437/437 backend-tests grønne.",
        ],
      },
    ],
  },
  {
    version: "2.93",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Økonomi-dashboard (07e Fase A)",
        items: [
          "Admin · Ny 'Økonomi'-sektion i admin-panelet med tre sub-views der bygger på 07d's audit-trail-fundament: Sundhed (audit-population + balance-drift watchdog som live health-widgets), Overblik (per-hold tabel med balance, sponsor, gæld, gældsloft, ratio og 🟢/🟡/🔴 sustainability-badge filtreret per division), og Transaktioner (paginated finance_transactions-historik med filter på actor_type, reason_code, type, hold, sæson, source_path-substring, dato-range og beløbs-range).",
          "Admin · Klik på en transaktions-row åbner en drill-down-modal der viser alle 9 audit-kolonner inkl. kontrol af before/after-balance-invarianten (after − before = amount). Audit-leak detekteres automatisk og lyser rødt hvis nye finance_transactions skulle slippe igennem uden actor_type efter 07d Fase B-deploy.",
          "Backend · Tre nye admin-endpoints (`GET /api/admin/economy-overview`, `GET /api/admin/finance-transactions`, `GET /api/admin/economy-health`) bag requireAdmin-middleware. Pagination clamper limit til max 200 så drill-down-queries ikke kan trække hele rækken på én gang. 8 nye unit-tests + route-ownership-assertions, 423/423 backend-tests grønne.",
        ],
      },
    ],
  },
  {
    version: "2.92",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Backend · Komplet audit-trail på alle penge-bevægelser (07d Fase B)",
        items: [
          "Backend · Alle 26 callsites der mutere holdets balance via increment_balance_with_audit-RPC populerer nu actor_type (cron/api/admin), source_path, reason_code, related_entity_type/_id og — for cron-paths — en idempotency_key. Hver finance_transactions-row kan nu trace 'hvem ændrede saldo og hvorfor' uden at læse engine-koden.",
          "Backend · Cron-paths (sponsor, salary, divisionsbonus, lejegebyr, præmiepenge) får UNIQUE-håndhævet idempotency_key så uniq_finance_idempotency_key giver en ekstra sikkerhedsspær oven på de eksisterende partial UNIQUE indices fra 07b — cron-retries kan ikke længere double-credit.",
          "Backend · 5 nye reason-codes i FINANCE_REASON (auction_guaranteed_bank_sale, squad_auto_purchase/_sale, squad_violation_fine, board_bonus_accepted) dækker manglende økonomi-paths så alle write-paths har en eksplicit årsag.",
          "Backend · Per-callsite audit-coverage tests verificerer at hver write sender korrekt actor_type + source_path + reason_code. 415/415 backend-tests grønne (op fra 410). Fundament for 07e admin økonomi-dashboard #83.",
        ],
      },
    ],
  },
  {
    version: "2.91",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Backend · Atomic balance-RPC eliminerer tabte penge-mutationer (07c)",
        items: [
          "Backend · Alle ~22 callsites der opdaterer holdets balance — auktion-køb/-salg, transfer-køb/-salg, byttehandel-kontant, præmiepenge, lejegebyr og lejegebyr-refusion, lån (oprettelse, afdrag, nødlån, købsoption), sponsor-payout, sæson-løn, divisionsbonus, negativ-balance-rente, trupstørrelse-auto-køb/-salg/-bøde, board-bonus-tilbud og admin-balance-justering — kører nu via én Postgres-funktion `increment_balance_with_audit(team_id, delta, payload)` der atomic UPDATE'er teams.balance OG INSERT'er finance_transactions i én DB-transaktion pr. team.",
          "Backend · Lost-update-races elimineret: pg_advisory_xact_lock(team_id) serialiserer concurrent calls på samme hold, så to samtidige finansoperationer ikke længere kan overskrive hinandens balance-ændring. Mellem-state hvor balance er ændret men finance_transactions mangler kan ikke længere opstå (rolled back atomic).",
          "Backend · Hver finance-row får nu automatisk udfyldt before_balance + after_balance fra RPC'en — fundament for 07d Fase B's fulde audit-trail-population af de øvrige 7 audit-felter (actor_type, source_path, reason_code m.fl.).",
          "Backend · 8 nye unit-tests i balanceAtomicity.test.js + live race-test mod prod (10 deltas, audit-invariant after = before + amount holder for alle rows). 410/410 backend-tests grønne.",
        ],
      },
    ],
  },
  {
    version: "2.90",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Backend · Audit-fundament for økonomi-historik (07d Fase A)",
        items: [
          "Admin · admin_log fik 4 nye indices (admin_user_id, action_type, target_team_id, created_at) og en CHECK-constraint der håndhæver de 24 godkendte action_types — utilsigtede typoer fanges nu på databaseniveau i stedet for at blive lukket stille gennem.",
          "Admin · auctionCancellation skriver nu admin_log med højlydt fejl i stedet for best-effort try/catch, så annullering ikke kan ske uden audit-spor.",
          "Backend · finance_transactions udvidet med 9 audit-kolonner (actor_type, actor_id, source_path, reason_code, before_balance, after_balance, related_entity_type, related_entity_id, idempotency_key) — alle nullable og NULL-default for eksisterende rows, så ingen historik mistes. Population følger i 07d Fase B sammen med 07c atomic balance RPC.",
          "Backend · Nye enum-konstanter (ADMIN_ACTION_TYPE, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY, FINANCE_REASON) i economyConstants.js erstatter hardkodede strings i 11 admin-routes. 7 nye unit-tests håndhæver at enum-values matcher DB CHECK-constraints så afvigelser fanges af CI før prod.",
        ],
      },
    ],
  },
  {
    version: "2.89",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Lås rytter under afventende overførsel",
        items: [
          "Auktioner · Når en rytter har vundet en auktion men endnu ikke er overført til vinderens hold (fordi transfervinduet er lukket og rytteren står som 'indgående'), kan ingen nu starte en ny auktion på rytteren. Tidligere kunne andre managere flash-auktionere rytteren væk fra den retmæssige vinder, hvilket fik den oprindelige finalisering til at annullere overførslen — bud bundet, ingen rytter til nogen.",
          "Rytter-profil · Profilen viser nu en lås-besked '🔒 Rytteren er vundet på auktion og afventer overførsel' og skjuler 'Start auktion'-, transferbud-, byttehandel- og lejeaftale-knapperne så længe rytteren er i transit.",
          "Backend · POST /api/auctions returnerer 409 'Rytteren er vundet på en auktion og afventer overførsel' hvis nogen forsøger at omgå UI-låsen. Ny pure-funktion `getAuctionStartIssue` med 2 unit-tests.",
        ],
      },
    ],
  },
  {
    version: "2.88",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Admin · Marked-pause kill switch",
        items: [
          "Admin · Ny 'Marked-pause'-sektion i admin-panelet med to nødstop-niveauer: 'Frys auktioner' (blokerer nye bud, autobud-loft og nye auktioner) og 'Frys hele markedet' (samme + transfertilbud, byttehandler, lejeaftaler og bank-lån).",
          "Auktioner forlænges automatisk ved genoptagelse — calculated_end skubbes frem med pause-varigheden, så bydere får samme resterende tid som de havde da pausen blev slået til. Cron pauser finalisering mens markedet er frosset, så ingen auktioner finaliseres bag scenen.",
          "Cleanup-handlinger (annullér eget bud, afvis modbud, træk lejeforslag tilbage) virker stadig under pause, så managere kan rydde op i pending tilbud uden admin-indblanding.",
          "Spilleruvendt fejlmeddelelse: 'Auktioner/Markedet er midlertidigt pauset af admin' med valgfri årsag — vises som 503-svar når en blokeret handling forsøges.",
        ],
      },
    ],
  },
  {
    version: "2.87",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Forlængelse over døgnskifte",
        items: [
          "Auktioner · Bud i de sidste 10 minutter kan nu forlænge auktionen op til 1 time efter dagens vindueslukning (hverdage til 23:00, weekend til 00:00). Tidligere blev forlængelsen kappet præcist ved lukningstidspunktet — fx et bud kl. 21:55 hverdag rundede ned til 22:00 i stedet for at give de fulde 10 minutter.",
          "Auktioner · Hvis et bud sent i grace-timen ville skubbe slutningen længere, ruller den resterende tid over til næste vindues åbning. Eksempel: fredag bud kl. 22:55 → auktionen slutter lørdag kl. 08:05 (5 min overflow). Reglen er nu beskrevet i Hjælp-siden.",
        ],
      },
    ],
  },
  {
    version: "2.86",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Ønskeliste-filter",
        items: [
          "Auktioner · Ny 'Kun ønskeliste'-knap ved siden af filter-tabsene — slå til for at se kun aktive auktioner på ryttere du har stjernemarkeret. Kombineres oven på den aktive tab (Min situation / Alle / Andre managers).",
          "Valget huskes på tværs af sessions, så hvis du primært jagter et udvalg af ryttere, behøver du ikke slå filteret til hver gang du åbner siden.",
        ],
      },
    ],
  },
  {
    version: "2.85",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Lejeaftale · Kontraktintegritet",
        items: [
          "Lejeaftale · Aktive lejeaftaler kan ikke længere annulleres ensidigt — bruger ser nu kun købsoption-knappen (hvis den findes) plus en note om at admin skal kontaktes for annullering. Tidligere kunne enten part bryde en indgået aftale uden modpartens accept (#156).",
          "Pending lejeforslag kan stadig trækkes tilbage frit (lender har ikke accepteret endnu), så loop'et 'foreslå → fortryd' fungerer som før.",
          "Admin · Nyt endpoint `POST /api/admin/loans/:id/cancel` til nødannulleringer; refunderer betalt lejegebyr automatisk til lejer og trækker fra udlejer, og logger handlingen i admin_log med begrundelse.",
        ],
      },
    ],
  },
  {
    version: "2.84",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Transfer · Byttehandel & Lejeaftale",
        items: [
          "Rytter-profil · Du kan nu foreslå byttehandel og lejeaftale direkte fra en anden managers rytter-profil — ligesom transferbud (#158). Knapperne 'Foreslå byttehandel' og 'Foreslå lejeaftale' vises under transferbud-knappen.",
          "Byttehandel · Forhandlings-loop virker nu korrekt: du kan sende modbud igen og igen til den anden part accepterer eller trækker sig. Tidligere stoppede loop'et efter første modbud (#159).",
          "Lejeaftale · Lejeaftaler kan kun oprettes for 1 sæson ad gangen (spilleregel). Formularen beder nu kun om ét sæsonnummer, og backend afviser forsøg på lejer i flere sæsoner (#160).",
        ],
      },
    ],
  },
  {
    version: "2.83",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Rytter-profil · Mobile polish",
        items: [
          "Evner-bar · Stat-rækkerne har nu kortere label-bredde på mobil, så progress-bar'en bliver synligt længere og lettere at læse på 360px-skærme.",
          "Sæsonhistorik & Løbsresultater · Tabellerne scroller nu pænt horisontalt på mobil i stedet for at presse layoutet, hvis løbsnavne eller præmier er lange (#163).",
          "Flash Auktion-label · 'Deadline Day'-forklaringen brækker nu på en ny linje på mobil i stedet for at flyde ud over viewport.",
          "Beløbs- og besked-felter · Input-felter til transfertilbud og auktions-startpris bruger nu 16px font på mobil, så iOS Safari ikke længere zoomer ind når du tapper feltet.",
          "Action-knapper · 'Send transfertilbud', 'Send tilbud' og 'Start auktion' har nu 44px touch-target (Apple HIG) i stedet for ~36px, så de er nemmere at ramme på telefon (#163).",
        ],
      },
    ],
  },
  {
    version: "2.82",
    date: "2026-05-09",
    label: "Beta",
    changes: [
      {
        category: "Mobile polish · 360px touch-targets",
        items: [
          "Onboarding-banner og overbudt-toast · × close-knapperne på 'Sådan virker auktioner'-banneret og 'Du er overbudt'-toasten har nu 44×44px tap-target (Apple HIG) i stedet for et lille kryds, der var svært at ramme på telefon.",
          "Filter-chips · Aktive filtre på rytter- og auktionssiden er nu klikbare i hele deres bredde — tryk hvor som helst på chip'en for at fjerne filteret. Tidligere skulle du ramme det lille × præcist (#181).",
          "Stats-popover · 'Vis stats'-menuen på auktionssiden har max-bredde der respekterer viewport, så menuen ikke længere kan flyde ud over kanten på 360px-skærme (#181).",
          "Holdside · 'Sælg / Auktion'-knappen i Squad-tabellen har nu 44px touch-target i stedet for et lille tryk-felt, så den er nemmere at ramme på mobil (#181).",
        ],
      },
    ],
  },
  {
    version: "2.81",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Stort overblik-overhaul",
        items: [
          "Min situation · Ny default-tab på /auctions samler alle auktioner du er involveret i — opdelt i tre scanbare sektioner: 🟢 Du leder, 🔴 Du er overbudt, 🔵 Du sælger. Tomme sektioner skjules automatisk. Erstatter 'Mine'- og 'Vinder'-tabs.",
          "Stats-toggle · Default vises ingen evne-kolonner i tabellen — det giver markant bedre overblik. Tryk 'Vis stats' øverst for at slå alle 14 evner til, eller vælg enkelt-evner via popover-menuen. Valget huskes på tværs af sessions (også på mobil-cards).",
          "Wishlist-stjerne · Ⓘ-knappen er flyttet ind i rytter-cellen på auktionssiden — du kan tilføje/fjerne ryttere til din ønskeliste direkte fra auktioner uden at gå over på rytter-siden.",
          "Løn vises i stedet for Værdi · Auktionssiden viser nu rytternes løn (relevant for dine økonomi-beslutninger) i stedet for markedsværdi. Værdi er stadig synlig på Ryttere-siden og rytter-profilen.",
          "Kolonner omarrangeret · Ny rækkefølge på desktop: Rytter (sticky venstre) | Højeste bud | Tid tilbage | Alder | Løn | Potentiale | Sælger | Stats | Byd (sticky højre). Rytter-navnet bliver synligt selv når du scroller horisontalt gennem evner.",
          "Pris-filter · Nyt min/max-felt på 'Højeste bud CZ$' i filter-baren — find fx kun ryttere under 100.000 CZ$ i auktionspris.",
          "Bekræftelses-popup · Alle bud (auktion, autobud-loft, transferbud) viser nu en 'Er du sikker?'-dialog inden de afgives, så du ikke kommer til at sende et bud ved et uheld.",
        ],
      },
    ],
  },
  {
    version: "2.79",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktioner · BYD-kolonnen på desktop har nu solid baggrund, også når rækken er markeret som vundet, så statistik og tekst ikke skinner igennem under den sticky bud-celle.",
          "Autobud · '+ Autobud loft' er gjort tydeligere, og når du sætter autobud på en auktion du ikke fører, placerer systemet nu samtidig minimumsbuddet. Autobud fungerer dermed som et rigtigt første bud — du behøver ikke byde manuelt først.",
        ],
      },
    ],
  },
  {
    version: "2.78",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Mobile auktioner · Bedre tap-targets og scroll-håndtering: alle bud-, autobud- og annuller-knapper på telefon er nu mindst 44×44px (Apple HIG-standard for komfortabel berøring) og bud-felter bruger 16px-skrift, så iOS ikke længere zoomer ind når du fokuserer feltet. Skærmlæsere får nu konkrete labels på alle knapper og indlæsnings-spinneren (#197).",
        ],
      },
    ],
  },
  {
    version: "2.77",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Intern infrastruktur · Dependabot-hærdning pre-launch",
        items: [
          "Dependabot kan ikke længere auto-merge afhængigheds-bumps (heller ikke patch/minor med grøn CI). Workflow'en kommenterer nu kun klassifikation og risiko-vurdering — manuel `auto-merge` label kræves for hver PR. Pre-launch beskyttelse mod runtime-regressioner og supply-chain-overraskelser.",
          "Vercel preview-builds skippes på `dependabot/*` branches (sparer build minutes og forhindrer kø-stuvning som blokerede main-deploys 2026-05-08).",
          "`react-router-dom` v7 og `@vitejs/plugin-react` v6 tilføjet til ignore-listen — major-bumps åbnes ikke som PRs igen før manuel un-ignore.",
        ],
      },
    ],
  },
  {
    version: "2.76",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Live bud-feed på desktop: ny sidebar viser bud i realtid på de auktioner du selv deltager i (manuelt bud eller autobud). Andre managers' moves på fremmede auktioner forbliver private — kun \"din side af bordet\" feeder din skærm (#196).",
          "Auktioner · Pris-cellen pulser kort i guld når current_price ændrer sig — så du kan se hvilken auktion lige fik et bud uden at skanne hele tabellen.",
          "Auktioner · Du får nu en toast i hjørnet \"Du er overbudt på X\" når en anden manager overhaler dig — også hvis du allerede ser auktionen. Toasten fyrer aldrig på dit eget bud eller på dit autobuds eskalering.",
          "Auktioner · Aggregat-ticker i header viser \"X nye bud i sidste 30s\" — uden navne eller beløb. Et hurtigt puls-tjek på markedet uden at lække andre managers' specifikke moves.",
        ],
      },
    ],
  },
  {
    version: "2.75",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Rytterprofil · Ny \"Bud-historik\"-fane viser live bud-timeline mens en auktion kører (manager + beløb + tidspunkt + Autobud-mærkat). Nye bud popper ind realtid uden refresh. Når auktionen slutter, kollapser fanen til \"Solgt til X for Y CZ$\". Autobud-loft eksponeres aldrig — strategi forbliver privat (#195).",
        ],
      },
    ],
  },
  {
    version: "2.74",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Hvis dit autobud-loft afvises (fx ved forsøg på egen rytter, for lavt loft eller utilstrækkelig balance), vises nu en konkret dansk fejlbesked under Gem-knappen — ikke længere bare en tom \"Fejl\"-knap (#174).",
          "Autobud · Når du byder manuelt over dit eget autobud-loft, slettes det stale loft nu fra dit auktions-overblik. Tidligere blev \"Autobud max ...\"-mærkatet hængende selvom autobud reelt var udmattet (#183).",
        ],
      },
    ],
  },
  {
    version: "2.73",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktioner · Aldrig flere annullerede auktioner pga. utilstrækkelig balance: alle bud, autobud og auto-eskaleringer tjekker nu mod tilgængelig balance (raw balance minus eksisterende auktions-forpligtelser). Penge låst i auktioner kan heller ikke bruges til at betale gæld eller acceptere transfers/lejegebyrer. Du kan ikke længere vinde en auktion du ikke har råd til (#44).",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Auktionssiden · Balance-tile viser nu \"X tilgængelig\" når noget er reserveret i bud, og separat \"Reserveret i bud\"-tile viser worst-case forpligtelse hvis alle dine autobud trigger fuldt.",
          "Finansside · Balance-tile viser \"X tilgængelig\" og \"Y låst i bud\" så det er klart hvor meget der kan bruges på lån og transfers. Lån-rate-input klamper også til tilgængelig.",
        ],
      },
    ],
  },
  {
    version: "2.72",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Race-beskyttelse: hvis prisen stiger mens du sender dit bud, viser vi nu en confirm-dialog med ny pris og nyt min-bud så du kan vælge at byde igen eller annullere — slut med at miste auktioner uden at vide hvorfor (#194).",
        ],
      },
    ],
  },
  {
    version: "2.71",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Du kan nu sætte autobud max-loft uden at have budt manuelt først — fix'ede en fejl hvor man kun kunne oprette autobud hvis man allerede var højestbydende (#172).",
        ],
      },
    ],
  },
  {
    version: "2.70",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Indbakke · Ulæste-tælleren i headeren opdateres nu straks når du sletter beskeder — ingen F5 nødvendig (#176).",
        ],
      },
    ],
  },
  {
    version: "2.69",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Historik er nu en tydelig fane øverst på Auktioner-siden — ikke længere et lille tekstlink i hjørnet. Du kan skifte mellem Aktive og Historik fra begge sider (#59).",
        ],
      },
    ],
  },
  {
    version: "2.68",
    date: "2026-05-08",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Resolveren følger nu altid med op når en modstander byder markant over — fixede en edge case hvor et stale eget proxy-loft (sat lavt, derefter manuelt budet over) fik resolveren til at give op uden at place counter-bid (#171).",
        ],
      },
      {
        category: "Hvorfor",
        items: [
          "Pre-fix: hvis du satte autobud max 60K og senere manuelt bød 80K, troede resolveren stadig dit loft var 60K og lod modstandere lede uden modbud — selvom de andres autobud max var højere end deres bud. Resolveren behandler nu et udtømt eget loft som 'ingen aktiv proxy', så challengers' autobud altid byder mindst minimum over.",
        ],
      },
    ],
  },
  {
    version: "2.67",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Autobud · Discord DM sendes nu også når et autobud overbyder dig — før kom DM'en kun ved manuelle bud, så managers fik kun in-app-notifikationen ved auto-overbud (#155).",
          "Autobud · Sælger får nu også besked når et autobud bliver afgivet på deres rytter — mirror'er flowet for manuelle bud.",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Autobud · DM'en markerer eksplicit at det er et autobud (\"Autobud fra X\") og angiver om dit eget max-loft blev nået.",
        ],
      },
    ],
  },
  {
    version: "2.66",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Auktioner · Min-bud er nu blot **1 CZ$ over** det aktuelle bud — 10%-overbudsregel og 1.000-afrunding er fjernet. Du kan også matche asking-prisen på et garanteret salg uden bud endnu (#175).",
          "Autobud · Resolveren bruger samme +1-step, så proxy-bidding følger korrekt med op uanset hvor markant en modstander byder over (#171, #173).",
        ],
      },
      {
        category: "Hvorfor",
        items: [
          "10%-reglen blev oprindeligt indført for at undgå \"+1\"-spam, men proxy-bidding (#10, v2.64) løser det problem indirekte — sæt et max-loft og lad systemet håndtere stepningen. Reglen skabte derfor mere friction end nytte og kolliderede med autobud-resolveren. Drop'et fjerner en hel klasse af bugs i én bevægelse (#178 polish-sprint).",
        ],
      },
    ],
  },
  {
    version: "2.65",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Mit hold · Klik på rytter-rækker åbner nu rytter-detaljesiden — manglede helt før (#157).",
          "Transfers · Klik på rytternavn i tilbud, byttehandler og lejeaftaler navigerer nu til rytter-profilen (#157).",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Højreklik på rytter-rækker viser nu \"Åbn link i ny fane\" — virker også med Cmd/Ctrl-klik og museknap-3 (#166). Gælder /riders, /team, /transfers, /auctions og alle steder hvor rytter-navne vises.",
        ],
      },
    ],
  },
  {
    version: "2.64",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Auktioner · Autobud med max-loft (proxy-bidding): sæt et max-loft på en auktion, og systemet byder automatisk +10% over modbudene op til dit loft (#10). Aktiveres via '+ Autobud loft' under bud-feltet.",
          "Autobud stopper automatisk når loftet er nået eller du vinder — du får en notifikation i indbakken hvis du er overbudt over dit max.",
          "Opdatér eller fjern dit max-loft når som helst mens auktionen er aktiv via 'Ændr' / 'Fjern' knapperne.",
        ],
      },
    ],
  },
  {
    version: "2.63",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Deadline Day · Tickeren viser nu kun events fra det aktuelle Deadline Day-vindue (de 24 timer op til transferfristens udløb) i stedet for de seneste 24 timer fra browserens aktuelle tidspunkt — feedet starter ikke længere midt i en normal hverdagsdag (#51).",
          "Deadline Day · Events i tickeren vises nu i kronologisk rækkefølge (ældste → nyeste) så budhistorien opbygges naturligt mod salgshændelsen, fremfor at vise konklusionen (salg) før opbygningen (bud) (#51).",
        ],
      },
    ],
  },
  {
    version: "2.62",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsesside + Dashboard: al UI-copy bruger nu konsekvent danske labels — 'Board Request' er erstattet med 'Bestyrelsesforespørgsel', 'boardet' med 'bestyrelsen', og bestyrelsesfokus vises nu med de samme danske labels (Balanceret / Ungdomsudvikling / Stjernesignering) som på Bestyrelsessiden fremfor rå enum-værdier (#65).",
          "Hjælp: 'Board-siden' hedder nu 'Bestyrelsessiden', og 'board request' er oversat til 'bestyrelsesforespørgsel' overalt i FAQ-teksten (#65).",
        ],
      },
    ],
  },
  {
    version: "2.61",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktioner · Fejlbesked ved for lavt bud er nu på dansk og angiver præcist minimumsbuddet: 'Bud skal være mindst X CZ$' (#16).",
          "Auktioner · Fejlbesked ved utilstrækkelig disponibel balance viser nu det konkrete restbeløb: 'Du har X CZ$ tilbage efter eksisterende bud' (#16).",
          "Auktioner · Tabelvisning viser nu 'Min. X CZ$' under bud-feltet (som mobilvisningen allerede gjorde), så managere kan se minimumsbuddet uden at gætte (#16).",
        ],
      },
    ],
  },
  {
    version: "2.60",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Tidszone-fix: Auktionsvinduerne (hverdage 16–22, weekend 08–23) beregnes nu eksplicit i Europe/Copenhagen og håndterer CEST/CET korrekt — auktioner slutter på de forventede tidspunkter uanset hvilken tidszone serveren kører i (#7).",
          "Auktioner · Countdown viser nu det absolutte sluttidspunkt med tidszone-label (f.eks. '21:00 CEST') under nedtællingen, så managere kan se præcist hvornår auktionen slutter (#7).",
        ],
      },
    ],
  },
  {
    version: "2.59",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Mobil quick-nav: fast bundmenu på mobil med direkte adgang til Dashboard, Indbakke, Marked, Ryttere og Mit Hold (#66).",
          "Menuen skifter automatisk position når DeadlineDayTicker er aktiv, så den aldrig dækker tickeren.",
          "Aktiv destination fremhæves med accent-farven (guld) og fungerer i lys og mørk tema.",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Auktion-bud: Bud-feltet kan nu ryddes uden at hoppe tilbage til minimum-budet, og Byd-knappen forbliver disabled indtil et gyldigt bud er indtastet (#18).",
        ],
      },
    ],
  },
  {
    version: "2.58",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Onboarding-modal kan nu lukkes (#107)",
        items: [
          "Tilføjet synligt × i øverste højre hjørne så modalen tydeligt kan lukkes.",
          "ESC-tast lukker nu modalen.",
          "Klik uden for modalen lukker den.",
          "Modalen scroller på små skærme (vinduet kan ikke længere blokere brugen af spillet).",
          "Knappen 'Kom i gang' omdøbt til 'Forstået' for at matche dismiss-handlingen.",
        ],
      },
      {
        category: "Alder-visning og -filter er nu konsistente (#108)",
        items: [
          "RiderStatsPage viste tidligere alder ud fra eksakt fødselsdag (24 år for rytter født juni 2001), mens filter og U25-logik bruger 'racing-age' (årstals-aritmetik = 25 år).",
          "Visningen er nu rettet ind så alder altid beregnes som indeværende år minus fødselsår — samme konvention som filter, U25 og U23-toggles.",
          "Filter på 'Alder ≤ 25' returnerer fortsat ryttere født 2001 eller senere; nu matcher alder vist på rytter-profilen.",
        ],
      },
    ],
  },
  {
    version: "2.57",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Balance + rytterstatus synlig i auktion-tabben (#48)",
        items: [
          "Ny stats-bar øverst på /auctions: 'Balance', 'Sum af aktive bud', 'Ryttere nu' og 'Projektion'.",
          "Projektion viser hvor mange ryttere man ville have hvis alle aktive auktioner sluttede med nuværende ledere — tæller +ryttere man vinder og -ryttere man er ved at sælge.",
          "Aktive bud-felt viser summen af de bud man aktuelt er ledende på, med antal auktioner angivet underneden.",
          "Balance hentes fra eksisterende teams-query (ingen ny datakilde). Rider-count hentes via count-query på riders-tabellen. Division-felt tilføjet til teams-select.",
        ],
      },
    ],
  },
  {
    version: "2.56",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "UX · Manager-online-status på holdprofil (#106)",
        items: [
          "Bugfix ([TeamProfilePage.jsx](frontend/src/pages/TeamProfilePage.jsx)): tidligere viste hold-profilen en grøn 'Vindue åbent'-pille ved siden af manager-navnet — det indikerede transfervinduets status, men placeringen tæt på 'Manager: ...' fik flere til at læse den som manager-online-status (rapporteret af jeppek, Discord 2026-05-06). Transfervindue-status fjernet fra holdprofil (vises stadig på Dashboard, Mit hold og Transfers).",
          "I stedet vises nu en korrekt online-prik + 'Online nu / X min siden' efter manager-navnet, baseret på samme `users.last_seen`-felt som ManagerProfilePage allerede bruger (5-min-tærskel matcher backend).",
          "Refaktor: OnlineBadge ekstraheret fra ManagerProfilePage til delt komponent ([OnlineBadge.jsx](frontend/src/components/OnlineBadge.jsx)), så begge sider deler én implementation.",
        ],
      },
    ],
  },
  {
    version: "2.55",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Auktioner · Squad-cap er nu warning, ikke block (#29)",
        items: [
          "Bugfix ([auctionRules.js](backend/lib/auctionRules.js), [api.js](backend/routes/api.js)): manager med 10 ryttere + 1 garanteret salg blev tidligere blokeret fra at byde på andre auktioner — fordi bud-validering ignorerede pending salg ved beregning af 'tilgængelig trupplads'. Reglen i Cycling Zone tillader allerede at gå over/under min/max MIDT i transfervinduet (squadEnforcement-cron auto-sælger + bøder kun ved vindue-luk hvis stadig over max), så hard-blokken på squad-cap modsagde gameplay.",
          "Konsekvens: bud + start-auktion er ikke længere blokeret af aktuel trupstørrelse. I stedet vises en warning i UI'en når bud/auktion ville bringe manager over max: 'OBS: leder nu auktioner svarende til 11 ryttere (max 10). Hvis du stadig er 1 over ved vindue-luk: auto-salg + 100.000 CZ$ bøde + 200 fradrag-points.' Manager træffer informeret valg.",
          "Backend ([auctionRules.js](backend/lib/auctionRules.js)): ny `getAuctionBidWarnings()` returnerer non-blocking advarsler; `getAuctionBidIssue` håndterer nu kun hard blocks (bid_below_minimum, insufficient_available_balance). Squad-cap-checks fjernet fra både POST `/api/auctions` (creation) og POST `/api/auctions/:id/bid` (bid placement). Warnings inkluderes i 200-respons.",
          "Frontend: AuctionsPage.jsx (table + card layout), RiderStatsPage.jsx og WatchlistPage.jsx læser `warnings`-felt og viser dem inline efter bud (~10 sek) eller som alert ved auction creation. Disse var de tre frontend-callsites til POST /api/auctions; TeamPage's egne-rytter-flows udløser ikke warning (initialBidderId=null).",
          "Test: 8/8 auctionRules.test.js grønne (3 nye warnings-tests, 1 ny non-block-regression). 315/315 backend-tests fortsat grønne. Frontend build grøn.",
        ],
      },
    ],
  },
  {
    version: "2.54",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Admin · Ny knap: Nulstil rytter-historik (#104)",
        items: [
          "Bugfix: Tidligere reset-flow rensede ikke completed auktioner og completed/buyout leje-aftaler — så alpha-historik forblev synlig på rytter-profiler. Ny knap 'Nulstil rytter-historik' under Admin → Beta-testværktøjer wiper ALL handelshistorik (auktioner inkl. bud, transfers, swaps, leje-aftaler) på ALLE ryttere så spillet kan starte uden alpha-støj.",
          "Bevarer ønskelister, ryttere, hold, balancer, finance-historik, sæsoner, race-resultater og manager-progress — kun event-historikken på rytter-siden ryddes.",
          "Tilføjet til 'Fuld nulstilling' så fremtidige reset altid rydder rytter-historik som en del af suiten.",
        ],
      },
    ],
  },
  {
    version: "2.53",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "UX · Præmiestruktur synlig i Hjælp & Regler (#100)",
        items: [
          "Ny sektion 'Præmier' tilføjet i Hjælp & Regler med præmieformlen (1 UCI-point = 1.500 CZ$), eksempler på konkrete beløb (Tour de France-sejr: 1.950.000 CZ$, Monument: 1.200.000 CZ$, osv.), forklaring af udbetaling og et direkte link til den fulde pointtabel under Sæson → Løb → Point & præmier.",
          "Disclaimer tilføjet i hjælpesektionen: præmiebeløb kan justeres frem til sæson 1 afsluttes.",
          "Lille hjælp-ikon (?) tilføjet øverst på Point & præmier-siden med direkte link til Hjælp & Regler.",
        ],
      },
    ],
  },
  {
    version: "2.52",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Intern infrastruktur · Dependabot + CodeQL (DX Lag 7)",
        items: [
          "Ingen brugerrettet ændring. Dependabot konfigureret til automatiske dependency-PRs (npm + github-actions, ugentligt). CodeQL-workflow tilføjet til automatisk sikkerhedsscanning på hvert push til main + ugentlig schedule. Manuel aktivering i GitHub Settings → Code security and analysis udestår.",
        ],
      },
    ],
  },
  {
    version: "2.51",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Robusthed · TOCTOU-fixes + idempotency-keys for cron-payouts (slice 07b)",
        items: [
          "Bugfix ([loanEngine.js](backend/lib/loanEngine.js)): `createLoan` brugte SELECT-then-INSERT til at validere divisions-gældsloftet — to parallelle requests (fx dobbeltklik på 'Optag lån') kunne begge passere tjekket og oprette to lån som tilsammen overstiger loftet. Ny Postgres-funktion `create_loan_atomic` serialiserer concurrent requests på team-niveau via `pg_advisory_xact_lock` så ceiling-tjek + INSERT kører i samme transaktion.",
          "Idempotency på cron-payouts ([economyEngine.js](backend/lib/economyEngine.js), [loanEngine.js](backend/lib/loanEngine.js)): sponsor (sæson-start), løn + division-bonus + lånerenter (sæson-end) havde ingen DB-håndhævet uniqueness. Hvis en cron timeout'ede og blev retried — eller hvis admin kørte sæson-end-repair efter en delvis kørsel — kunne managere få samme udbetaling/opkrævning to gange. Ny migration ([2026-05-07-economy-idempotency.sql](database/2026-05-07-economy-idempotency.sql)) tilføjer 4 partial UNIQUE indices på `finance_transactions` så DB afviser dubletter; backend fanger `unique_violation` (PG 23505) og skipper stille i stedet for at crashe hele cron-kørslen.",
          "Renter sporbare per lån: `finance_transactions` får ny kolonne `related_loan_id`, og `processLoanInterest` skriver nu både team-id OG lån-id pr. rente-row. Det betyder dels at idempotency-indexet kan kræve unique-per-(loan, season), dels at FinancePage på sigt kan vise rente-fordeling per individuelt lån.",
          "Light konkurs-mekanik (lag 1): `createEmergencyLoan` foretager nu et SOFT debt_ceiling-tjek. Hvis et nødlån presser holdets samlede gæld over divisions-loftet, oprettes lånet alligevel (status quo bevaret), men manageren får en `emergency_loan_breach`-notifikation: '🚨 Gældsloft overskredet — du kan stadig drive klubben videre, men du SKAL reducere udgifterne (sælg ryttere, fyr stjernekontrakter) inden næste sæsonslut for at undgå spiral.' Ingen automatiseret konsekvens i denne sæson-cyklus — vi lytter til live-data først.",
          "Test-disciplin: ny test-fil ([economyInvariants.test.js](backend/lib/economyInvariants.test.js)) med 7 cases skrevet FØR fixen for at validere at race-conditions er reelle, ikke teoretiske. 5 fejlede mod uændret kode, 2 passerede; alle 7 grønne efter fix. Eksisterende 25 backend-tests fortsat grønne.",
        ],
      },
    ],
  },
  {
    version: "2.50",
    date: "2026-05-07",
    label: "Beta",
    changes: [
      {
        category: "Robusthed · Stale fallbacks fjernet, sponsor-default normaliseret til 240K (slice 07a)",
        items: [
          "Bugfix ([teamProfileEngine.js](backend/lib/teamProfileEngine.js)): nye hold blev oprettet med hardkodet `sponsor_income: 260000` mens DB-default + alle 5 v2.49-fix-callsites brugte 240K. Drift stammede fra v1.76 (30. april) hvor in-code default blev hævet uden ledsagende DB-migration. Prod-DB-snapshot 2026-05-07: alle 19 hold står med 240K, så ingen tilbage-kompensering var nødvendig.",
          "Konsolidering ([economyConstants.js](backend/lib/economyConstants.js) · ny fil): 7 økonomi-konstanter samlet ét sted som single source of truth — SPONSOR_INCOME_BASE (240K), INITIAL_BALANCE (800K), MARKET_VALUE_MULTIPLIER (4000), MIN_UCI_POINTS_FOR_VALUE (5), PRIZE_PER_POINT (1500), NEGATIVE_BALANCE_INTEREST_RATE (0.10) og DEBT_CEILING_BY_DIVISION (1.2M/900K/600K). Alle matcher database/schema.sql-defaults. Importeres af teamProfileEngine, economyEngine, boardGoals og api.js.",
          "Fail-fast i [loanEngine.js](backend/lib/loanEngine.js): `createEmergencyLoan` kastede tidligere et stille `?? 0.15`-fallback hvis `loan_config` manglede emergency-row for en division. Prod-tjek bekræftede alle 3 divisioner har korrekte rows; men hvis en seed-fejl opstår fremover, fejler vi nu eksplicit med 'loan_config mangler emergency-row' i stedet for at oprette lån med forkerte rater. Ny regression-test låser adfærden.",
          "Stragglers fixet: 3 callsites brugte `team.sponsor_income ?? 0` i stedet for at falde tilbage til base-konstanten (api.js board-outlook for både negotiation- og preview-stien, boardGoals.js sponsor_growth-evaluering). Alle ændret til `?? SPONSOR_INCOME_BASE` så board-tilfredshedsvurdering ikke længere fejlrapporterer 0% sponsor-vækst hvis et team-objekt midlertidigt mangler feltet.",
          "Doc-drift ryddet op: [FEATURE_STATUS.md](docs/FEATURE_STATUS.md) + finance-onboarding-hint havde 260K-referencer, alle korrigeret til 240K. `DEFAULT_SPONSOR_INCOME` re-eksporteres fra economyEngine som alias for SPONSOR_INCOME_BASE i ét release for backward compat (deprecate i 07b). 299/299 backend-tests grønne, frontend build + lint grøn.",
        ],
      },
    ],
  },
  {
    version: "2.49",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Sponsor-fallback brugte stale 100 CZ$ i stedet for 240K",
        items: [
          "Bugfix ([economyEngine.js](backend/lib/economyEngine.js), [betaResetService.js](backend/lib/betaResetService.js), [boardAutoAccept.js](backend/lib/boardAutoAccept.js), [api.js](backend/routes/api.js)): 5 steder i kode-base brugte `team.sponsor_income ?? 100` som fallback når `teams.sponsor_income` var null/undefined. Værdien 100 var en stale default fra pre-skalerings-æraen (før ×4000-multiplier i april). Mindst én manager (Above & Beyond Cancer Cycling, oprettet 3. maj) endte med `sponsor_income = 100` i DB og fik kun 100 CZ$ udbetalt ved sæson-start i stedet for 240.000 CZ$.",
          "Fix: ny eksporteret konstant `DEFAULT_SPONSOR_INCOME = 240000` i economyEngine.js (matcher DB-default i schema.sql). Alle 5 fallbacks skifter fra `?? 100` til `?? DEFAULT_SPONSOR_INCOME`. Hvis `teams.sponsor_income` af en eller anden grund mangler, vil fremtidige sæson-start payouts og board-plan-baselines bruge 240K i stedet for 100.",
          "Manuel kompensering: Above & Beyond Cancer Cycling fik `sponsor_income` opdateret til 240.000 og balance krediteret med 239.900 CZ$ (forskellen mellem hvad han fik og hvad han skulle have fået). Kompenseringen vises som en `sponsor`-transaktion i hans Finanser-historik med beskrivelsen 'Kompensering: manglende sponsor-payout'.",
        ],
      },
    ],
  },
  {
    version: "2.48",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Gældsloft kunne overskrides med oprettelses-gebyrets størrelse",
        items: [
          "Bugfix ([loanEngine.js](backend/lib/loanEngine.js)): `createLoan` tjekkede om `currentDebt + principal` oversteg divisionens gældsloft, men det beløb der blev lagt på `loans.amount_remaining` var `principal + origination_fee`. Det betød at hvert lån kunne presse total-gælden lidt over loftet — præcis fee-beløbet (5% for kort/langt, 10% for nødlån). En manager i D3 fandt mønstret og pressede sin gæld til 600.054 CZ$ (54 over D3-loftet på 600.000) ved at stable mange små lån oven på et stort.",
          "Fix: fee beregnes nu FØR ceiling-tjekket og tjekket bruger `principal + fee` i stedet for kun principal. To regression-tests i [loanEngine.test.js](backend/lib/loanEngine.test.js) verificerer dels at et lån der ville overskride loftet med præcis fee-beløbet afvises, dels at et lån der præcis fylder headroom op (inkl. fee) stadig accepteres.",
          "Eksisterende prod-data (en manager 54 CZ$ over loft) ikke rørt — næste sæsons rente vil under alle omstændigheder ændre tallet, og loft-tjekket gælder kun nye lån, ikke renteperiodisering.",
        ],
      },
    ],
  },
  {
    version: "2.47",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "QoL · Refresh på Min aktivitet + bedre Head-to-Head-søgning",
        items: [
          "Min aktivitet ([ActivityPage.jsx](frontend/src/pages/ActivityPage.jsx)) får en 'Opdater'-knap i toppen, så du kan hente seneste auktioner, tilbud og lån uden at refreshe browseren. Tidsstemplet 'Sidst opdateret HH:MM' viser hvor friske data er — vises i sidens header på desktop.",
          "Head-to-Head ([HeadToHeadPage.jsx](frontend/src/pages/HeadToHeadPage.jsx)): begge holdsøgefelter viser nu hold-forslag automatisk ved fokus (før kun det højre felt). Når søgningen ikke giver hits vises 'Ingen hold fundet for X' i stedet for at dropdown skjules tavst.",
          "Bugfix · Head-to-Head viste evig spinner hvis bare ét af de fire bagvedliggende queries fejlede (`Promise.all` uden try/catch). Fejl fanges nu og viser 'Prøv igen'-knap i stedet.",
          "Bugfix · Stille fejl-skjul i Min aktivitet — `/api/transfers/my-offers` og `/api/loans` faldt tilbage til tomme lister hvis de fejlede, uden at logge noget. Fejl logges nu i devtools så det kan diagnosticeres.",
        ],
      },
    ],
  },
  {
    version: "2.46",
    date: "2026-05-06",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Umuligt at starte to auktioner på samme rytter (race condition)",
        items: [
          "Bugfix ([api.js](backend/routes/api.js)): POST /api/auctions tjekkede 'no active auction for rider' med en SELECT, hvor en parallel request (typisk dobbeltklik på 'Start auktion') kunne smutte forbi inden vores INSERT — TOCTOU race. 5. maj fik én manager 3 auktioner på Gianni Moscon og 2 hver på Silvan Dillier + Morné van Niekerk inden for sub-sekund vinduer.",
          "Ny migration ([2026-05-06-auctions-unique-active-rider.sql](database/2026-05-06-auctions-unique-active-rider.sql)) tilføjer unique partial index `uniq_auctions_one_active_per_rider ON auctions(rider_id) WHERE status IN ('active','extended')` — DB-niveau guard der gør det fysisk umuligt at have to aktive auktioner på samme rytter. Anden parallel INSERT fejler med 23505 og backend mapper det til samme 409 'Rider already has an active auction' som det eksisterende SELECT-tjek.",
          "Cleanup: de 4 duplikat-rows i prod sat til `cancelled` (Gianni Moscon's auktion med rigtigt bud bevaret, ældste auktion bevaret for Silvan Dillier + Morné van Niekerk). Ingen pengebevægelse — seed-buddene var fra sælger på egen rytter og udløste ingen reservation.",
          "Regression-test ([auctionSchemaContract.test.js](backend/lib/auctionSchemaContract.test.js)) verificerer at det unique partial index findes i schema.sql, supabase_setup.sql og setup.py — så friske setups ikke kan deploye uden DB-guarden.",
        ],
      },
    ],
  },
  {
    version: "2.45",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "Bugfix · Ønskeliste-auktioner åbner Auktioner fra Indbakken",
        items: [
          "Indbakke-notifikationen 'Ønskeliste-rytter til auktion' linker nu til Auktioner i stedet for Transfers. Backend bruger en ny notification-type `watchlist_rider_auction`, så auktioner og transferlistinger ikke længere deler routing-kontrakt.",
          "Gamle allerede-sendte ønskeliste-auktionsnotifikationer genkendes på titel/besked og får samme `/auctions`-link, så eksisterende indbakke-elementer også åbner korrekt.",
          "Migration ([2026-05-05-watchlist-auction-notification-type.sql](database/2026-05-05-watchlist-auction-notification-type.sql)) udvider `notifications_type_check`, og kontrakt-testen er opdateret med den nye type.",
        ],
      },
    ],
  },
  {
    version: "2.44",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "UI · Venstremenuen samlet i fire mentale rum",
        items: [
          "Venstremenuen er omstruktureret fra de gamle grupper til fire tydeligere områder: Klubhus, Marked, Sæson & Resultater og Liga. Målet er at gøre de vigtigste daglige handlinger lettere at finde: hold, bestyrelse, økonomi og indbakke ligger nu samlet i Klubhus, mens løb er flyttet ind sammen med sæson- og resultatvisninger.",
          "Panic Board er omdøbt til Deadline Day i menuen, så navnet matcher den faktiske funktion og undgår engelsk event-sprog i den faste navigation. Profil & Indstillinger er kortet ned til Indstillinger, og Finanser hedder nu Økonomi i menuen.",
          "HelpPage er opdateret med de nye menustier, blandt andet Liga → Head-to-Head og Sæson & Resultater → Løb. Direkte åbning af egen managerprofil åbner nu også Klubhus-gruppen i sidebaren, så den aktive side ikke skjules.",
        ],
      },
    ],
  },
  {
    version: "2.43",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "Admin-fix · 'Nulstil sæsoner' blokeret af finance_transactions",
        items: [
          "Bugfix ([betaResetService.js](backend/lib/betaResetService.js)): admin-knappen 'Nulstil sæsoner' (og 'Fuld nulstilling') fejlede med FK-violation, fordi `finance_transactions.season_id` har `ON DELETE NO ACTION` og 307 rows i produktion holdt sæsonerne fast. `resetBetaSeasons` nuller nu `season_id` på ALLE finance_transactions (manager + AI + bank) før `DELETE FROM seasons` — historikken bevares, kun sæson-koblingen ryger",
          "Regression-test tilføjet ([betaResetService.test.js](backend/lib/betaResetService.test.js)) der verificerer at både manager- og AI-finance-rows får `season_id = null` før delete. 294/294 grønne",
        ],
      },
    ],
  },
  {
    version: "2.42",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02j · Polish — onboarding-tour, HelpPage bestyrelse-sektion, doc-drift sweep",
        items: [
          "Onboarding-tour på BoardPage ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)) opdateret efter S-02h wizard-redesign: de tre tour-trin beskriver nu det nye 3-panel-dashboard (side-om-side visning, klik-mål-mini-dialog, konsekvens-tier) og nævner navngivne bestyrelsesmedlemmer og klub-DNA som eksisterende features manageren vil møde. Tour peger fortsat på BoardEmptyState-sektionerne i onboarding-fasen (inden første plan forhandles).",
          "HelpPage ([HelpPage.jsx](frontend/src/pages/HelpPage.jsx)) har nu en dedikeret 'Bestyrelse'-sektion (◧) med 9 indholds-blokke: Hvad gør bestyrelsen, Sæson 1 baseline, Sekventiel onboarding sæson 2 (trin-liste), Det strategiske dashboard, Navngivne bestyrelsesmedlemmer (9 arketyper + formand-logik + replacement-trigger), Klub-DNA (5 arketyper + 3 effekter), Konsekvens-tier (6-rækket tabel lag 1–6), Board requests + drej-låsninger og Mid-season check. Sektionen er placeret som andet punkt i sidebaren (efter 'Kom i gang') da bestyrelsen er et af spillets primære systemer.",
          "Doc-drift sweep: FEATURE_STATUS.md opdateret med S-02h og S-02i leverancer (wizard-redesign, bug-fix-pass + 293/293 tests). BOARD_TOUR_STEPS-kommentar i BoardPage.jsx rettet til at afspejle S-02h-konteksten korrekt.",
        ],
      },
    ],
  },
  {
    version: "2.41",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02i · Bug-fix-pass + regression-tests",
        items: [
          "Bugfix ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)): multi-plan-fornyelse starter nu altid med den længste udløbne plan uanset hvilken plan manageren klikker 'Forhandl ny plan →' på — Q-batch 1C Q19 specificerer eksplicit '5yr eller 3yr forhandles først'. Tidligere kunne klik på 1yr-panelet give forkert rækkefølge (1yr → 5yr i stedet for 5yr → 1yr)",
          "processReplacementTrigger og evaluateAndApplyConsequences gjort deps-injectable i processTeamSeasonEnd ([economyEngine.js](backend/lib/economyEngine.js)) — følger det etablerede mønster for processLoanInterest/createEmergencyLoan og muliggør præcis unit-test af S-02c/S-02e paths",
          "7 nye regression-tests for processSeasonEnd ([economyEngine.test.js](backend/lib/economyEngine.test.js)): processReplacementTrigger kaldt ved plan-completion, skippet ved mid-cycle, replacement-notifikation sendt ved replaced=true, triggerDoublePlanLapse (consecutiveLowExpirations=2 vs 0), fejl-isolation, u25_stat_sum + u25_count i snapshot. 293/293 tests grønne",
        ],
      },
    ],
  },
  {
    version: "2.40",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02h · Wizard-redesign — Hybrid B+A (strategisk dashboard + modal wizard)",
        items: [
          "BoardPage ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)) redesignet til 3-kolonne dashboard: 5yr / 3yr / 1yr vises side om side på desktop (mobile: vertikal stack). Hvert panel viser tilfredshed%, sponsor×-modifier, mål-progress-bar og top 3 mål med status-ikoner (✓/!/~/○ fra GOAL_STATUS_META) — compact info-tæthed pr. Q-batch 1C Q17",
          "GoalMiniDialog: klik på et mål i dashboard-panelet åbner en modal med fulde mål-detaljer (fremgang, kumulativt progress-bar, importance, tradeoff-stramning, identity-badge) + dominerende board-member-portræt og reaktions-citat. Giver immersion uden at fylde dashboard (Q-batch 1C Q17)",
          "Wizard redesignet fra full-page takeover til modal overlay — dashboard forbliver synligt i baggrunden. WizardStep1/2/3 (strategi → forhandling → underskrift) er uændrede internt. Trin-indikator og satisfaction-meter bevaret. Lukkes med '← Tilbage til oversigt' (renewal) eller auto-lukkes ved sign (setup)",
          "Multi-plan-fornyelse (Q-batch 1C Q19): når 2+ planer er udløbet samme sæson bygges en renewalQueue[] sorted by PLAN_SEQUENCE (5yr → 3yr → 1yr). Første plan åbner wizarden, efter sign åbner næste plan automatisk. Modal-header viser 'Planfornyelse 1/2 — 3-årsplan' + 'Derefter fortsættes med 1-årsplan'. '← Tilbage til 3-årsplan'-knap vises fra trin 2+",
          "DashboardPlanPanel: ny kompakt komponent med expand-toggle '↓ Vis detaljer'. Detalje-sektionen inkluderer fulde GoalCards, PlanTimelineBar, SeasonSnapshotGrid, outlook/feedback, MemberReactionPanel og BoardRequestPanel — al eksisterende funktionalitet bevaret under fold",
        ],
      },
    ],
  },
  {
    version: "2.39",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02g · Manager-konkurrence + mid-season + drej-låsninger",
        items: [
          "Mid-season auto-banner ([boardMidSeason.js](backend/lib/boardMidSeason.js)): når race_days_completed krydser midpoint (= floor(race_days_total/2)) tjekker en ny cron hver human team. Hvis tilfredshed <50% ELLER ≥50% af målbare plan-mål ligger 'behind'-status → fyrer `board_critical`-notif til Indbakke 'Skal handles'-tier (Q-batch 1B Q15 + Q-batch 1C Q21). Idempotent via per-board-per-season notif-dedupe — én fire pr. board pr. sæson",
          "`relative_rank`-mål går live på BoardPage ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)): GoalCard renderer nu rich detail 'Du staar #4 af 8 managers i divisionen — slaar 4 (maal: 3 ✓)' baseret på `season_standings.rank_in_division` + antal humane managers i din division (Q-batch 1B Q12). Skalerer fra ~19 til 100+ managers uden cross-division-støj",
          "Tradeoff-låsninger ([boardRequests.js](backend/lib/boardRequests.js)) introducerer deferred konsekvenser af approved board requests: `lower_results_pressure` → +1 til min_u25_riders/min_national_riders i næste plan-renewal. `ease_identity_requirements` → +5pp på sponsor_growth-target. Stramningen markeres med '🔒 Strammet'-badge på det modificerede mål og forsvinder efter ÉN sæson (Q-batch 1B Q16). Hardkodet pr. request-type for forudsigelighed",
          "MAJOR pivot cool-down: én MAJOR focus-skift pr. plan-livscyklus (Q-batch 1A Q3). MAJOR = krydsninger mellem extremer (more_youth_focus FRA star_signing eller more_results_focus FRA youth_development) — pivots til/fra balanced er ikke MAJOR og kan gentages. Stempel sidder på `board_profiles.major_pivot_used_at` og nulstilles ved plan-renewal (frisk plan = frisk cool-down)",
          "Window-blokering: requests umulige i sidste 5 race-days af sæsonen. Bestyrelsen vil ikke have planen drejet umiddelbart før evaluering. Mid-cycle-låsning: 5yr/3yr-planer kræver ≥50% gennemført ELLER >30% absolut satisfaction-delta før de kan drejes — forhindrer impulsive flip-flops på langtidsplaner. 1yr-planer har ingen mid-cycle-lås (Q-batch 1A Q3, Appendix beslutning 3a/c)",
          "Migration ([2026-05-05-board-tradeoff-pivot.sql](database/2026-05-05-board-tradeoff-pivot.sql)) tilføjer `board_profiles.tradeoff_active_until_season_id` (FK til seasons), `tradeoff_payload` (JSONB med stramnings-detaljer) og `major_pivot_used_at` (timestamp). Indexes for hurtig lookup ved plan-renewal. Cron integration i [cron.js](backend/cron.js) kører mid-season-review hver 30 min med immediate run on startup",
          "buildBoardProposal accepterer nu `tradeoffPayload`-param og applyTradeoffTighteningToGoals ([boardGoals.js](backend/lib/boardGoals.js)) anvender stramning som sidste step i goal-pipeline. /api/board/proposal + /api/board/sign læser tradeoff fra eksisterende board og clearer ved sign-time. Beta-reset wiper alle 3 nye felter via DELETE board_profiles ([betaResetService.js](backend/lib/betaResetService.js))",
          "36 nye backend-tests (286/286 grønne total) i [boardMidSeason.test.js](backend/lib/boardMidSeason.test.js): applyTradeoffTighteningToGoals (2 kinds + null + ikke-matchende type), isMajorPivotRequest (4 kombinationer), tradeoff/pivot-persistens i resolveBoardRequest, F4/F5/F6 availability-guards (4 mid-cycle-cases × plan_type-variationer + window-block + MAJOR-block), buildBoardProposal tradeoff-integration, evaluateMidSeasonTrigger (low_satisfaction + many_behind + ingen-trigger), processMidSeasonReviewCron (trigger ved midpoint, skip pre-midpoint, skip baseline/onboarding-fasen, idempotent replay, AI/bank/frozen-skip, pending-board-skip)",
        ],
      },
    ],
  },
  {
    version: "2.38",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02f · Klub-DNA — manageren vælger klubbens identitet i sæson 2",
        items: [
          "5 håndlavede klub-DNA-arketyper introduceret ([boardClubDna.js](backend/lib/boardClubDna.js)): 🌲 Skandinavisk udviklingshold (ungdom + nordisk arv), 🪨 Italiensk klassiker-traditionalist (forår + monumenter), ⚡ Sprint-fokuseret kommerciel (sprint + sponsorvækst), ⛰️ Fransk klatrer-arv (Tour-bjerge + national kerne), 🎯 Britisk all-rounder (bredde + datadrevet). Hver DNA har 8 policy-akser, member_alignment_bonus til 1-4 board-arketyper og en signature klub-tradition-mål",
          "Ved sæson-2-onboarding (efter sæson 1's identity er observeret) viser BoardPage et `ClubDnaSelectionCard` med 3 algoritmisk-foreslåede DNA: ét national-match (mod `season_1_identity_basis.national_core`), ét specialization-match (mod `primary_specialization`) og ét wildcard. Manageren vælger frit fra de tre — ingen påtvunget valg, men forslagene føles 'set' pga. data-grunding ([api.js](backend/routes/api.js))",
          "DNA påvirker board-medlems-tildeling: ved chairman-replacement i senere sæsoner tipper DNA-bonus alignment-scoren mod arketyper der matcher klubbens identitet. Eksempel: italiensk_klassiker giver +4 til klassiker_purist og -2 til gc_elsker, så formandsvalget reflekterer DNA'et ([boardMembers.js](backend/lib/boardMembers.js))",
          "5-årsplaners forslag får et ekstra DNA-tradition-mål injiceret som bonus (italiensk_klassiker → 'mindst ét Monument-podie pr. plan-cyklus', sprint_kommerciel → 'min. 2 etape-trøjer/sæson'). Plus DNA-vægtning multiplicerer satisfaction_bonus + _penalty på matchende mål-typer (italiensk_klassiker × 1.6 på monument_podium), så DNA føles igennem evaluering uden at ændre mål-targets ([boardGoals.js](backend/lib/boardGoals.js))",
          "Migration ([2026-05-05-board-club-dna.sql](database/2026-05-05-board-club-dna.sql)) seedet `team_dna`-reference-tabel med alle 5 arketyper + tilføjer `teams.team_dna_key` (FK til team_dna) + `teams.team_dna_chosen_at`. To nye routes: `GET /api/board/dna-suggestions` (3 forslag) og `POST /api/board/dna-choose` (commit-valg). AI/bank/frozen får aldrig DNA — manager-only per Q-batch 1A Q8",
          "Beta-reset ([betaResetService.js](backend/lib/betaResetService.js)) nulstiller `team_dna_key` + `team_dna_chosen_at` så næste sæson 2-onboarding gentager valget. DNA er 'final indtil drift' i denne slice — gradvis udvikling over 5 sæsoner kommer i opfølgnings-slice (S-02f.1)",
          "18 nye backend-tests (250/250 grønne total) i [boardClubDna.test.js](backend/lib/boardClubDna.test.js) dækker konstanter (5 DNA × shape), suggestion-determinisme + national/spec-slot-matching, alignment-bias der tipper klassiker_purist højere med italiensk DNA, mål-vægtning (1.6× monument_podium for italiensk), tradition-goal injection i 5yr (med dedup mod base-pakken og kun 5yr) og fallback til defaults uden identityBasis",
        ],
      },
    ],
  },
  {
    version: "2.37",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02e · Konsekvens-tier — bestyrelsen reagerer gradueret på lav (og høj) tilfredshed",
        items: [
          "6-lags konsekvens-system ([boardConsequences.js](backend/lib/boardConsequences.js)) der gradvis hæver presset jo lavere tilfredsheden falder — og belønner overpræstation. Ingen automatisk fyring (Q-batch 1A #4): Lag 1 (passiv sponsor-modifier ±20%, eksisterende), Lag 2 (lønloft ved <40%), Lag 3 (signing-restriktion >300K kræver godkendelse ved <30%), Lag 4 (tvunget salg ved <15%), Lag 5 (sponsor-pull-out ved <10% ELLER 2× plan-udløb under 30%), Lag 6 (bonus-tilbud +200K mod ekstra-mål ved >75%)",
          "Hard-blocks i transfer/auction-flow ([api.js](backend/routes/api.js)): nye køb ramler ind i `assertSigningAllowed` på `POST /api/auctions/:id/bid`, `POST /api/transfers/offer` og `accept_counter`-action. Returner 403 med `code='board_signing_restriction'` eller `code='board_salary_cap'` så frontend kan rendere klar fejlbesked. Lag 2 frosser holdets samlede løn ved trigger-tidspunktet — manageren kan stadig handle med rytter-rotation, bare ikke vækst",
          "Tvunget salg (lag 4) auto-lister rytteren med laveste market_value ved sæson-end. Beskytter pop≥70 OR uci_points≥100 (parallel til UCI-sync auto-protection) så bestyrelsen ikke smider stjernen. Inserter `transfer_listings`-row direkte + sender 'Skal handles'-notif. Sponsor-pull-out (lag 5) stacker multiplikativt med budget_modifier ind i næste sæson-starts sponsor-payment og auto-expirer derefter",
          "Bonus-tilbud (lag 6) er positiv konsekvens — fyrer 1×/sæson når satisfaction >75% OG ≥75% af mål er nået. Tilbyder +200K mod 1 ekstra-mål: signature_rider ved star_signing-fokus, ellers monument_podium. Manager accepterer eller afviser i ny BonusOfferCard på BoardPage; accept krediterer balance + tilføjer mål til 1yr-board's current_goals. To nye routes `/api/board/bonus-offer/{accept,decline}`",
          "Migration ([2026-05-05-board-consequences.sql](database/2026-05-05-board-consequences.sql)) tilføjer `board_consequences`-tabel med unique-active-index på (team_id, layer) der enforcer 1 aktiv pr. lag. Status-flow active → accepted/declined (lag 6) ELLER active → expired (lag 5 ved sæson-start) ELLER active → fulfilled (lag 4 når listing sælges). Notif-routing låst i Q-batch 1C Q21: lag 4-6 → `type='board_critical'` (Skal handles), lag 2-3 silent på BoardPage warning-panel",
          "Frontend ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx)): nye `BoardConsequencesPanel` (lag 2-5 warning-cards, gul for lag 2-3, rød for lag 4-5) og `BonusOfferCard` (grøn med Acceptér/Afvis-knapper). Begge vises kun udenfor baseline-fasen. Beta-reset ([betaResetService.js](backend/lib/betaResetService.js)) clearer `board_consequences` så næste cyklus starter rent",
          "41 nye backend-tests (232/232 grønne total) i [boardConsequences.test.js](backend/lib/boardConsequences.test.js) dækker tærskel-trigger pr. lag, idempotency-replay, hard-block-flow med både salary-cap- og restriction-prioritet, forced-listing-rytter-valg med star-protection, sponsor-pullout-stack + season-scoped expiration, og bonus-offer accept/decline + 1×/sæson-guardrail",
        ],
      },
    ],
  },
  {
    version: "2.36",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02d · Udvidede mål-typer — bestyrelsen kan nu kræve monumenter, trøjer, stjerner og udvikling",
        items: [
          "7 nye mål-typer tilføjet til bestyrelsens repertoire ([boardGoals.js](backend/lib/boardGoals.js)): `monument_podium` (top-3 i Monuments-løb cumulative over plan), `jersey_wins` (point/bjerg/young-trøje pr. etapeløb), `signature_rider` (≥1 rytter med popularity ≥75), `profitable_transfers` (netto transfer-balance ≥200K cumulative), `u25_development_delta` (gnsn. ≥3 stat-points/sæson på U25-ryttere), `relative_rank` (slut foran ≥N andre managers i divisionen), `domestic_dominance` (skeleton — aktiveres i S-02g)",
          "3 af de nye typer integreres med det samme i auto-genererede focus-pakker som 5. mål: `youth_development` får `u25_development_delta` (måler om dine U25-ryttere faktisk udvikler sig), `star_signing` får `signature_rider` (tvinger dig til at signe en stjerne), `balanced` får `relative_rank` (du skal slå over halvdelen i divisionen). De 4 øvrige typer (monument/jersey/profit/domestic) er klar i motoren men venter på S-02f (klub-DNA) eller S-02g (manager-konkurrence) for at blive valgt",
          "Migration ([2026-05-05-board-goal-types.sql](database/2026-05-05-board-goal-types.sql)) tilføjer `u25_stat_sum` + `u25_count`-kolonner på `board_plan_snapshots`. processSeasonEnd snapshotter U25-stat-sum hver sæson, så `u25_development_delta` kan beregne udvikling fra plan-start-baseline. Pattern matcher eksisterende cumulative_stage_wins/gc_wins ([economyEngine.js](backend/lib/economyEngine.js))",
          "Ny shared kontekst-loader [boardGoalContext.js](backend/lib/boardGoalContext.js) henter cumulativeMonumentPodiums, cumulativeJerseyWins, seasonJerseyWins, cumulativeTransferBalance, planStartU25StatSum/Count og divisionManagerCount fra DB. Kaldes både fra processSeasonEnd (sæson-evaluering) og /api/board/status (live BoardPage-outlook) — samme query-pattern, ingen drift",
          "buildNegotiatedGoal udvidet for alle 7 typer: jersey_wins/profitable_transfers/u25_development_delta/relative_rank/domestic_dominance kan lempes på target (-1 hhv. -50K), monument_podium/signature_rider er allerede minimum (target=1) men halverer satisfaction_penalty. buildGoalLabel skriver danske labels for alle 7",
          "27 nye backend-tests (191/191 grønne total) i [boardGoalTypes.test.js](backend/lib/boardGoalTypes.test.js): hver type får true-case + false-case + null/awaiting_data-edge-case. Plus integration-tests der bekræfter at de 3 nye 5. mål dukker op i `generateBoardGoals` med korrekt category-metadata",
        ],
      },
    ],
  },
  {
    version: "2.35",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02c · Navngivne board-medlemmer — bestyrelsen får ansigter og stemmer",
        items: [
          "Bestyrelsen er ikke længere en abstrakt enhed. 9 håndlavede arketyper (Sponsoraten 💰, Traditionalisten 🎩, Talentspejderen 🔭, Resultatjægeren 🏆, Pragmatikeren ⚖️, Ungdoms-idealisten 🌱, Nationalist-purist 🏳️, Klassiker-purist 🪨, GC-elsker ⛰️) udgør pool'en. Hvert hold får 5 medlemmer tildelt ved sæson-1-slut: 3 matchet til holdets identitet (`identity_basis`) + 2 wildcards der ikke modsiger de første ([boardArchetypes.js](backend/lib/boardArchetypes.js))",
          "Avatar-grid på BoardPage viser de 5 medlemmer med emoji, navn, kort beskrivelse og 'Formand'-mærke (★) på den med højeste alignment til dit hold. Wildcards markeres så du kan se hvem der bringer kontrast frem for ekko-kammer ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx))",
          "Bestyrelsens vurdering på hver plan får nu en stemme: et citat fra det medlem der ejer feedback-kategorien (resultater → Resultatjægeren, økonomi → Sponsoraten, identitet → Traditionalisten/Nationalist-purist, etc.). Ved tvivl falder valget på formanden. 270 reaktions-templates total (30 pr. arketype, fordelt på 6 buckets: positive/warning/negative feedback + goal-proposal/achievement/failure)",
          "Hver mål-kort har nu en 'X reagerer'-knap der expand'er et citat fra det medlem der ejer mål-kategorien — fx ★ Sponsoraten ved et 'no_outstanding_debt'-mål der bløder. Genbruger samme expand-pattern som S-02b's identity-badge ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx))",
          "Replacement-trigger live: 2× plan-udløb i træk under 30% tilfredshed → bestyrelsen udskifter formanden. Ny formand vælges fra de 4 ikke-tildelte arketyper baseret på alignment + non-conflict. Counter sidder per-team på `teams.consecutive_low_satisfaction_expirations`, resetes ved tilfredshed ≥30. Notif: \"Bestyrelsen har valgt en ny formand: {arketype-navn}\" ([economyEngine.js](backend/lib/economyEngine.js), [boardMembers.js](backend/lib/boardMembers.js))",
          "Conflict-detection beskytter mod modsigende holdninger: 3 'friction-akser' (debt_aversion, youth_focus, results_pressure) tjekkes ved wildcard-valg. Algoritmen tillader fallback når non-conflicting pool er tom (sjælden edge case som meget youth-tunge hold), men foretrækker altid harmoni hvis muligt — Q2-præmis 'Må dog ikke være modsigende, hvis muligt'",
          "Migration ([2026-05-05-board-members.sql](database/2026-05-05-board-members.sql)) tilføjer `team_board_members`-tabel + `teams.consecutive_low_satisfaction_expirations`-counter. Beta-reset clearer alle members + nulstiller counter + identity_basis så næste sæson 1 starter fra ren tavle ([betaResetService.js](backend/lib/betaResetService.js))",
          "16 nye backend-tests (164/164 grønne total) dækker arketype-shape (9 × 30 templates), conflict-detection, alignment-scoring, non-conflicting wildcard-valg + fallback edge case, deterministisk re-replay, idempotent assignment, dominant-member-selection (kategori + chairman-fallback), reaction-sampling pr. tone/status, replacement-counter increment/reset/trigger, AI/bank skip, og end-to-end startSequentialNegotiation med member-tildeling",
        ],
      },
    ],
  },
  {
    version: "2.34",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02b · 1yr-auto-gen + identity-feeding + auto-accept — bestyrelsen kender dit hold",
        items: [
          "Bestyrelsen \"ser\" nu hvem du er. Ved sæson-1-slut tager den et frosset snapshot af dit hold (national kerne, U25-andel, primær specialisering, stjerneprofil) og persisterer det på `teams.season_1_identity_basis`. Snapshottet er *narrativets fundament* — selv hvis dit hold ændrer sig i sæson 2+, husker bestyrelsen hvad den så ([boardIdentity.js](backend/lib/boardIdentity.js))",
          "5-årsmål viser nu inline-badges der forklarer *hvorfor* målet eksisterer: \"★ Bygger paa din FR-kerne (5/8 ryttere)\" eller \"★ Bygger paa dit ungdomsaftryk (50% U25 i sæson 1)\". Klik badgen → fuld forklaring expand med hvilke data fra sæson 1 der gjorde målet relevant. Implementeret som data-lag (`identity_basis_rationale` på goal-objektet) så fremtidige UI-redesigns kan genbruge det ([BoardPage.jsx](frontend/src/pages/BoardPage.jsx), [boardGoals.js](backend/lib/boardGoals.js))",
          "Ny auto-accept-cron tager over når manageren glemmer at handle. Tre tærskler styret af `seasons.race_days_completed` ([boardAutoAccept.js](backend/lib/boardAutoAccept.js)): T-3 (race-day 2) → info-reminder i Bestyrelse-feed (`board_update`); T-1 (race-day 4) → kritisk \"Skal handles\"-notif (`board_critical`); T-0 (race-day 5+) → bestyrelsen vælger selv en plan baseret på dit holds identitet og signer den. Notif-dedup (24h) gør cron idempotent",
          "Auto-accept's default-fokus afledes fra `season_1_identity_basis`: høj U25-andel → ungdomsudvikling, elite-stjerneprofil → stjernesignering, GC/sprint/klassiker-spec → stjernesignering, ellers balanceret. Ingen blind \"balanced\"-fallback — selv hvis bestyrelsen tager over, matcher valget den retning, holdet allerede peger",
          "Ny countdown-banner på BoardPage: \"Bestyrelsen venter paa din forhandling — N race-days tilbage\". Skifter til kritisk farve ved T-1. Ny Bestyrelse-feed-sektion samler alle board-relaterede notifs (`board_update` + `board_critical`) ét sted så manageren har overblik uden at gå ind i Indbakken",
          "Migration ([2026-05-05-board-1yr-autogen.sql](database/2026-05-05-board-1yr-autogen.sql)) tilføjer `teams.season_1_identity_basis JSONB` + udvider `notifications_type_check` med `board_critical`. Migration kører automatisk ved push — ingen manuel handling",
          "Bagved-kulisserne: ny `boardGoals.generate1YrFromLongerPlans` returnerer to varianter (Stabil + Resultatfokus nu) klar til wizard-redesign i S-02h. 15 nye backend-tests dækker computeSeasonOneIdentity, identity-feeding-annotation, auto-accept-tærsklerne og idempotent replay (146/146 grønne)",
        ],
      },
    ],
  },
  {
    version: "2.33",
    date: "2026-05-05",
    label: "Beta",
    changes: [
      {
        category: "S-02a · Bestyrelse-redesign foundation — sæson 1 = baseline, sæson 2+ åbner sekventielt",
        items: [
          "Sæson 1 er nu en baseline-sæson hvor bestyrelsen *observerer* dit hold uden krav. Ingen mål, ingen tilfredsheds-evaluering, sponsor-modifier låst på 1.0× — du har en hel sæson til at finde din retning før forhandlingerne starter. Bestyrelsesside ([BoardPage](frontend/src/pages/BoardPage.jsx)) viser et nyt observations-banner i baseline-fasen i stedet for tomme plan-kort",
          "Når sæson 1 slutter, åbner sekventiel onboarding automatisk: 5-årsplan først, derefter 3-årsplan, derefter 1-årsplan. Trigger sker inline i `processSeasonEnd` — ingen separat cron, ingen race conditions ([economyEngine.js](backend/lib/economyEngine.js))",
          "Migration ([2026-05-05-board-foundation.sql](database/2026-05-05-board-foundation.sql)) tilføjer `board_profiles.is_baseline` + nyt `plan_type='baseline'` samt `transfer_windows.board_negotiation_state` (global onboarding-fase-lås: `locked` → `pending_5yr` → `complete`). Per-team-fremdrift udledes stadig af eksisterende rows i `board_profiles` — window-state låser kun globalt hvad der må forhandles",
          "Beta-reset opretter nu *én* baseline-row pr. team i stedet for tre plan-rows ([betaResetService.js](backend/lib/betaResetService.js)) — fuld reset af alle eksisterende managers' board-data godkendt i Q-batch 1A Q6 (vision-lock). Næste reset starter alle hold i frisk observations-sæson",
          "Ny `boardEngine.startSequentialNegotiation` ([boardSequentialNegotiation.js](backend/lib/boardSequentialNegotiation.js)) sletter baseline-rows og åbner window i `pending_5yr` ved sæson-1-slut. `transfer-window/open` arver state fra forrige window så onboarding-fasen ikke nulstilles ved sæson-skift",
          "Foundation for ~10-12 sub-slices i S-02 master-roadmap. S-02b (1yr-auto-gen + identity-feeding + auto-accept) eller S-02c (navngivne board-medlemmer) kan startes næste session — begge har kun S-02a som dep",
        ],
      },
    ],
  },
  {
    version: "2.32",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Ønskeliste-stjerne flyttet ud — én konsistent placering på tværs af sider",
        items: [
          "Ønskeliste-stjernen sad i sidste kolonne på rytteroversigten — langt til højre forbi alle 14 stat-kolonner. Du skulle scrolle vandret for at finde den, og på ønskeliste-siden var fjern-handlingen en separat \"★ Fjern\"-knap i en \"Handling\"-kolonne, mens tilføj-handlingen kun fandtes på rytteroversigten. To forskellige interaktioner for samme funktion",
          "Stjernen sidder nu i sin egen kolonne lige til højre for rytter-navnet på alle rytteroversigter — rytteroversigten ([RidersPage](frontend/src/pages/RidersPage.jsx)), ønskelisten ([WatchlistPage](frontend/src/pages/WatchlistPage.jsx)) og aktivitets-sidens ønskeliste-tab ([ActivityPage](frontend/src/pages/ActivityPage.jsx)). På ønskelisten er den fyldte stjerne (★) nok til at fjerne — \"★ Fjern\"-knappen er væk; \"Handling\"-kolonnen bruges nu kun til \"Start auktion\" hos fri agents",
          "Ny delt komponent [WatchlistStar.jsx](frontend/src/components/WatchlistStar.jsx) sikrer at stjernen ser ens ud og opfører sig ens overalt — samme stopPropagation-håndtering så klik på stjernen ikke trigger row-navigation, samme tooltip og hover-effekt",
        ],
      },
    ],
  },
  {
    version: "2.31",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Ønskeliste — paginering, fryst header og fuld bredde",
        items: [
          "Ønskelisten viste hele din watchlist i én lang liste på en smal centreret container — på en bred skærm var der >40% tom plads i siderne, og hvis du havde mange ryttere skulle du scrolle tilbage til toppen for at se kolonnenavne. Nu matcher den ryttersidens layout: tabellen fylder fuld bredde (max-w-full) og kolonne-headeren er sticky så den følger med når du scroller vertikalt",
          "Client-side paginering: 50 ryttere ad gangen med Forrige/Næste-knapper nederst og \"Viser X–Y af N\" status. Page resettes til 1 når du ændrer et filter eller en sortering, så du ikke ender på en tom side hvis filteret krymper resultatet",
          "Ryttersiden på mobil er skiftet fra kort-layout til samme tabel som desktop. Tabellen scroller vandret på små skærme i stedet for at gemme kolonner — konsistent oplevelse på tværs af platforme. Død kode (`RiderCard`-komponent, `MOBILE_STATS`-array, isMobile-state og resize-listener) er fjernet",
        ],
      },
    ],
  },
  {
    version: "2.30",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Indbakke — nyt \"Skal handles\"-tab samler pending decisions (S-05)",
        items: [
          "Indbakken havde tabs for personlige notifikationer (\"Mine\") og liga-aktivitet (\"Ligaen\"), men der var ingen FM-stil oversigt over tilbud/byttehandler/lånetilbud du SKAL tage stilling til lige nu. Du måtte hoppe ind på Transfers-siden for at se om nogen ventede på dit svar. Det var sidste P0-slice fra pre-launch roadmap (S-05 Indbakke-unification)",
          "Nyt tab \"Skal handles\" (mellem Mine og Ligaen) viser præcis de tilbud hvor DU er den part der skal beslutte: pending tilbud du har modtaget som sælger, modbud du har modtaget som køber, awaiting_confirmation hvor din bekræftelse mangler, og pending lånetilbud sendt til dit hold. Tab-knappen får en gul badge med antallet — så du kan se i ét blik om der er noget at handle på",
          "Hvert item viser rytter, modpart, pris/cash-justering og hvilken handling der ventes (\"Acceptér / afvis tilbud\", \"Bekræft handel\", \"Svar på modbud\"). Klik fører til /transfers hvor du kan accept/reject/counter/confirm. Realtime-subscription på `transfer_offers`, `swap_offers` og `loan_agreements` opdaterer listen instant når en modpart eller du selv ændrer state",
          "Auctions er IKKE inkluderet i \"Skal handles\" — at være current_bidder er ikke en stillestående beslutning (du KAN bidde højere men er ikke under tidskrav). Outbid-events kommer fortsat som notifikationer i \"Mine\". Backend: ny `inboxPending.js` lib + `GET /api/inbox/pending` (10/10 unit tests grønne for role-classification + aggregation + edge cases)",
          "Drift-fix: `activity_feed`-tabellen har levet som runtime-only siden v2.x — nu committed til [schema.sql](database/schema.sql) + idempotent migration (`database/2026-05-04-activity-feed-schema-commit.sql`). Ingen data-migration; 467 historiske rows er bevaret intakt. Orphan side `ActivityFeedPage.jsx` slettet (allerede redirected til /notifications siden v2.x — selve filen ryddet op)",
        ],
      },
    ],
  },
  {
    version: "2.29",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Trupstørrelse håndhæves automatisk ved vinduesluk (S-03)",
        items: [
          "Hidtil har der ikke været en konsekvens for at gå i sæson med ulovlig trup. Squad-grænser (D1 20-30, D2 14-20, D3 8-10) er en dokumenteret invariant, men håndhævelse manglede helt — managers kunne starte sæsonen med fx 5 ryttere i D3 og bare scoor færre point. Det fjernede al deadline-day-pres og var sidste P0 i pre-launch roadmap der kunne lade en manager rage launch-balancen",
          "Når et transfervindue lukker, fyrer cron én gang pr. lukket vindue (atomic claim på `transfer_windows.squad_enforcement_completed_at` — samme idempotency-mønster som Final Whistle-rapporten). Hvert human-team tjekkes mod sine division-grænser og auto-justeres: under min → cheapeste tilgængelige fri-/AI-rytter købes til 150% × market_value (nødlån oprettes hvis balancen ikke rækker); over max → seneste-erhvervede ejede rytter sælges tilbage til ai_team_id med fuld market_value som kredit",
          "Bøde + point-fradrag pr. afvigende rytter: 100.000 CZ$ + 200 point (begge retninger). Bøden bogføres som `squad_violation_fine` i finance_transactions; fradraget akkumuleres i en ny `season_standings.penalty_points`-kolonne der ikke overskrives af `updateStandings`-recompute fra race_results. Ranking i ranglisten bruger effektive points (`total_points − penalty_points`) så fradraget faktisk koster placering",
          "Rangliste-UI viser nu fradraget eksplicit: \"1.500 (−200)\" med tooltip der forklarer både optjente og fradragne points. Ingen visuel støj for hold uden fradrag — notationen vises kun når penalty_points > 0",
          "Ny `riders.acquired_at`-kolonne sporer hvornår en rytter blev erhvervet, så over_max-salg går efter senest-tilkomne. Backfill brugte `created_at` som rimeligt udgangspunkt. Live-opdatering tilføjet til alle 6 write-paths: auktions-finalisering (vinder + bank-køb), direkte transfer, byttehandel (begge retninger + revert-path), lån-buyout, admin-override, samt window-open flush af pending-team-id",
          "Migration: `database/2026-05-04-squad-enforcement.sql` — tilføjer `riders.acquired_at`, `transfer_windows.squad_enforcement_completed_at`, `season_standings.penalty_points`, plus tre finance-types (`auto_squad_purchase`, `auto_squad_sale`, `squad_violation_fine`) og notification-type `squad_enforced`. 7/7 unit tests grønne for `enforceTeamSquadCompliance` (within-limits no-op, auto-purchase med bøde, auto-sale med bøde, nødlån-fallback, AI-skip) + idempotency-test for cron-claim",
        ],
      },
    ],
  },
  {
    version: "2.28",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Admin — Discord webhook-test viser nu konkret status pr. webhook (S-06)",
        items: [
          "Test-knappen i Discord webhooks-sektionen viste tidligere kun en global toast (\"✅ Testbesked sendt\") uden at sige hvilken webhook der svarede hvad. Hvis testen fejlede, fik admin en generisk fejl-tekst og måtte gætte om det var URL'en, token'et eller netværket. Det gjorde smoke-verifikation upålidelig — man kunne ikke vide om en \"stille død\" webhook var i live eller ej",
          "Resultatet vises nu inline pr. webhook-row med tidsstempel: \"✅ leveret (204) · 14:23:05\" ved succes, eller en konkret diagnose ved fejl: 404 → \"webhook ikke fundet (slettet på Discord?)\", 401/403 → \"adgang afvist (token revoket?)\", 429 → \"rate-limited\", 0 → netværksfejl med detail. Resten vises med rå Discord-status + fejl-tekst (op til 80 tegn)",
          "Backend `sendTestEmbed` returnerer nu `{ ok, status, error }` i stedet for at kaste — så routen kan returnere struktureret data og frontend kan vise konkret diagnose. Loading-state nøgles på webhook-id i stedet for URL (mere stabilt hvis URL'en redigeres). Ingen schema-ændring; ingen invariant ændret",
          "Smoke-værktøjet er hermed launch-klar (S-06 P0 lukket): admin klikker Test pr. webhook → ser status med det samme → fixer eventuelle 404/401-cases ved at opdatere URL'en. Health-check cron er flyttet til P1 \"Drift-monitor\" hvor den hører hjemme",
        ],
      },
    ],
  },
  {
    version: "2.27",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "UCI-sync fanger nu compound surnames — ingen flere Tobias Lund Andresen-fejl",
        items: [
          "Mandags-cron'en (uci_scraper.py) downgradede 14 ryttere til 5 UCI-points pga. name-mismatch — bl.a. Tobias Lund Andresen (skulle være 2.514), Tobias Halland Johannessen (2.393) og Sakarias Koller Løland (319). Root cause: scraperen matchede DB-navne mod UCI-CSV som rene strings, så DB-rytteren \"Tobias\" + \"Lund Andresen\" matchede ikke UCI-formatet \"ANDRESEN Tobias Lund\" pga. ordrækkefølgen, og blev derfor sat til fallback-værdien 5",
          "Match-logikken er omskrevet til **token-set-baseret**: \"Tobias\" + \"Lund Andresen\" og \"ANDRESEN Tobias Lund\" har samme tokens {ANDRESEN, LUND, TOBIAS} og matches nu uafhængigt af ordrækkefølge. Subset-matching håndterer også middle names der findes på den ene side men ikke den anden (\"HONORÉ Mikkel Frølich\" ↔ \"Mikkel Honoré\")",
          "Normalisering håndterer nu **æ/ø/å eksplicit** (æ→ae, ø→oe, å→aa) — tidligere blev de fjernet helt af ASCII-strip, så \"Mørkøv\" blev til \"MRKV\". Bindestreger, apostroffer og punktummer normaliseres også til mellemrum (\"Lund-Andresen\" og \"O'Connor\" tokeniseres ens på begge sider)",
          "**Safety-gate** tilføjet: ryttere med popularity ≥ 70 ELLER nuværende uci_points ≥ 100 vil aldrig blive auto-downgraded til 5 igen pga. matching-fejl. Hvis matching slår fejl for en sådan rytter, bevares den nuværende værdi og der logges en warning til admin",
          "Backend's manuelle sync-knap (sheetsSync.js) er opdateret med præcis samme normaliseringslogik som mandags-cron'en, så de to paths ikke kan drive fra hinanden. Migration: `database/2026-05-04-fix-uci-points-token-mismatch.sql` (anvendt). 21/21 unit tests passerer for normalize/match/safety-gate",
        ],
      },
    ],
  },
  {
    version: "2.26",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Admin — annullér aktive auktioner med ét klik",
        items: [
          "Live-drift har manglet et undo-værktøj: hvis en auktion blev oprettet ved fejl eller med forkert pris, var den eneste vej ud direkte DB-manipulation. Det har holdt admin-drift afhængig af manuelle SQL-kald og var en launch-blocker (S-04 i pre-launch roadmap)",
          "Ny `Aktive auktioner`-sektion i Admin-panelet lister alle aktive og forlængede auktioner med rytter, sælger, pris, antal unikke budgivere og sluttidspunkt. Per-auktion `Annullér`-knap åbner confirm-modal, kører backend-cancel og opdaterer listen",
          "Backend: nyt `auctionCancellation.js`-modul kører atomar status-transition `active|extended → cancelled` (race-safe mod parallel cron-finalizer — hvis finalizer vinder, returneres 409). Bud frigives automatisk fordi balance-reservation beregnes ved query-time fra aktive auktioner — der er ingen fysisk balance at refundere",
          "Notifikationer: ny `auction_cancelled`-type sendes til alle unikke budgivere + sælger (hvis ikke allerede budgivet). Inbox + Discord DM dækker begge kanaler. Admin-handling logges i `admin_log` med rytter-id, bidder-count og auktions-pris",
          "Migration: `auctions.cancelled_at` + `auctions.cancelled_by_user_id` tilføjet til audit-spor. `'cancelled'` var allerede gyldig status i CHECK-constraint",
        ],
      },
    ],
  },
  {
    version: "2.25",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Økonomi — rytter-løn beregnes nu udelukkende af databasen",
        items: [
          "Indtil nu havde to forskellige kode-paths hver sin løn-formel: økonomi-cron og sæson-end skrev 10% af markedsværdien (canonical), mens auktioner, transfers og lån-buyouts skrev 15% (afvigende). Den samme rytter kunne derfor have løn 80.000 mandag (efter cron) og 120.000 onsdag (efter en transfer) — og tilbage til 80.000 næste mandag. Det forvirrede økonomi-rapporter og gjorde sponsor-budgetter upålidelige",
          "Fix: `riders.salary` er nu en GENERATED STORED column i Postgres med formlen `max(1, round((max(5, uci_points) * 4000 + prize_earnings_bonus) * 0.10))`. Ingen application-path kan længere skrive direkte til kolonnen — DB beregner den automatisk når `uci_points` eller `prize_earnings_bonus` opdateres",
          "5 write-paths fjernet: `auctionFinalization.js` (vinder-tildeling + bank-salg), `transferExecution.js` (transfer-confirm), `routes/api.js` (lån-buyout), `economyEngine.js` (UCI-cron) og `scripts/import_riders.py`. Funktionerne `calculateMarketSalary` og `calculateAuctionSalary` er slettet (15%-formel forsvinder helt fra kodebasen)",
          "Migration kører som en del af release: `database/2026-05-04-salary-generated-column.sql` drop+add'er kolonnen, og DB udfylder alle 8.699 ryttere med korrekt 10%-værdi øjeblikkeligt. Fra dette punkt kan rytter-løn IKKE komme ud af sync med uci_points",
        ],
      },
    ],
  },
  {
    version: "2.24.1",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Tech debt — lint-baseline ryddet",
        items: [
          "Frontend lint stod på 0 errors / 41 warnings i flere måneder, hvor ~24 af dem var ren død kode (ubrugte imports, dead state, dead funktioner) efterladt fra refactors. Hver ship-rapport måtte verificere \"samme baseline\" i stedet for \"0/0\", hvilket gjorde det svært at opdage hvis en ny warning sneg sig ind",
          "Ryddet alle 24 unused-vars warnings: fjernet dead `ProfileRedirect` (App), `FormBadge` (Standings), `formatSignalDelta` (Board), gammel `prizes`-state + `savePrize` + `prizeGroups` + `prize_tables`-load (Admin), `myStanding`/`isNewUser` (Dashboard), `myUserId`/`myTeamId` (HallOfFame), `uploadedRows` duplikat-state (Races) og 10 andre dead identifiers",
          "Baseline er nu 0 errors / 17 warnings — alle resterende er bevidste `react-hooks/exhaustive-deps` på load-once mønstre der ville kræve case-by-case analyse for at \"fixe\" sikkert. Build uændret (8.46s)",
        ],
      },
    ],
  },
  {
    version: "2.24",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Admin — Forhåndsvisning før import af løbsresultater",
        items: [
          "Sheets-import havde indtil nu ingen synlig matchrapport: når admin trykkede `Importer`, blev resultater committet med det samme — uden at vise hvilke ryttere/hold der matchede, hvilke der blev droppet, eller hvilke løb der ikke fandtes i DB. Det førte til Sæson 6-fejlen hvor forkerte sæsondata blev indlæst og måtte rulles tilbage manuelt",
          "Ny flow: `Forhåndsvis`-knap kalder backend i dry-run mode (ingen DB writes) og viser per-løb tabel med: sæson-nummer, sheet-navn vs. DB-navn, antal rækker, matched/unmatched ryttere (✓/⚠), matched/unmatched hold, total points der ville blive tildelt. Hover over ⚠-tal viser de konkrete navne der ikke kunne resolves",
          "`Bekræft import`-knap (grøn) kører den rigtige import; `Annullér` rydder forhåndsvisningen. Skipped løb (race-navne uden DB-match) vises som separat advarsel øverst i preview",
          "Backend: `POST /api/admin/import-results-sheets` accepterer nu `dry_run: true` i body. Dry-run springer alle DB-writes over (`race_results.delete/insert`, `races.update`, `import_log.insert`, standings-recompute) og returnerer kun `preview`-array. Singular execution path bevares — kun ét nyt parameter, ingen ny endpoint",
        ],
      },
    ],
  },
  {
    version: "2.23.1",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Sæson-snapshot — tomme vinder-kort er nu ikke-klikbare",
        items: [
          "Da Sæson 1 stadig er igangværende uden afsluttede løb, viser de 4 vinder-kort på `/seasons/:seasonId` tom-state (\"Ingen præmier endnu\" / \"Ingen transfers\" / \"Ingen handler\" / \"Ingen etaper kørt\"). Kortene rendrede dog stadig som klikbare buttons med hover-ring — klik gjorde dog intet, hvilket var forvirrende",
          "Fix: tomme vinder-kort har nu `cursor: default`, ingen hover-effekt og er `disabled`. Når data dukker op (efter første løb afsluttes), bliver kortene automatisk klikbare igen og linker til hold-/rytter-profil",
        ],
      },
    ],
  },
  {
    version: "2.23",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Sæson-snapshot — én side svarer på \"Hvad skete der i sæson N?\"",
        items: [
          "Ny deelbar URL `/seasons/:seasonId` samler kalender, slutstilling og sæsonens vindere på ét skærmbillede. Eksisterende `SeasonEndPage` udvidet (ikke ny side) — bevarer slutstilling pr. division, op/ned-rykning og pointudviklings-charts uændret",
          "Nyt: 4 vinder-kort øverst — 💰 Præmie-leader (mest CZ$ tjent fra løb), 💸 Største enkelt-transfer (køb/salg), 🔄 Mest aktive transfer-marked-hold, 🚴 Stage-king (flest etapesejre). Klikbare → hold-/rytter-profil",
          "Nyt: Kalender-sektion lister alle løb i sæsonen med dato, type, præmiepulje og status (afsluttet/igang/kommende). Klik åbner løbets historikside",
          "Sidebar: `Resultater → Sæsonresultater` omdøbt til `Sæson-snapshot` og peger nu på `/seasons` (auto-vælger aktiv eller seneste). Den gamle URL `/season-end` redirecter automatisk",
          "Bibliotek-tab: `Sæson N`-cellen er nu en klikbar genvej til snapshot-siden — drill-down fra et konkret løb til \"hvilken sæson-kontekst spillede dette i?\"",
          "Dropdown-skift opdaterer URL så snapshottet kan deles via link, og siden er forudsigelig deeplinkbar",
        ],
      },
    ],
  },
  {
    version: "2.22",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Løb — Konsolideret hub med Bibliotek og Point & præmier",
        items: [
          "Tre overlappende race-sider (`/races`, `/race-archive`, `/race-points`) er konsolideret til ét hub `/races` med tabs: Kalender · Bibliotek · Point & præmier",
          "Nyt: Bibliotek-tab viser alle løb på tværs af alle sæsoner med filtre (sæson, klasse, status, fritekst-søgning). Klik på en række åbner løbets historikside med tidligere udgaver og top-ryttere",
          "Nyt: Point & præmier-tab samler præmieformlen (1 UCI-point = 1.500 CZ$) og fulde pointtabeller for alle 9 løbsklasser direkte i hubben",
          "IA: Sidebaren viser nu kun ét race-link — `Liga → Løb`. `Resultater → Løbsarkiv` er fjernet (den gamle URL `/race-archive` redirecter til Bibliotek-tabben). `Resultater`-overbliksiden linker direkte til de relevante tabs",
          "Backend: ny `GET /api/races?season=&class=&q=&status=` for programmatisk adgang (auth-required, returnerer race-rows + season-relation)",
        ],
      },
    ],
  },
  {
    version: "2.21",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Under motorhjelmen — Subtile alert-tints og hover-effekter virker nu på tværs af appen",
        items: [
          "Alert-cards på Notifikationer, Bestyrelse, Admin, Marked, Auktioner, Transfers m.fl. brugte gennemsigtige farve-varianter (fx 8% rød tint på outbid-alerts, 30% grøn hover på dashboard-knapper) der silently rendrede transparent pga. en pre-eks. opacity-bug i color-tokens — Tailwinds `/N`-syntax virker ikke med plain `var()` farver, og 3 opacity-trin (3%, 8%, 12%) brugt 30+ steder var slet ikke defineret",
          "Fix: alle status-farver (`cz-success`, `cz-danger`, `cz-warning`, `cz-info`, deres `-bg0` aliases samt `cz-accent`/`cz-accent-t`) konverteret til channel-format med `<alpha-value>` placeholder, og opacity-trin 3/8/12 tilføjet til Tailwind theme",
          "Verificeret runtime via Claude Preview: 35 opacity-klasser tester nu korrekt — fx `bg-cz-info-bg0/20` = `rgba(29, 78, 216, 0.2)` (var transparent før). Dark mode `cz-*-bg` (uden -0) bevarer sin bevidste rgba 12% tint urørt",
          "Visuel impact: subtile bg-tints på alert-cards, hover-feedback på CTA-knapper, status-baggrunde og badge-chips er nu synlige som designet — ikke kritisk regression, men polish",
        ],
      },
    ],
  },
  {
    version: "2.20",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Under motorhjelmen — Deadline Day banner-fase pressure-dot fix",
        items: [
          "Banneret øverst i siden under Deadline Day havde en bug i 'pressure'-fasen (sidste timer): den røde indikator-prik var transparent fordi en CSS-token (`cz-danger-bg0`) brugt 20+ steder ikke var defineret i tailwind config — silently dropped",
          "Fix: tilføjet 4 aliases i `tailwind.config.js` for de 4 status-farve-varianter (`cz-{danger,success,warning,info}-bg0` → peger på base-farven). Lukker også samme typo på Notifikationer, Bestyrelse, Admin og flere andre alert-cards",
          "Verificeret runtime via Claude Preview: pressure-dot er nu `rgb(185, 28, 28)` (rød) som forventet. Final Whistle Discord-embed format auto-testet mod Discord limits — alle felter inden for spec",
        ],
      },
    ],
  },
  {
    version: "2.19",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — tour-knap på empty-states + completion-celebration",
        items: [
          "Marked, Auktioner og Bestyrelse: empty-state-kortene har nu en 'Vis mig rundt'-knap — managers der lander direkte på siden via menuen får nu tour-tilbuddet uanset om de gik via Dashboard eller ej (før virkede tour kun via 'Vis mig hvordan' på kom-i-gang-kortet)",
          "Dashboard: nyt celebration-kort vises engang når alle 4 grundtrin er gennemført — 'Du er klar' + tre quick-links til næste fase (Deadline Day, Bestyrelse, Hjælp & regler). Lukker post-onboarding-cliff'et hvor kortet før bare forsvandt",
          "Eksisterende managers der har dismisset progress-kortet ser stadig completion-kortet første gang efter denne deploy — derefter er begge kort skjult permanent indtil localStorage ryddes",
        ],
      },
    ],
  },
  {
    version: "2.18",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Flag virker nu korrekt i alle browsere (også Chrome på Windows)",
        items: [
          "Tidligere: flag blev rendret som Unicode-emoji — virker fint på macOS/iOS/Android og Firefox, men Chrome på Windows viste landekoder som tekst (DK, FR, ES) i stedet for flag, fordi Windows ikke har flag-emoji indbygget",
          "Nu: ny <Flag>-komponent baseret på flag-icons (SVG-sprite) — viser rigtige flag på tværs af alle browsere og OS, scalerer crisp ved enhver størrelse, virker offline",
          "22 callsites opdateret — Auktioner, Auktionshistorik, Transfers, Ryttere, Watchlist, Holdside, Hold-profil, Race-historik, Resultater, Rytterrangliste, Rytter-sammenligning, Rytter-stats, Head-to-Head, Bestyrelse",
          "Land-filter dropdown viser nu kun landenavn (uden emoji-prefix) — chip-visning og rytter-detaljer viser SVG-flag",
        ],
      },
    ],
  },
  {
    version: "2.17",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Fix: Korrekt sponsor- og løntiming i økonomi-explainer",
        items: [
          "Økonomi-explainer på /finance sagde fejlagtigt at sponsor udbetales 'månedligt' og løn trækkes 'løbende' — runtime udbetaler i virkeligheden begge som engangsbeløb (sponsor ved sæsonstart, løn ved sæsonafslutning)",
          "Hint-kort og tour-tekster opdateret så managers får et retvisende billede af hvornår pengene bevæger sig — hjælper til bedre planlægning af transferspidser og lånevalg",
        ],
      },
    ],
  },
  {
    version: "2.16",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — økonomi-explainer på /finance",
        items: [
          "Finanser: nyt explainer-kort ved første besøg forklarer de fire pengestrømme — sponsor (260K base × bestyrelses-modifier, link direkte til /board), løn (10% af rytterværdien pr. sæson), gældsloft pr. division (D1 1.200K · D2 900K · D3 600K), og forskellen på kort vs. langt lån",
          "'Vis mig rundt'-knap starter en kort tour med 3 peg-pil-tooltips: balance-kortet, gældsloft-indikatoren på Total gæld-kortet, og transaktionshistorikken hvor sponsor og løn løbende tikker ind",
          "Hint kan skjules permanent med × eller 'Spring over' — efter første dismiss vises explaineren ikke igen (gemt lokalt i din browser)",
        ],
      },
    ],
  },
  {
    version: "2.15",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — bestyrelse-explainer",
        items: [
          "Bestyrelse: nyt explainer-kort øverst på /board for managers uden plan — forklarer kort hvad bestyrelsen er, hvordan 1yr/3yr/5yr-strukturen virker, og hvilke KPI'er de vurderer på (resultater, økonomi, identitet, rangering)",
          "Tilfredshed → sponsor-modifier-tabellen vises i empty-state så du forstår hvordan din indsats slår igennem på indkomsten allerede inden første forhandling",
          "CTA 'Forhandl din første plan med bestyrelsen' åbner wizardens 5-årsplan-trin — og første gangs setup tvinger ikke længere wizarden op før du har set explaineren",
          "Kom-i-gang-kortets 'Vis mig hvordan' fungerer nu også på det fjerde trin (vælg bestyrelsesplan) — touren peger på de tre planer, sponsor-modifier og KPI-listen",
        ],
      },
    ],
  },
  {
    version: "2.14",
    date: "2026-05-04",
    label: "Beta",
    changes: [
      {
        category: "Under motorhjelmen — Deadline Day Flash Auction sikret mod fresh-setup-fejl",
        items: [
          "Database-opsætningen har manglet kolonnen som markerer en auktion som 'Flash Auction' (de 30-min-auktioner der kun kan startes under aktivt Deadline Day) — den var tilføjet manuelt i live-databasen, men ikke i de scripts der bruges når serveren sættes op fra bunden",
          "Tilføjet både som ny migration og direkte i schema-filer, plus en automatisk test der fanger det hvis kolonnen forsvinder igen — ingen synlig ændring for dig som manager, men fjerner risikoen for at Flash Auctions fejler hvis databasen genopsættes",
        ],
      },
    ],
  },
  {
    version: "2.13",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — guided squad-builder",
        items: [
          "Marked: nyt empty-state-kort øverst på rytter-listen for managers uden ryttere — forklarer filtre, viser balance + division-minimum, og knappen 'Find din første rytter' filtrerer automatisk listen til ryttere du har råd til",
          "Auktioner: engangs-banner forklarer +10%-overbud-reglen og 10-min auto-forlængelse første gang du besøger siden uden at have afgivet bud — kan skjules permanent med ×",
          "Kom-i-gang-kortet på Dashboard har nu en 'Vis mig hvordan'-knap der starter en kort tour med 2-3 peg-pil-tooltips på næste-trin-siden (Marked eller Auktioner)",
          "Touren peger på filtrene, rytter-listen og ønskelisten på Marked — og på bud-feltet og tid-tilbage-kolonnen på Auktioner — med 'Næste'/'Spring over' kontrol og automatisk scroll-til-element",
        ],
      },
    ],
  },
  {
    version: "2.12",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Onboarding v2 — kom-i-gang-kort på Dashboard",
        items: [
          "Nyt fremskridt-kort på Dashboard viser fire trin du har gennemført (eller mangler at gennemføre) for at få en god start: navngiv hold + manager, køb din første rytter, afgiv dit første bud og vælg en bestyrelsesplan",
          "Næste trin fremhæves med et direkte CTA-link så du ikke skal gætte hvor du skal hen",
          "Kortet kan skjules permanent med × — og forsvinder automatisk når alle fire trin er ✓",
          "Eksisterende managers ser kun de trin der ikke allerede er gennemført — har du fx alle tre indstillinger på plads, vises kortet slet ikke",
        ],
      },
    ],
  },
  {
    version: "2.11",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Kodekvalitet — react-rules på alle .jsx",
        items: [
          "ESLint react-regelsæt løftet fra .js-only til .{js,jsx} efter saneringspass af 71 pre-eksisterende issues — nye .jsx-filer fanger nu fejl ved samme niveau som .js",
          "Layout: NavItem og SidebarContent flyttet ud som top-level komponenter (rettede react-hooks/static-components — undgår at remounte sidebaren ved hver render)",
          "ConfettiModal: konfetti-partiklers borderRadius låst ved mount (rettede react-hooks/purity — Math.random kunne ellers ændre form ved hver render)",
          "BoardPage: ubrugt initial-værdi til nextNegotiationOptions fjernet",
          "22 sider: useEffect-blokke flyttet ned under deres data-loader-funktioner (rettede react-hooks/immutability — eliminerer reference-mismatch hvor effect kaldte funktion før den var declared)",
          "JSX-tekst med citationstegn escapet til &quot;/&apos; på 6 sider (rettede react/no-unescaped-entities)",
          "8 tomme catch-blokke fået kort begrundelse i stedet for at være helt tomme",
        ],
      },
    ],
  },
  {
    version: "2.10",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Tema — beskyttelse mod lyst-tema bugs",
        items: [
          "Lint-guard udvidet så hardcoded dark-only tekst- og kant-farver (text-white/N og border-white/N opacity-classes) ikke længere kan slippe gennem til prod — hullet der gjorde Panic Board ulæselig i lyst tema er nu lukket på rule-level",
          "Sidste tilbageværende dark-only opacity-class (TEST-label på Deadline Day banner ved override) ryddet samtidig",
        ],
      },
    ],
  },
  {
    version: "2.09",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Panic Board — synlighed og læsbarhed",
        items: [
          "Panic Board ligger nu i venstremenuen under Marked → så du kan finde den uden at gætte URL'en",
          "Siden er gjort læsbar i lyst tema — al tekst, kanter og status-farver bruger nu temasystemet i stedet for hardcodede dark-mode farver",
        ],
      },
    ],
  },
  {
    version: "2.08",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Tema — finpudsning",
        items: [
          "Potentiale-stjerner og rytter-statistik viser nu korrekt dæmpet tekst i begge temaer (PotentialeStars og statBg-fallback brugte tidligere en hardcoded grå der ikke fulgte temaet)",
        ],
      },
    ],
  },
  {
    version: "2.07",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Discord — privatliv",
        items: [
          "Privat info bliver privat. Overbud, vundne auktioner, modtagne transfertilbud og svar på dine egne tilbud sendes nu kun som DM — ikke længere som @mention i den fælles kanal hvor alle kan læse med",
          "Den offentlige kanal viser fortsat broadcasts (nye auktioner, gennemførte handler, byttehandler, sæson-events) men ingen person-rettet info",
        ],
      },
    ],
  },
  {
    version: "2.06",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Tema",
        items: [
          "Dark mode S2 — alle resterende sider og komponenter er nu fuldt tokeniseret. Transfers, Standings, Board, Notifikationer, Watchlist, Hall of Fame, Løb, Admin, Rytterstatistik og alle øvrige sider understøtter nu mørkt tema korrekt",
          "Komponenter opdateret: ConfettiModal, DeadlineDayBanner, DeadlineDayTicker, OnboardingModal, RiderDevelopmentTab, RiderFilters og SetupWizardModal",
        ],
      },
    ],
  },
  {
    version: "2.05",
    date: "2026-05-03",
    label: "Beta",
    changes: [
      {
        category: "Discord",
        items: [
          "Discord DM — push til hvor du allerede er. Når en bot er konfigureret på serveren, modtager du direkte beskeder ved overbud, vundne auktioner og transfer-tilbud/-svar",
          "Tilføj dit Discord bruger-ID under Profil → Discord Integration. Status-badge viser om DMs virker, og du kan sende en test-DM",
          "Opt-out: slå DM'er fra hvis du foretrækker kun @mention i kanalen — du kan altid skifte tilbage",
          "Dashboard-nudge til managers uden Discord-ID (kan dismisses med ×)",
        ],
      },
    ],
  },
  {
    version: "2.04",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Tema",
        items: [
          "Dark mode — nyt mørkt tema kan nu vælges under Profil & Indstillinger → Udseende",
          "Tre valgmuligheder: 'Følg system' (auto), 'Lyst', 'Mørkt'. Standard er 'Følg system'",
          "Sidebaren forbliver mørk i begge temaer for visuel konsistens. Dashboard, Mit Hold, Auktioner, Ryttere, Finanser, Login og Profil er fuldt understøttet — øvrige sider tokeniseres løbende",
        ],
      },
    ],
  },
  {
    version: "2.03",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Planlagte advarsler — alle aktive managers får en notifikation 24 timer, 2 timer og 30 minutter før transfervinduet lukker",
          "Final Whistle-rapport — automatisk Discord-opsummering ved vinduesluk: største handel, mest aktive manager, antal panikhandler",
        ],
      },
    ],
  },
  {
    version: "2.02",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Flash Auktion (30 min) — ny auktionstype tilgængelig under Deadline Day. Afsluttes præcis 30 minutter efter start, uanset aktivt vindue",
          "Hastebudsignal — 🚨-badge på transfertilbud når sælgerholdet er under eller på divisions-minimum. Vises hos sælger (modtagne tilbud) og køber (sendte tilbud)",
        ],
      },
    ],
  },
  {
    version: "2.01",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Live Ticker — horisontal nyhedsstribe i bunden af alle sider under Deadline Day med seneste bud, salg og transfers",
          "Panic Board (/deadline-day) — overblik over alle holds truppestørrelse vs. divisions-minimum med grøn/gul/rød status",
          "Automatisk opdatering hvert 10. sekund (ticker) og 30. sekund (Panic Board)",
        ],
      },
    ],
  },
  {
    version: "2.00",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Deadline Day",
        items: [
          "Deadline Day-banner — fase-bevidst countdown (anticipation/pressure/chaos) med dynamisk farve og puls",
          "Admin: toggle til at aktivere/deaktivere Deadline Day manuelt + input til lukketidspunkt for transfervinduet",
        ],
      },
      {
        category: "Teknisk",
        items: [
          "Supabase-klient opgraderet til fuld TypeScript-typesikkerhed via genereret Database-type",
        ],
      },
    ],
  },
  {
    version: "1.99",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Teknisk",
        items: [
          "Bugfix: auktionsbud-svar returnerede nu korrekt ISO-tidsformat ved forlængelse",
          "Intern kodekvalitet: automatisk lint-tjek (ESLint) og formatering (Prettier) tilføjet til begge frontend og backend",
          "Databasetyper genereret direkte fra live schema — reducerer risiko for fremtidige fejl ved DB-ændringer",
          "Nyt invariant-tjek: 6 domæne-regler verificeres automatisk mod live data efter hvert deploy",
        ],
      },
    ],
  },
  {
    version: "1.98",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Præmieudbetaling adskilt fra løbsresultat-import — resultater kan nu re-importeres uden at påvirke allerede udbetalte præmier",
          "Ny admin-sektion 'Præmieudbetaling': se hvad der er udbetalt og hvad der mangler for hele sæsonen",
          "Knap til at udbetale alle udestående præmier på én gang med komplet løb-for-løb oversigt",
          "Præmier udbetales kun når admin godkender — aldrig automatisk ved import",
        ],
      },
    ],
  },
  {
    version: "1.97",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Teknisk",
        items: [
          "Sikkerhedsopdatering: Excel-bibliotek opgraderet til patchet version (CVE-2023-30533)",
          "PCM-filimport understøtter nu både .xlsx og .xls",
        ],
      },
    ],
  },
  {
    version: "1.96",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Ny tidsregel: auktioner løber i 6 aktive timer — nattimer tæller ikke med (hverdage 22-16, weekender 23-8)",
          "Eksempel: auktion startet tirsdag 19:40 udløber onsdag 19:40 — auktion startet lørdag 19:40 udløber søndag 10:40",
          "Forlængelsesregel: bud inden for de sidste 10 minutter forlænger auktionen med 10 minutter fra budtidspunktet",
          "Admin: ny sektion 'Auktionsregler' i admin-panelet — rediger varighed, aktive vinduer og forlængelsesfrist",
        ],
      },
    ],
  },
  {
    version: "1.95",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Fix: Præmieformlen rettet til 1 UCI-point = 1.500 CZ$ (var fejlagtigt sat til 15.000 CZ$)",
          "Alle fremtidige løbsresultater beregnes med den korrekte faktor",
        ],
      },
    ],
  },
  {
    version: "1.94",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Resultater",
        items: [
          "Ny side: Pointtabel — vis UCI-point og præmier pr. løbsklasse (Tour de France, Giro/Vuelta, Monuments, WorldTour A/B/C, ProSeries, Klasse 1/2)",
          "Præmieformlen fremhævet med konkrete eksempler: 1 UCI-point = 1.500 CZ$",
          "Tilgængelig via Resultater → Pointtabel",
        ],
      },
    ],
  },
  {
    version: "1.93",
    date: "2026-05-02",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Masseopdatering: 1.138 ryttere rettet fra minimumsværdi til korrekte UCI-points — heriblandt João Almeida (14M CZ$), Thomas Silva, Chris Hamilton og hundredvis af andre der manglede i gammel top-1000 CSV",
          "Alle påvirkede rytteres løn er synkroniseret automatisk",
        ],
      },
    ],
  },
  {
    version: "1.92",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Synkroniseret rytterværdier med Google Sheet (autoritativ UCI-kilde, 3000 ryttere) — 35 ryttere opdateret inkl. Mick van Dijke, Brent Van Moer, Kwiatkowski, Valter, Tesfazion, Aniołkowski m.fl.",
          "Rettet forældede værdier sat fra gammel CSV: Tobias Halland Johannessen (2393 pts), Magnus Cort Nielsen (321 pts), Fredrik Dversnes (431 pts) m.fl.",
          "Forbedret import-algoritme: håndterer nu polske/nordiske specialtegn (ł, Ø) og alternativ translitteration (Tesfazion/Tesfatsion)",
        ],
      },
    ],
  },
  {
    version: "1.91",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Rettet rytterværdier for 17 ryttere med sammensatte efternavne eller mellemnavne i UCI-data (fx Tobias Lund Andresen, Tobias Halland Johannessen, Magnus Cort Nielsen, Mikkel Honoré m.fl.) — disse var sat til minimumsværdi (20.000 CZ$) pga. navne-mismatch ved import",
          "Forbedret import-algoritme: navnematch bruger nu token-baseret søgning der håndterer omvendt navnerækkefølge, mellemnavne i UCI og varianter som Joe/Joseph og Bjoern/Bjorn",
        ],
      },
    ],
  },
  {
    version: "1.90",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Fuld nulstilling dækker nu alle spildata: transferarkiv (listings, tilbud, swaps), finanslån og renter, indbakke og præmiepenge-bonus på ryttere nulstilles korrekt ved reset",
          "Nye individuelle reset-knapper: Nulstil transferarkiv, Nulstil lån og Nulstil indbakke",
          "Rettet fejl hvor sæson-sletning fejlede pga. FK-constraint på board_plan_snapshots og board_profiles",
        ],
      },
    ],
  },
  {
    version: "1.89",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Sikkerhed",
        items: [
          "Erstattet xlsx-biblioteket (afviklet, to kendte sårbarheder) med exceljs — XLSX-import af løbsresultater er upåvirket",
        ],
      },
    ],
  },
  {
    version: "1.88",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Dashboard",
        items: [
          "Nyt Sæsonstatus-banner på dashboardet — viser aktiv sæson, antal dage til sæsonslut, løbsdage-progress og om transfervinduet er åbent eller lukket",
        ],
      },
    ],
  },
  {
    version: "1.87",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "UI",
        items: [
          "Tabeloverskriften (navn, evner, potentiale mv.) er nu sticky på rytteroversigten og auktionssiden — rækken fryser fast øverst, mens du scroller ned",
        ],
      },
    ],
  },
  {
    version: "1.86",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Byd-kolonnen er nu fastlåst i højre side af tabellen — input og knap er altid synlige uden vandret scroll",
          "Fjernet 'Min. bud'-tekst fra hver række — minimumsbud er allerede forudindtastet i feltet",
          "Tættere rækker giver overblik over flere auktioner på skærmen ad gangen",
          "Sælger- og Alder-kolonner skjules på mindre skærme og vises kun på meget brede skærme (1280px+)",
        ],
      },
    ],
  },
  {
    version: "1.85",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Rettet: Sortering på kolonner (navn, værdi, stats, potentiale) virkede ikke — rækkefølgen forblev uændret uanset valgt sortering",
        ],
      },
    ],
  },
  {
    version: "1.84",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Rettet: Potentiale-synkronisering opdaterede kun ~900 ryttere — nu opdateres alle 7.600+ ryttere korrekt",
          "Rettet: Halvstjerner (½) blev afrundet ned pga. europæisk decimalformat — potentiale-værdier som 4,5 vises nu korrekt",
        ],
      },
    ],
  },
  {
    version: "1.83",
    date: "2026-05-01",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Nyt: Potentiale-felt på alle ryttere — vises med guldstjerner (½–6 stjerner) på alle oversigter, rytterdetalje, auktioner, hold og ønskeliste",
          "Ryttere over 30 år vises med sølvstjerner i stedet for guld — alder afgør fremtidigt potentiale",
          "Sortering på Potentiale tilgængelig via kolonneoverskrift på alle lister",
          "Nyt filter: Potentiale (min–max) i filterpanelet på alle rytteroversigter",
          "Potentiale synkroniseres automatisk fra PCM-data (dyn_cyclist.value_f_potentiel) ved næste dataopdatering",
        ],
      },
    ],
  },
  {
    version: "1.82",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Filtrering",
        items: [
          "Ny land-filter dropdown på alle rytter-oversigter — viser kun lande repræsenteret i det aktuelle datasæt, med flag og fuldt landsnavn",
          "Fjernet 'Sortér efter' dropdown — sortering sker i stedet ved at klikke direkte på kolonneoverskrifterne (TT, BK, FL, Værdi osv.)",
        ],
      },
    ],
  },
  {
    version: "1.81",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Ryttere",
        items: [
          "Alle 8.699 ryttere har nu korrekt nationalitetsflag baseret på PCM-regiondata — vises overalt: rytterliste, holdside, auktioner, transfers og rytterdetalje",
          "138 lande repræsenteret fra PCM's fulde region-database (inkl. Kosovo, Timor-Leste, Ghana, Senegal m.fl.)",
        ],
      },
    ],
  },
  {
    version: "1.80",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Stabilitet",
        items: [
          "Rettet: password reset-flow afventer nu sessionen korrekt ved PKCE-callback, så token ikke mistes ved hurtig redirect",
        ],
      },
    ],
  },
  {
    version: "1.79",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Stabilitet",
        items: [
          "Rettet: dashboardet kan ikke længere sidde fast i en evig indlæsningsspinner ved netværksfejl",
          "Rettet: navn-wizarden kan ikke længere sende formularen flere gange ved gentagne Enter-tryk",
          "Rettet: navn-wizarden viser nu en brugervenlig fejlbesked hvis sessionen er udløbet",
        ],
      },
    ],
  },
  {
    version: "1.78",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Onboarding",
        items: [
          "Ny tvungen navn-wizard: nye managers skal vælge holdnavn og managernavn ved første login — blokkerer navigationen til det er gjort",
          "Ny velkomstmodal for nye managers: tre feature-cards (Marked, Auktioner, Bestyrelse) og et fremtrædende link til Hjælp & Regler",
          "Velkomstmodalen vises automatisk første gang (nul ryttere + ikke tidligere vist) og huskes via localStorage",
        ],
      },
    ],
  },
  {
    version: "1.77",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Marked",
        items: [
          "Rytterværdi viser nu dynamisk markedsværdi: baseværdi plus gennemsnit af seneste op til 3 sæsoners præmiepenge",
          "Auktionsbudsfeltet udfyldes nu med laveste gyldige bud: mindst 10% over nuværende pris, afrundet op til nærmeste 1.000 CZ$",
          "Auktionslisten viser nu sælger tydeligt som AI eller managerhold",
        ],
      },
      {
        category: "Transfers",
        items: [
          "Sendte og modtagne tilbud kan arkiveres, når de er afsluttede",
          "Dashboardets Transfers & Tilbud viser nu konkrete tilbud, modpart, beløb og om noget kræver handling",
        ],
      },
    ],
  },
  {
    version: "1.76",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Finanser",
        items: [
          "Finanssiden viser nu præmiepenge tydeligt: et dedikeret kort med samlet totalbeløb og en løb-for-løb oversigt med løbsnavn og beløb",
          "Præmiepenge-transaktioner viser nu løbsnavn (f.eks. 'Præmiepenge — Tour de France') i stedet for generisk tekst",
          "Divisionsbonus (type: bonus) vises nu korrekt i transaktionshistorik med grøn farve",
        ],
      },
      {
        category: "Økonomi",
        items: [
          "Lønsats sænket fra 15% til 10% af rytterens effektive markedsværdi — giver mere holdbar økonomi med store hold",
          "Gældslofter hævet markant: D1 360K→1.200K · D2 300K→900K · D3 240K→600K — bedre buffer ved svære sæsoner",
          "Startsponsoren for nye hold hævet fra 240K til 260K CZ$/sæson",
        ],
      },
    ],
  },
  {
    version: "1.75",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Præmiepenge fra løb er nu adskilt fra sæsonpoint: UCI-point bestemmer ranglisten, og præmiepenge = UCI-point × 1.500 CZ$ udbetales direkte til holdbalancen ved resultatimport",
          "Divisionsbonus ved sæsonafslutning: D1 300K/200K/100K/50K · D2 150K/100K/50K/25K · D3 75K/50K/25K — bogføres som 'bonus' i finance-loggen",
          "Præmiepenge knyttes nu til løbets klasse og UCI-pointtabellen — løb uden løbsklasse genererer 0 i præmie",
        ],
      },
    ],
  },
  {
    version: "1.74",
    date: "2026-04-30",
    label: "Beta",
    changes: [
      {
        category: "Profil",
        items: [
          "/profil-siden viser nu korrekt Profil & Indstillinger — holdnavn og managernavn kan redigeres direkte her",
        ],
      },
    ],
  },
  {
    version: "1.73",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Nødlån oprettet ved sæsonafslutning bliver nu knyttet til den rigtige sæson i finance-loggen, så admin-verifikation og fremtidig økonomituning kan se dem korrekt",
          "Der er tilføjet en service-visible sæsonafslutnings-verifier, som tjekker løn, lånerenter, nødlån, board snapshots og kendte oprykninger før økonomiændringer rulles videre",
        ],
      },
    ],
  },
  {
    version: "1.72",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Auktionsafslutningen har nu en ekstra sikring for aktive fri-/AI-/bankauktioner, der blev startet uden registreret førende budgiver: initiatoren behandles som første budgiver og køber rytteren, hvis ingen overbyder",
          "Auktioner, Min Aktivitet, Dashboard og historik viser nu også implicitte første bud som en føring, så du kan se at du står til at vinde rytteren",
        ],
      },
    ],
  },
  {
    version: "1.71",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Når du starter en auktion på en AI-, bank- eller fri rytter, tæller startprisen nu som dit første bud, så du kan vinde rytteren selv hvis ingen andre byder",
          "Auktionslisten viser nu den rigtige førende manager fra start og markerer ikke længere initiatoren som sælger, når rytteren faktisk ikke er deres egen",
        ],
      },
    ],
  },
  {
    version: "1.70",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Sæsonafslutning loader nu hold, ryttere og bestyrelsesplaner separat, så live DB-relationer ikke kan få finance og board til at blive sprunget over",
          "Hvis sæsonafslutning ikke kan læse eller skrive nødvendige economy-/board-data, fejler den nu før sæsonen markeres færdig",
          "Der er tilføjet en admin-reparation for sæsonafslutningens finance og board side effects uden at køre oprykning/nedrykning igen",
        ],
      },
    ],
  },
  {
    version: "1.69",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Teknik",
        items: [
          "Finance- og notifikationskontrakter er afstemt med runtime, så lån, nødlån, lånerenter, admin-justeringer og transfer-interesse ikke rammer DB type-checks forkert",
          "Notifikationssiden grupperer nu lånebeskeder under Økonomi og transfer-interesse under Transfers",
        ],
      },
    ],
  },
  {
    version: "1.68",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Aktiv sæson har nu fået løbskalenderen indlæst fra races-arket, så løbsresultater ikke længere stopper på en tom races-tabel",
          "Google Sheets-resultatimport matcher nu løbsnavne mere robust på tværs af accenter, bindestreger og kendte kalenderaliaser som Volta Valenciana",
          "Resultater Cycling Zone-arket er importeret for sæson 6 med 709 resultatrækker fordelt på 18 løb uden skipped races",
          "Re-import af løbsresultater rydder nu gamle præmie-transaktioner for samme løb først, så finance og holdbalance ikke dubleres ved en ny import",
          "Adminens løbsklasser og pointtabel bruger nu den moderne herre-UCI-skala: Tour de France, Giro/Vuelta, Monuments, WorldTour A/B/C, ProSeries, Class 1 og Class 2",
          "UCI-point for klassement, klassikere, etaper, pointtrøje, bjergtrøje og førertrøje er seedet i spillet og kan fortsat redigeres i Admin",
        ],
      },
    ],
  },
  {
    version: "1.67",
    date: "2026-04-29",
    label: "Beta",
    changes: [
      {
        category: "Rangliste",
        items: [
          "Opryknings- og nedrykningszoner på holdranglisten følger nu samme divisionsregel som den rigtige sæsonafslutning: Division 2-3 kan rykke op, og Division 1-2 kan rykke ned",
        ],
      },
    ],
  },
  {
    version: "1.66",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Teknik",
        items: [
          "Frontend-routes lazy-loades nu per side, så appens første JavaScript-bundle er mindre og Vite-build ikke længere advarer om en stor initial chunk",
          "Sideindlæsning bruger en fælles loading-state, så navigationen stadig føles stabil mens en tung side hentes første gang",
        ],
      },
    ],
  },
  {
    version: "1.65",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Auktioner",
        items: [
          "Rytterprofilen viser nu Start auktion for bank- og AI-ryttere, så den eksisterende bank/AI-auktionsmodel kan bruges direkte fra UI",
          "Direkte transfertilbud skjules nu for bank- og AI-ryttere på rytterprofilen, så manageren bliver ledt til auktion i stedet for en blokeret tilbudsvej",
        ],
      },
      {
        category: "Status",
        items: [
          "Roadmap og feature-status er ryddet op, så lukkede review-hardening punkter ikke længere står som næste implementeringsarbejde",
        ],
      },
      {
        category: "Profil",
        items: [
          "Min Profil er tilbage som indstillingsside, så managere igen kan ændre holdnavn og managernavn via den kanoniske backend-route",
          "Egen managerprofil har nu en direkte genvej til redigering af manager- og holdnavn",
        ],
      },
    ],
  },
  {
    version: "1.64",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Season-end preview skelner nu mellem lånerente som øget gæld og kontantbalance efter løn, så nød-lånsbehov matcher den faktiske sæsonafslutning",
        ],
      },
      {
        category: "Verifikation",
        items: [
          "Live season-flow er verificeret read-only mod Supabase: aktiv sæson mangler stadig løbskalender/resultater, så rigtig import-til-standings-flow er blokeret af datagrundlaget",
        ],
      },
    ],
  },
  {
    version: "1.63",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Season-end preview bruger nu samme board-evaluering og sponsor-modifier som den rigtige sæsonafslutning",
          "Preview viser både nuværende og forventet board-tilfredshed, målstatus og forventet sponsorudbetaling for næste sæsonstart",
        ],
      },
      {
        category: "Økonomi",
        items: [
          "Løn, renter, nødlånsbehov og sponsor-preview beregnes samlet i backendens economy engine, så admin-preview ikke driver fra runtime",
        ],
      },
    ],
  },
  {
    version: "1.62",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Integrationer",
        items: [
          "UCI-sync er hardenet til top 3000 med pagination-safety, så syncen fejler før write hvis datadækningen ikke er komplet",
          "UCI-værdier og rytterlønninger opdateres nu i samme kontrollerede flow, så løn følger den nyeste værdi efter en godkendt UCI-sync",
          "Den ugentlige UCI-workflow kører nu salary recalculation automatisk efter pointopdateringen",
        ],
      },
      {
        category: "Økonomi",
        items: [
          "Rytterlønninger genberegnes med den eksisterende økonomiformel: 15% af max(5 UCI-point × 4.000 CZ$ + præmiebonus)",
          "Salary update læser hele ryttertabellen pagineret og skriver i kontrollerede batches, så store opdateringer ikke stopper efter de første 1000 ryttere",
          "Der er tilføjet et manuelt backend-script til kontrolleret løngenberegning ved behov",
        ],
      },
      {
        category: "Sikkerhed",
        items: [
          "UCI-sync stopper nu ved mistænkelig massenedskrivning til 5 UCI-point i stedet for at skrive dårlige værdier live",
          "Dry-run for UCI-sync må ikke skrive til Sheets eller Supabase og bruges som safety-check før live write",
          "Regressionstests dækker både scraper coverage, salary recalculation og økonomiformlen bag lønningerne",
        ],
      },
    ],
  },
  {
    version: "1.61",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Rytterprofil",
        items: [
          "Ny 'Udvikling'-tab på rytterprofilen med graf for UCI-point over tid",
          "Stats-udvikling kan nu vises som graf for hver af rytterens 14 evner",
          "Fanen viser også de seneste historiske datapunkter fra sync-historikken",
        ],
      },
      {
        category: "Hjælp",
        items: [
          "Hjælp og FAQ er opdateret med forklaring af udviklingsfanen på rytterprofilen",
        ],
      },
    ],
  },
  {
    version: "1.60",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Beta-reset er udvidet til en komplet reset-suite med nulstilling af marked, trupper, balancer, divisioner, bestyrelser, løbskalender, sæsoner, XP/level og achievements",
          "Fuld nulstilling markerer nu tydeligt at flowet er en test-reset og viser kvittering for hver del af resetten",
          "Balance-reset kan valgfrit rydde finance-transaktioner for aktive manager-hold uden at røre AI-, bank- eller frosne hold",
        ],
      },
    ],
  },
  {
    version: "1.59",
    date: "2026-04-28",
    label: "Beta",
    changes: [
      {
        category: "Resultater",
        items: [
          "Google Sheets-import af løbsresultater bruger nu samme kanoniske backend-path som øvrige resultatflows",
          "Præmiepenge, finance-transaktioner og sæsonstilling opdateres nu konsistent efter Sheets-import",
        ],
      },
      {
        category: "Transfers & Marked",
        items: [
          "Parkerede transferaftaler og byttehandler kan ikke længere annulleres af manager, når begge parter har accepteret",
          "Parkerede direkte transfers holder transferlisten i forhandlingsstatus indtil transfervinduet åbner og handlen faktisk gennemføres",
          "Bankryttere kan ikke længere modtage direkte transfer- eller byttetilbud — de skal gå via auktioner",
        ],
      },
      {
        category: "Auktioner",
        items: [
          "Auktionsbud skal nu være mindst 10% over nuværende pris, afrundet op til nærmeste 1.000 CZ$",
          "Aktive auktionsføringer reserverer nu både disponibel balance og trupplads, så man ikke kan føre flere auktioner end holdet kan rumme",
        ],
      },
      {
        category: "Navigation",
        items: [
          "Min Profil redirecter nu altid til den indloggede managers egen profil",
          "Sidebarens aktive markering matcher nu hele rutesegmenter, så /team ikke længere rammer /teams",
        ],
      },
    ],
  },
  {
    version: "1.58",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Integrationer",
        items: [
          "UCI-point synkroniseres nu automatisk hver mandag fra den officielle UCI-rangliste (top 3000 ryttere)",
          "Historisk log af UCI-points og rytterstats gemmes ved hver synkronisering — danner grundlag for 'udvikling over tid'-visning på rytterprofilen (kommer i næste version)",
        ],
      },
    ],
  },
  {
    version: "1.55",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Ranglister",
        items: [
          "Tydelig oprykningsindikator på alle ranglister: grøn venstrekant og lysegrøn baggrund for oprykningspladser, rød for nedrykningspladser",
          "Zone-separator linje (grøn gradient) adskiller tydeligt oprykningszone fra den øvrige tabel",
          "Zone-separator linje (rød gradient) adskiller nedrykningszone fra den sikre zone",
          "Badges '↑ Op' og '↓ Ned' har nu tydeligere styling med baggrundsfarve",
          "Gælder både aktiv sæsonrangliste og afsluttede sæsonresultater",
        ],
      },
    ],
  },
  {
    version: "1.54",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Rytterprofil",
        items: [
          "Ny 'Historik'-tab på rytterprofilen — viser alle ejerskiftehændelser i kronologisk rækkefølge",
          "AI-salg vises med type-badge og vinderpris",
          "Direkte transferhandler vises med køber, sælger og pris",
          "Byttehandler vises med begge hold og eventuel kontantjustering",
          "Låneaftaler vises med lejer, udlejer, sæsoninterval og gebyr",
        ],
      },
    ],
  },
  {
    version: "1.53",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Transfers & Marked",
        items: [
          "Parkering af direkte transferaftaler og byttehandler: begge parter kan nu bekræfte en handel mens sæsonen er aktiv og transfervinduet er lukket",
          "Handlen parkeres med status 'Aftalt — afventer vindue' (violet badge) og gennemføres automatisk simultant ved transfervinduets åbning",
          "Samme model som auktioner: alle parkerede handler eksekveres på én gang når admin åbner vinduet",
          "Når en handel parkeres, trækkes alle andre aktive tilbud på de involverede ryttere øjeblikkeligt tilbage",
          "Begge parter kan stadig annullere en parkeret handel inden vinduet åbner",
          "Forhandling (tilbud, modbud, bytteforslag) er nu altid tilladt uanset vinduets tilstand",
        ],
      },
    ],
  },
  {
    version: "1.52",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Resultater",
        items: [
          "Google Sheets-import af løbsresultater — admin kan nu importere sæsonresultater direkte fra et Google Sheet med kolonnerne Rank, Name, Team, Benævnelse, Løb, Sæson",
          "Understøtter alle 8 benævnelse-typer: Etapeplacering, Klassement, Klassiker, Pointtrøje, Bjergtrøje, Ungdomstrøje, Etapeløb Hold, Klassiker Hold",
          "Automatisk etape-detektion (rank-nulstilling = ny etape) og standings-genberegning efter import",
          "Re-import er idempotent — eksisterende resultater for matchede løb erstattes",
        ],
      },
    ],
  },
  {
    version: "1.51",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Rytterdatabase",
        items: [
          "Evne-filtre (slidere) virker nu korrekt — min og max er to separate, synlige slidere i stedet for overlappende (grå = minimum, amber = maximum)",
        ],
      },
      {
        category: "Discord",
        items: [
          "Webhook-routing rettet — gennemførte transfers og swaps sendes nu korrekt til 'Transferhistorik'-webhook, øvrige notifikationer til '#auktioner'",
        ],
      },
    ],
  },
  {
    version: "1.50",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Indbakke",
        items: [
          "FM-style indbakke — notifikationer og aktivitetsfeed samlet på én side med to faner: 'Mine' og 'Ligaen'",
          "'Mine'-fanen har kategorifiltre: Alle, Ulæste, Auktioner, Transfers, Bestyrelse, Finans",
          "'Ligaen'-fanen viser globale spilhændelser med filtre: Alle, Auktioner, Transfers, Sæson",
          "Aktivitetsfeed-siden er nu en del af Indbakke — /activity-feed redirecter automatisk",
        ],
      },
    ],
  },
  {
    version: "1.49",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Managerprofiler",
        items: [
          "Online-status er nu live — grøn indikator vises på managerprofiler og holdlisten når en manager har været aktiv inden for de seneste 5 minutter",
          "Sidst set vises på managerprofiler (fx '12 min siden') når manageren er offline",
          "Login-streak tæller daglig aktivitet og vises på managerprofilen (🔥)",
          "Online-tæller i sidebaren viser antal aktive managere lige nu",
        ],
      },
      {
        category: "Notifikationer",
        items: [
          "Ulæste-badge på 'Indbakke' i navigationssidebaren — viser antal ulæste notifikationer (maks 9+)",
          "Mobilvisning: klokkebadge øverst til højre viser ulæste i realtid",
        ],
      },
    ],
  },
  {
    version: "1.48",
    date: "2026-04-26",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Beta-testværktøjer — ny admin-sektion med 4 handlinger: annuller marked, nulstil trupper, nulstil balancer og fuld nulstilling",
          "Hvert værktøj kræver bekræftelse og viser kvittering med præcist antal påvirkede ryttere, holds og markedsaktiviteter",
        ],
      },
    ],
  },
  {
    version: "1.47",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Rytterdatabase",
        items: [
          "Sort-dropdown viser nu 'Værdi' i stedet for 'UCI Point' — mere præcist navn",
          "Ny 'Løn'-kolonne i rytterlisten — viser årsløn i CZ$, sorterbar ligesom Værdi",
          "Nyt lønfilter — filtrer ryttere på løn-interval (min/max CZ$) med filter-chip",
        ],
      },
      {
        category: "Head-to-Head",
        items: [
          "Hold B viser nu automatisk holdforslag ved fokus i søgefeltet — ingen typing nødvendig",
        ],
      },
    ],
  },
  {
    version: "1.46",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Startkapital for nye hold er sænket fra 2.000.000 til 800.000 CZ$",
          "Standard sponsor-indkomst er sænket fra 400.000 til 240.000 CZ$ pr. sæson",
          "Alle eksisterende hold er opdateret til de nye værdier",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Garanteret salg er nu låst til egne ryttere — exploit der tillod køb af AI-ejede ryttere til 50% af Værdi via Garanteret salg er lukket",
          "Bestyrelses-outlook og category-scores på Dashboard vises nu korrekt igen efter boardEngine-refactor",
        ],
      },
    ],
  },
  {
    version: "1.45",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Bugfix",
        items: [
          "Rettet: man kan nu købe en AI/fri rytter på auktion, selvom man er den eneste byder — fejlen skyldtes at en mislykket budplacering blev vist som succes uden feedback",
        ],
      },
    ],
  },
  {
    version: "1.44",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Rytterværdi er nu dynamisk: UCI-point × 4000 CZ$ + gennemsnit af seneste op til 3 sæsoners præmiepenge fra spillet",
          "Lønnen er ændret fra 10% til 15% af rytterens effektive markedsværdi",
          "Alle eksisterende rytterlønninger er genberegnet med den nye 15%-model",
          "Minimum-regel: ryttere med færre end 5 UCI point tildeles automatisk 5 UCI point (20.000 CZ$ minimumsværdi)",
          "Præmiebonus opdateres ved sæsonslut for alle ryttere — værdien vokser med holdsuccesen",
          "Køb via auktion eller transfer sætter straks ny løn baseret på køberens præmiebonus + handelspris",
        ],
      },
    ],
  },
  {
    version: "1.43",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Økonomi",
        items: [
          "Alle beløb og værdier er skaleret ×4000 — rytterpriser, holdbudgetter, præmiepuljer, lønninger og gæld",
          "Rytterens markedsværdi er nu UCI-point × 4000 CZ$ (f.eks. en rytter med 500 UCI-point er nu 2.000.000 CZ$ værd)",
          "Holdenes startkapital er 2.000.000 CZ$ og standard sponsor-indkomst er 400.000 CZ$ pr. sæson",
          "Alle eksisterende hold, ryttere, lån, auktioner og transaktioner er opdateret tilsvarende via database-migration",
        ],
      },
    ],
  },
  {
    version: "1.42",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Admin",
        items: [
          "Ny Brugere-sektion i Admin: se alle brugere med hold og rolle, skift rolle mellem admin og manager, og slet brugere permanent",
          "Sletning af bruger fjerner Supabase-login og notifikationer — holdet bevares men mister sin ejer",
          "Løbskalender har nu Slet-knap — sletter løbet og alle tilknyttede resultater",
        ],
      },
    ],
  },
  {
    version: "1.41",
    date: "2026-04-25",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Hvert bestyrelsesmål viser nu om det er et obligatorisk krav eller ej — tydeligt markeret i måloversigten",
          "Mål der er bagud vises med advarselsstatus (I fare / Tæt på / På sporet) baseret på aktuelle holddata",
          "Aktuelle fremskridt vises direkte på hvert mål — f.eks. nuværende placering vs. mål for top N-finish",
          "Bestyrelsens karakter (sportsambition, økonomirisiko, identitetsstyrke) vises nu i plankortet under bestyrelsens vurdering",
          "Ny advarselsbanner hvis tilfredshed falder under 25% — ingen fyring, men skærpede krav ved næste planforhandling",
          "Forhandlingswizarden viser nu tydeligt hvilke mål der er obligatoriske krav",
        ],
      },
    ],
  },
  {
    version: "1.40",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden viser nu tre parallelle bestyrelsesplaner (5-årsplan, 3-årsplan og 1-årsplan) simultant på samme side — hver plan har egne mål og tilfredshedsmåling",
          "Wizard-flowet åbner nu for én specifik plantype, så du forhandler med bestyrelsen om præcis den plan du vælger",
          "Første gang du åbner Board-siden oprettes alle tre planer automatisk i rækkefølge 5yr → 3yr → 1yr",
        ],
      },
    ],
  },
  {
    version: "1.39",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Nationalitetsflag vises nu på Hold, Team-profil, Auktioner, Ønskeliste, Transfermarked, Auktionshistorik, Head-to-Head og Ryttersammenligning — flag er nu konsekvent på alle rytterflader",
        ],
      },
    ],
  },
  {
    version: "1.38",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Gennemførte transfers og byttehandler sendes nu automatisk til en dedikeret Discord-kanal — konfigureres via Admin under Discord webhooks med typen 'Transferhistorik'",
        ],
      },
    ],
  },
  {
    version: "1.37",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Løbsarkiv er nu tilgængeligt under Resultater — alle løb fra alle sæsoner kan nu browses på ét sted",
          "Hvert løb har sin egen historikside med alle tidligere udgaver og vinderen af hver sæson",
          "Bedste ryttere vises akkumuleret på tværs af alle udgaver af et løb — sorteret efter sejre og point",
          "Akkumuleret point-graf viser de bedste rytteres samlede præstationer i et givet løb",
          "Løbsarkiv er tilføjet som hub-link på Resultater-overblikssiden",
        ],
      },
    ],
  },
  {
    version: "1.36",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Resultater-hub tilføjet som samlet indgang til resultatområdet — viser tophold, topscorere og links til alle resultat-sider",
          "Rytterrangliste er nu tilgængelig under Resultater — vis alle rytteres sæsonresultater med etapesejre, GC-sejre, pointklassement, bjergklassement og ungdomsklassement",
          "Rytterranglisten inkluderer både manager-ejede og AI-ejede ryttere og kan filtreres og sorteres på alle kolonner",
        ],
      },
    ],
  },
  {
    version: "1.35",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "'UCI Point' er omdøbt til 'Værdi' i hele UI — rytterliste, auktioner, transfers og ønskeliste bruger nu det samme begreb",
          "Auktionsformularen håndhæver nu minimum Værdi som startpris — du kan ikke sætte en lavere pris end rytterens Værdi",
          "'Garanteret salg' er nu tydeligt markeret som undtagelse i auktionsformularen — afkrydses for at sætte startpris til 50% af Værdi",
          "Rytterliste og rytterside viser nu en '⚡ Auktion'-badge hvis rytteren er i en aktiv auktion",
          "Transferlisten viser nu hvornår en rytter blev sat til salg",
          "Ryttertype vises nu som et tydeliggjort badge på ryttersiden",
          "Nationalitetsflag vises nu på rytterlisten og ryttersiden",
          "Du får nu notifikation i indbakken når en rytter på din ønskeliste sættes til auktion eller salg",
        ],
      },
    ],
  },
  {
    version: "1.34",
    date: "2026-04-24",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Min Aktivitet er ombygget til seks faner: Kræver handling, Auktioner, Transfers, Lån, Ønskeliste og Historik",
          "Siden åbner nu på 'Kræver handling' som default — tilbud du skal svare på, modbud og afventende lejeforslag samles øverst",
          "Auktioner der slutter inden for 1 time vises i 'Kræver handling' med live-nedtæller",
          "Lån (lejeaftaler) har fået sin egen fane med adskillelse af 'Jeg udlåner' og 'Jeg låner'",
          "Ønskeliste-fanen viser dine gemte ryttere kompakt med markedsstatus-badge hvis en rytter er i aktiv auktion",
          "Historik-fanen samler afsluttede auktioner, lukkede transfers og færdige lejeaftaler",
          "Klik på rytternavn i alle rækker åbner rytterens statistikside direkte",
        ],
      },
    ],
  },
  {
    version: "1.33",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Design",
        items: [
          "UI er konverteret fra mørkt tema til lyst tema — varm creme-baggrund, hvide kort, mørk navy-sidebar",
          "Navigationen har nu tydelig hierarki: sektionsoverskrifter (OVERBLIK, MARKED osv.) er klart adskilt fra klikbare menupunkter",
          "Sidebar-ikoner er fjernet fra menupunkter for et renere og mere scanbart udtryk",
          "Aktiv menupunkt vises med gyldent highlight og afrundede kanter",
          "Status-farver (grøn/rød/orange/blå) er justeret for god kontrast på lys baggrund",
          "Spinner og loading-states er opdateret til lyst tema",
          "CSS custom properties introduceret som fundament for design-tokensystemet",
        ],
      },
    ],
  },
  {
    version: "1.32",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Notifikationer er omdøbt til Indbakke — siden samler alle systemhændelser ét sted",
          "Klik på en besked i Indbakken fører nu direkte til den relevante side (auktioner, transfers, løb osv.) i stedet for blot at markere som læst",
          "Holdoversigten viser nu en grøn online-indikator ved managere der er aktive lige nu",
        ],
      },
    ],
  },
  {
    version: "1.31",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Navigationen er omstruktureret med fire tydelige grupper: Overblik, Marked, Resultater og Liga — tidligere var sider spredt på kryds og tværs",
          "Ranglisten, Sæsonresultater og Hall of Fame er samlet i en ny 'Resultater'-gruppe",
          "Min Aktivitet og Ønskeliste (tidligere Talentspejder) er nu under Marked",
          "Løbskalender og Sæson Preview er flyttet under Liga",
          "Notifikationer og Min Managerprofil er rykket op under Overblik",
          "Klik på Cycling Zone-logoet fører nu direkte til Dashboard",
          "Min Profil er foldet ind i managerprofilen — /profil-siden redirecter automatisk",
        ],
      },
    ],
  },
  {
    version: "1.30",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Hemmelige achievements afslører ikke længere navn eller beskrivelse i tooltip-hover, før de er låst op — låste hemmelige achievements viser nu '???' i stedet",
          "Discord-webhooks sendes nu korrekt ved nye auktioner, overbud, transfer-tilbud, transfer-svar og sæsonstart/-slut — notifier-modulet var tidligere koblet fra alle event-sites",
        ],
      },
    ],
  },
  {
    version: "1.29",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Standings gemmer nu også divisionens interne placering (`rank_in_division`), så board-evaluering og sæsonruntime ikke længere mangler rangeringsdata ved season-end",
          "Admin har nu en direkte '↻ Standings'-rebuild på sæsoner, så en aktiv eller afsluttet sæson kan genberegnes sikkert ud fra gemte løbsresultater, hvis live-data tidligere er drevet",
        ],
      },
    ],
  },
  {
    version: "1.28",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden forklarer nu tydeligere hvorfor bestyrelsen reagerer, med synlige drivere pr. kategori samt ekstra forklaring på signaler fra historik, national kerne og stjerneprofil",
          "Seneste board request viser nu konkrete fokus- og målændringer direkte i UI, så tradeoffs ikke kun står som en kort tekstbesked",
          "National kerne vises nu med landenavn og flag på Board-siden i stedet for kun en rå landekode",
        ],
      },
    ],
  },
  {
    version: "1.27",
    date: "2026-04-23",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsen bruger nu national kerne og stjerneprofil direkte i sin løbende vurdering, så tydelig identitet og store profiler faktisk tæller i board-outlook og season-end",
          "Store profiler giver nu lidt ekstra sponsor/prestige i boardets læsning af holdet, men de hæver også forventningerne til resultater og sponsorvækst i mere ambitiøse planer",
          "Direkte board-skift mellem ungdomsspor og stjernespor bliver nu oftere håndteret som et gradvist tradeoff via en balanceret mellemposition i stedet for et hårdt instant switch",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Backend og database stopper nu dobbelt board-requests i samme sæson, så race conditions ikke kan oprette to svar fra bestyrelsen på én gang",
        ],
      },
    ],
  },
  {
    version: "1.26",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden viser nu også national kerne og stjerneprofil, så bestyrelsens læsning af holdets identitet går dybere end kun specialisering, U25-andel og trupstatus",
          "Balancerede hold med en tydelig national kerne kan nu få et nationalt identitetsmål direkte i bestyrelsesplanen, så board-krav bedre matcher holdets faktiske DNA",
          "Board-status og season-end-evaluering bruger nu samme board-riderfelter til identitetslæsningen, så national/stjerneprofil ikke driver mellem UI og runtime",
        ],
      },
    ],
  },
  {
    version: "1.25",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Nye bestyrelsesplaner skalerer nu efter division, nuværende holdprofil og trupbredde, så mål ikke længere kan lande uden for divisionens holdgrænser",
          "Board-siden viser nu bestyrelsens læsning af holdet med primær/sekundær specialisering, U25-andel og trupstatus direkte fra den delte board-engine",
          "Board requests bruger nu også holdprofilen, så skift mod mere ungdom eller mere resultatfokus bliver vurderet mere kontekstuelt",
        ],
      },
    ],
  },
  {
    version: "1.24",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Login-flowet har nu fået et rigtigt 'Glemt password?'-entrypoint, så managers kan bede om et reset-link uden manuel hjælp",
          "Recovery-mails lander nu på en dedikeret `/reset-password`-side, så ny adgangskode kan vælges uden at blive afbrudt af login-redirects",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler og FAQ forklarer nu også, hvordan password reset fungerer i auth-flowet",
        ],
      },
    ],
  },
  {
    version: "1.23",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Board-siden har nu fået board requests, så du kan sende én strategisk forespørgsel pr. aktiv sæson direkte til bestyrelsen",
          "Bestyrelsen kan nu svare med godkendelse, delvis godkendelse, afvisning eller et tradeoff, og resultatet bliver logget på den samme backend-path som resten af board-systemet",
          "Board-status returnerer nu også request-status og request-muligheder, så BoardPage læser både outlook og requests fra samme kanoniske `/api/board/status`-path",
        ],
      },
    ],
  },
  {
    version: "1.22",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Achievements syncer nu mod live historik i stedet for stale backend-felter, så bud-, transfer-, watchlist-, hold- og board-relaterede unlocks kan dukke op igen",
          "Achievement-checket kører nu efter login-streak-opdateringen ved app-load, så streak-baserede unlocks ikke bliver tabt på en race condition",
        ],
      },
    ],
  },
  {
    version: "1.21",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Admin-import af løbsresultater kører nu gennem samme backend execution path som godkendte pending resultater, så standings og præmiepenge opdateres ens med det samme",
          "Admin-sæsonstart og -afslutning bruger nu kun ét kanonisk backend-entrypoint, så validering og guardrails ikke kan drive mellem `api.js` og `server.js`",
        ],
      },
    ],
  },
  {
    version: "1.20",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Udløbne AI-, free- og andre non-user-auktionsflows kan nu blive afsluttet igen, fordi auktionsschemaet matcher backendens delte finalizer",
          "Auktionshistorikken kan nu sikkert rydde `seller_team_id` på ikke-ejede auktioner uden at live-databasen stopper finaliseringen",
        ],
      },
    ],
  },
  {
    version: "1.19",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "AI- og andre non-user-ejede auktioner krediterer nu den faktiske ejer ved afslutning i stedet for at lade provenuet følge auktionsinitiatoren",
          "Stale auktioner annulleres nu sikkert, hvis rytteren i mellemtiden ejes af en anden menneskelig manager, så der ikke bogføres forkert payout eller falsk salgs-historik",
        ],
      },
    ],
  },
  {
    version: "1.18",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Backend-notifikationer deduplikerer nu nylige identiske events, så samme besked ikke spammes igen ved cron-kørsler eller retries",
          "Board-, låne-, API- og cron-paths bruger nu samme notification-writer i stedet for separate rå inserts til `notifications`",
        ],
      },
    ],
  },
  {
    version: "1.17",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Signup og Min Profil gemmer nu holdnavn og managernavn via samme backend-route i stedet for direkte browser-writes til `teams`",
          "Managers med en tidligere halv-oprettet konto kan nu initialisere deres hold fra Min Profil, hvis team-rækken mangler",
          "Hold-bootstrap sikrer nu også, at et manglende board-profile bliver oprettet sammen med holdet",
        ],
      },
    ],
  },
  {
    version: "1.16",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Admin-import af løbsresultater og admin-godkendelse af pending resultater bruger nu samme backend execution path, så præmiepenge og standings opdateres ens",
          "Godkendelse af pending resultater markerer nu submissionen som approved på serveren i stedet for at afhænge af en efterfølgende browser-write",
          "Race-præmier bogføres nu konsekvent som gyldige `prize`-transaktioner i det fælles result-flow",
        ],
      },
    ],
  },
  {
    version: "1.15",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsen bruger nu en mere gradvis og vægtet evaluering, hvor nær-miss, stærk identitet og økonomisk kontrol stadig tæller med i den samlede vurdering",
          "Dashboardets bestyrelseskort læser nu via den samme `/api/board/status`-path som Board-siden og viser et kort outlook med kategori-scores",
          "Board-siden viser nu bestyrelsens aktuelle outlook og category breakdown direkte oven på den eksisterende UI-skabelon",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Dashboardet bruger nu korrekt `budget_modifier` i stedet for det forkerte felt `budget_multiplier` i bestyrelsesstatus-kortet",
          "Season-end board-evaluering tæller nu også U25-ryttere korrekt, fordi season-end runtime-pathen indlæser de nødvendige rytterfelter til board-checks",
        ],
      },
    ],
  },
  {
    version: "1.14",
    date: "2026-04-22",
    label: "Beta",
    changes: [
      {
        category: "Forbedringer",
        items: [
          "Bestyrelsens mål og forhandlede kompromiser genereres nu via backend, så Board-siden og season-end bruger samme kanoniske board-logik",
          "Forny kontrakt går nu gennem en rigtig API-route i stedet for direkte database-write fra browseren",
          "Board-flowet er nu dækket af en direkte backend-regressionstest for season-end, så fælles board-ændringer bliver fanget før deploy",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Board-wizarden kan ikke længere sende vilkårlige mål til serveren; backend validerer nu kun de tilladte server-genererede mål og forhandlinger",
        ],
      },
    ],
  },
  {
    version: "1.13",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Lejegebyr på rider-loans trækkes nu igen for hver dækket sæson i aftalen i stedet for kun ved første aktivering",
          "Sæsonstart bogfører nu fortsatte lejeaftaler i finance-loggen for både låner og udlejer, så saldo og historik følger samme runtime-path",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler præciserer nu, at første sæson betales ved aktivering, mens senere dækkede sæsoner opkræves automatisk ved sæsonstart",
        ],
      },
    ],
  },
  {
    version: "1.12",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Squad-limit tæller nu også aktive lejeaftaler med i den delte market-state, så lån, transfers og auktioner vurderer holdstørrelse ud fra samme runtime-sandhed",
          "Lejeforslag, låneaktivering og auktionsfinalisering stopper nu korrekt, hvis holdet allerede er fyldt op af indgående handler eller lånte ryttere",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Dashboardets holdstørrelse-advarsel tæller nu både indgående handler og aktive lejede ryttere med, så UI og backend viser samme squad-status",
          "Hjælp & Regler præciserer nu, at lejede ryttere tæller mod din divisions holdgrænse",
        ],
      },
    ],
  },
  {
    version: "1.11",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Dashboardets divisionsstilling og Hold-siden viser nu kun den aktive sæsons rangliste i stedet for at blande gamle sæsoner ind",
          "Ranglistekort og holdoversigt falder nu tilbage til 0-point-rækker for alle aktive hold, så siden ikke ser tom eller forkert ud før første live result-godkendelse",
        ],
      },
    ],
  },
  {
    version: "1.10",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Auktions-cron kan igen starte korrekt på Railway, så udløbne auktioner ikke længere crasher ved bootstrap",
          "Expired auction-finalisering er nu dækket af en direkte backend-regressionstest, så helper-regressioner bliver fanget før deploy",
        ],
      },
    ],
  },
  {
    version: "1.9",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Transfers og byttehandler bruger nu samme backend-guardrails ved endelig bekræftelse, så ejerskab, saldo og holdgrænser bliver tjekket igen før handlen lukkes",
          "Gennemførte handler rydder nu relaterede listings, transferbud og bytteforslag op for de involverede ryttere, så markedet ikke efterlader stale forhandlinger",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler præciserer nu, at transfer- og byttehandler kun kan sendes og lukkes i åbent transfervindue, og at begge parter skal bekræfte den endelige handel",
        ],
      },
    ],
  },
  {
    version: "1.8",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "AI- og frirytter-auktioner betaler ikke længere salgsprovenu til manageren, der blot startede auktionen",
          "Auktionsfinalisering bruger nu samme backend-logik i både cron og admin/API, så payout, squad-limit og transfer-window vurderes ens",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler præciserer nu, at initiatoren af en fri rytter-auktion ikke automatisk er sælgeren",
        ],
      },
    ],
  },
  {
    version: "1.7",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Finance-siden kan igen oprette manager-lån uden at kollidere med rider-låneflowet",
          "Finance-lån og rider-lån kører nu på adskilte API-routes, så lån og lejeaftaler ikke blander domæner",
        ],
      },
    ],
  },
  {
    version: "1.6",
    date: "2026-04-21",
    label: "Beta",
    changes: [
      {
        category: "Fejlrettelser",
        items: [
          "Admin-sæsonflowet er stabiliseret, så sæsoner og løb kan oprettes igen via backend-routes",
          "Godkendte løbsresultater gemmes nu med korrekt holdtilknytning, så point og præmier følger det rigtige hold",
          "Sæsonstillingen recalculeres nu fra gemte løbsresultater i stedet for kun inkrementelle writes",
          "Sæsonafslutning stopper nu, hvis der stadig ligger afventende løbsresultater i sæsonen",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler er præciseret omkring hvornår sæsonstillingen opdateres",
          "FAQ er opdateret med svar om result-godkendelse og sæsonafslutning",
        ],
      },
    ],
  },
  {
    version: "1.5",
    date: "2026-04-18",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Manager-profil — dedikeret profilside for hver manager med hold, sæsonhistorik, achievements og transferaktivitet",
          "Online status — grøn prik + 'sidst set'-tekst vises overalt hvor manager-navn optræder",
          "Managers online — tæller på Dashboard viser antal aktive managers lige nu",
          "Login-streak — 🔥 tæller viser hvor mange dage i træk du har logget ind",
          "Achievements — 45 achievements fordelt på auktioner, transfers, hold, sæson og hemmelige kategorier",
          "Hemmelige achievements — låses op overraskende undervejs og vises som 🔒 indtil opdaget",
          "Watchlist-tæller — se hvor mange managers der følger en rytter på rytterens statistikside (anonymt)",
          "Transferrygter fix — notifikation til holdejer fungerer nu korrekt når en manager besøger en rytterside",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler — ny sektion om Manager-profil, Achievements, Online status og Login-streak",
          "FAQ opdateret med 6 nye spørgsmål",
          "Patch Notes opdateret med denne version",
        ],
      },
    ],
  },
  {
    version: "1.4",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Aktivitetsfeed — offentlig realtidsstrøm af auktioner, transfers og sæsonhændelser",
          "Transferrygter — anonym notifikation når en manager kigger på din rytter (max 1/time per rytter)",
          "Deadline Day — rødt countdown-banner på Dashboard de sidste 48 timer inden transfervinduet lukker",
          "Onboarding guide — 3-trins velkomstguide til nye spillere der endnu ikke har ryttere",
          "Fejringsanimation — konfetti-modal med animation når du vinder en auktion eller en transfer accepteres",
          "Mobil forbedringer — RidersPage med horisontal scroll, bedre padding på alle sider",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler — ny sektion om Aktivitetsfeed og Transferrygter",
          "FAQ opdateret med 4 nye spørgsmål",
          "Auktioner logger automatisk til aktivitetsfeed ved start og sejr",
          "Transfers logger automatisk til aktivitetsfeed ved gennemførelse",
        ],
      },
    ],
  },
  {
    version: "1.3",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Transfersystem v2 — Football Manager-stil forhandling direkte mellem managers",
          "Send tilbud på enhver rytter fra rytterens side — ingen listing nødvendig",
          "Modtagne tilbud — accepter, afvis eller send modbud med din pris",
          "Sendte tilbud — accepter modbud, send nyt bud eller træk tilbud tilbage",
          "Ubegrænset forhandlingsrunder frem og tilbage — runde-tæller viser fremgang",
          "Tilbud er private — kun køber og sælger ser deres forhandling",
          "Besked-felt på alle tilbud og modbud",
          "Rytter skifter hold ved næste vindueåbning, forhandling kan ske hele sæsonen",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Hjælp & Regler opdateret med transfersystem v2",
          "Transfers-siden omstruktureret med faner: Marked, Modtagne tilbud, Sendte tilbud",
          "Konfetti-animation ved accepteret transfer",
        ],
      },
    ],
  },
  {
    version: "1.2",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Løbskalender — dedikeret side med alle løb, detaljer og resultater",
          "Resultatindberetning — managers uploader PCM Excel-filer til admin-godkendelse",
          "Admin godkendelse — gennemgå og godkend/afvis indberetninger",
          "Sæsonresultater — slutstillinger med op/nedrykning markeret, altid tilgængelig",
          "Pointudviklingsgraf — SVG-linjegraf for dit holds kumulative point løb for løb",
          "Delt RiderFilters komponent — samme filtrering på alle sider med ryttere",
          "Filtrer på navn, Værdi, alder, U25, U23, fri agent og hold",
          "Sortering på alle stats med retningspil",
          "Aktive filter-chips der kan fjernes enkeltvis",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Dashboard — holdstørrelse-advarsel, transfers & tilbud sektion, divisions-stilling",
          "Rangliste — mini sparkline-graf, progress-bars, op/nedrykning zoner",
          "Transfers — RiderFilters på markedet",
          "Bestyrelse — mål progress-bar, tilfredshedsniveauer forklaret",
          "Alle sideoverskrifter ensrettet til samme størrelse",
        ],
      },
    ],
  },
  {
    version: "1.1",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Fold-ud navigation — menuen organiseret i grupper: Overblik, Marked, Mit Hold, Liga",
          "Auto-åbner aktiv gruppe ved navigation",
          "Balance og division vist direkte i sidebaren",
          "Hall of Fame — rekorder, manager niveau-rangering, divisionshistorik",
          "Sæson Preview — holdstyrker og topstjerner",
          "Head-to-Head — sammenlign to managers statistik og transfers",
          "Rytter sæsonhistorik — holdskifte og resultater på rytterens side",
          "Manager XP system — optjen XP og stig i niveau (Rookie → Legende)",
          "Patch Notes side",
        ],
      },
      {
        category: "Fejlrettelser",
        items: [
          "Dashboard viser nu løb korrekt uanset status",
          "Alle sideoverskrifter ensrettet",
        ],
      },
    ],
  },
  {
    version: "1.0",
    date: "2026-04-17",
    label: "Beta",
    changes: [
      {
        category: "Nyt",
        items: [
          "Hjælp & Regler — komplet regeloversigt med søgefunktion og FAQ",
          "Talentspejder / Ønskeliste — gem ryttere privat med ★ stjerne og noter",
          "Min Aktivitet — samlet overblik over bud, auktioner og transfers",
          "Discord integration — notifikationer ved ny auktion og andre events",
          "Manuel override i admin — flyt ryttere direkte til hold",
          "Min Profil — tilknyt Discord bruger-ID",
        ],
      },
      {
        category: "Forbedringer",
        items: [
          "Auktionskort opdateres øjeblikkeligt efter bud",
          "'Andre managers' fane på auktionssiden",
          "Holdstørrelsesgræ nser per division med advarsel",
          "Balance skjult for andre managers",
          "Sæsonstart lukker transfervindue og genberegner lønninger automatisk",
        ],
      },
    ],
  },
];

export default function PatchNotesPage() {
  const [expanded, setExpanded] = useState(PATCHES[0]?.version ?? null);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">Patch Notes</h1>
        <p className="text-cz-3 text-sm">Opdateringshistorik for Cycling Zone Manager</p>
      </div>

      <div className="flex flex-col gap-3">
        {PATCHES.map((patch) => {
          const isOpen = expanded === patch.version;
          return (
            <div key={patch.version}
              className={`bg-cz-card border rounded-xl overflow-hidden transition-all
                ${isOpen ? "border-cz-accent/30" : "border-cz-border"}`}>
              <button
                onClick={() => setExpanded(isOpen ? null : patch.version)}
                className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="text-cz-1 font-bold text-sm">v{patch.version}</span>
                  <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">
                    {patch.label}
                  </span>
                  <span className="text-cz-3 text-xs">{patch.date}</span>
                </div>
                <span className={`text-cz-3 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-cz-border pt-4 space-y-4">
                  {patch.changes.map((section, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0
                          ${section.category === "Nyt" ? "bg-green-400" :
                            section.category === "Forbedringer" ? "bg-blue-400" :
                            section.category === "Fejlrettelser" ? "bg-red-400" :
                            "bg-cz-accent"}`} />
                        <span className="text-cz-2 text-xs font-semibold uppercase tracking-wider">
                          {section.category}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-1.5 ml-3.5">
                        {section.items.map((item, j) => (
                          <li key={j} className="flex items-start gap-2">
                            <div className={`w-1 h-1 rounded-full flex-shrink-0 mt-1.5
                              ${section.category === "Nyt" ? "bg-green-400" :
                                section.category === "Forbedringer" ? "bg-blue-400" :
                                section.category === "Fejlrettelser" ? "bg-red-400" :
                                "bg-cz-accent"}`} />
                            <span className="text-cz-2 text-sm leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
