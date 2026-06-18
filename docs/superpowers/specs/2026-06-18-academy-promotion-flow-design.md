# Akademi-promotion-flow ved 22 — design (#932 / #1308 fast-follow)

> **Status: DESIGN — ejer-godkendt forks 2026-06-18 (AskUserQuestion-session).** Klar til writing-plans → implementering.
> Lukker den eneste reelle blindgyde i akademi-MVP'en (#1308): unge ryttere kan komme ind og trænes, men har i dag ingen vej ud. Datamodellen er allerede forberedt ("tvunget valg ved 22"); kun selve flowet mangler.
> Parent: #932 (akademi-epic) → #1136 (progression). Kilde-mekanik: `docs/superpowers/plans/2026-06-13-1308-academy-mvp.md`.

## 1. Problem & kontekst

Akademi-MVP'en (#1308, kode-færdig, flippes ON ved relaunch) genererer intake-kuld, lader holdet signe 0-8 unge (16-21) ind i et separat akademi uden for senior-30-cap'en, og træner dem dagligt med en ungdoms-multiplikator. Men **der er ingen exit:** når en akademirytter passerer akademi-alderen (>21), sker der intet — rytteren bliver siddende i akademiet for evigt.

Det er en blindgyde der underminerer hele kerne-fantasien ("udvikling fra egen avl", #1145): man udvikler talenter man aldrig kan bruge. #1308's egen scope-note og self-review markerer "selve 22-tvunget-valg-flowet" som post-launch fast-follow med datamodellen klar. Dette dokument designer det flow.

**Timing:** Ikke en dag-1-blocker (alle akademiryttere er 16-21 ved relaunch). Men det er **tidsfølsomt** — det skal stå klar før **første sæson-skift efter relaunch**, hvor de første ryttere rammer 22. Det er den eneste forbedring i træning/akademi-porteføljen med en hård deadline.

## 2. Ejer-godkendte beslutninger (2026-06-18)

1. **Default-adfærd = soft default + override.** Systemet vælger en fornuftig default hvis spilleren ikke handler inden en frist; spilleren får notifikation + override-vindue. (Fravalgt: hård graduerings-gate der blokerer sæson-start — for aggressivt i en beta med inaktive/AI-overtagne hold. Fravalgt: rent passivt — fjerner en kerne-beslutning.)
2. **"Sælg" → normalt transfermarked/auktion.** Graduaten er nu 22 = senior og listes på det almindelige marked (`auctions.is_youth=false`), så andre managers kan byde — skaber menneskelig markedsaktivitet (#932-mål). Risiko: kan stå usolgt → falder tilbage til slip.
3. **Promover-løn = genbrug standard kontrakt-logik** (market_value-baseret, som #1309 kontrakt-seed). Ingen ny balance-flade.
4. **Fuld model i første omgang** — alle tre udfald + soft-default-kæde + graduerings-UI.

## 3. De tre udfald

Ved sæson-skift bliver hver akademirytter med ny alder ≥ 22 en **graduate** der skal forlade akademiet via ét af tre udfald:

| Udfald | Effekt | Betingelser |
|---|---|---|
| **Promover → senior** | `is_academy=false`, beholder `team_id`. Ny senior-kontrakt via standard løn-formel. | Ledig senior-plads (seniorer < 30) **og** råd til lønnen. |
| **Sælg** | Listes på det normale marked (`auctions.is_youth=false`, `seller_team_id`=holdet). Provenu til holdet ved salg. | Ingen — altid muligt. |
| **Slip** | Release → free agent (`team_id=NULL`, `is_academy=false`). Intet provenu. | Ingen — altid muligt. |

Promover er den eneste der beholder rytteren; sælg/slip frigør en akademiplads.

## 4. Pending-graduation-tilstand

En graduate kan **ikke** bare få `is_academy=false` ved sæson-skift — så ville rytteren straks tælle mod senior-30-cap'en og blive en "rigtig" senior uden spillerens valg. Vi har brug for en eksplicit limbo-tilstand under override-vinduet.

**Anbefaling: en `academy_graduation`-tabel** der spejler `academy_intake`-mønsteret (join-tabel + status). Konsistent med eksisterende kode, holder `riders`-tabellen ren, og bevarer graduerings-historik (input til "akademi-output"-stats senere).

```
academy_graduation
  id            UUID PK
  team_id       UUID FK teams
  rider_id      UUID FK riders
  season_id     UUID FK seasons      -- sæsonen graduering udløses i
  status        TEXT CHECK (pending|promoted|sold|released|expired) DEFAULT 'pending'
  deadline      TIMESTAMPTZ          -- override-vinduets udløb
  created_at    TIMESTAMPTZ DEFAULT now()
  resolved_at   TIMESTAMPTZ
  UNIQUE (rider_id, season_id)
  RLS: hold-ejer kan læse eget; skrivning kun service-role
```

Mens `status='pending'`: rytteren beholder `is_academy=true` (forbliver uden for senior-cap) men ekskluderes fra daglig træning (de er ikke længere akademi-alder; `youthMultiplier(22)=1.0` gør det allerede til en no-op, men de bør markeres som "afventer beslutning" i UI). Ved resolution opdateres både graduation-row og rideren atomisk.

## 5. Default-kæde (soft default)

Ved sæson-skift: opret `academy_graduation`-rows (`pending`, `deadline` = sæson-start + N dage — `N` er en konfig-konstant, sim/ejer-justérbar) + notifikation `academy_graduation_ready`. Spilleren handler i vinduet via UI.

Handler spilleren ikke inden `deadline`, kører en **daglig sweep** (genbrug `trainingSweep.js`-mønsteret: idempotent, deterministisk, kl. 22 dansk tid) default-kæden pr. udløbet graduate:

```
1. promover  — hvis ledig senior-plads OG råd til løn
2. ellers sælg — list på markedet (auto-listing)
3. hvis usolgt ved vinduets/auktionens udløb → slip til free agent
```

Determinisme: sweep'en er idempotent (status-gated — kun `pending` med passeret `deadline` røres) og seeded hvor relevant, samme mønster som økonomi-/trænings-loopet.

## 6. Edge cases

- **Senior-truppen fuld (30):** promover er spærret. UI viser det tydeligt; spilleren må først frigøre en plads (sælg/release en senior) eller vælge sælg/slip for graduaten. Default-kæden springer promover over → sælg.
- **Ikke råd til senior-løn:** promover spærret (samme som fuld trup). Default → sælg.
- **Usolgt på markedet:** auktionen udløber uden bud → graduaten slippes til free agent (kæde-trin 3). Logges/notificeres.
- **Inaktivt/AI-overtaget hold:** soft default håndterer det automatisk — ingen hængende limbo.
- **Idempotens ved gen-kørt sæson-transition:** `UNIQUE(rider_id, season_id)` + status-gating sikrer ingen dobbelt-graduering.
- **Rytter signet som 21, bliver 22 ved første sæson-skift:** rammer flowet korrekt — bekræfter timing-deadline (§1).

## 7. Datamodel-ændringer

- **Ny tabel** `academy_graduation` (§4) + RLS + index `(team_id, status)` + column-privilege-GRANT hvis player-facing felter skal læses klient-side (jf. #1162 fail-closed).
- **Notifikationstype** `academy_graduation_ready` tilføjes `notifications_type_check` (hent nuværende def fra DB, seneste vinder — samme disciplin som #1308 Task 1).
- **Finance:** salg/promover genbruger eksisterende transaktions-typer (auktions-provenu, løn). Ingen ny finance-type forventet — verificeres ved implementering.
- Migrationen rører `database/*.sql` → **ejeren merger PR'en** (auto-applies i prod). Verificér mod disposabel Supabase-branch først.

## 8. Seams i eksisterende kode (verificeres ved eksekvering)

- **Graduate-detektion + row-oprettelse:** season-transition-laget hvor aldring sker (`backend/lib/riderProgressionEngine.js` / `seasonTransition.js` — samme idempotente sted som `skipGrowth`-guarden, riderProgressionEngine.js:163).
- **Default-sweep:** nyt modul i stil med `backend/lib/trainingSweep.js` (sweep-vindue, hold-filter, idempotens) + cron-tilkobling.
- **Sælg-listing:** genbrug auktions-oprettelse (`POST /api/auctions`-stien / `auctionFinalization.js`).
- **Promover:** flag-flip + kontrakt via samme løn-formel som kontrakt-seed (#1309); cap-check genbruger `getTeamMarketState`/`squadEnforcement` (de tæller allerede `is_academy=false`).
- **Ruter:** `POST /api/academy/graduate/:riderId` med `{ action: 'promote'|'sell'|'release' }`, `GET /api/academy/me` udvides med `graduations: [...pending]`. Flag-gated på `academy_enabled`.

## 9. UI & comms

- **Graduerings-sektion** på `AcademyPage.jsx` (+ dashboard-banner ved sæson-skift): liste over pending graduates med per-rytter promover/sælg/slip-knapper, override-frist (nedtælling), og tydelig markering når promover er spærret (fuld trup / ikke råd) med begrundelse.
- **Notifikation** `academy_graduation_ready` ved sæson-skift (verificér at den faktisk renderes player-facing — jf. den eksisterende `academy_intake_ready` der ikke har frontend-specifik visning).
- **Copy:** EN-først/DA-sekundært, ingen em-dash; `help.json` (en+da) opdateres med graduerings-mekanikken; patch notes version-bump.

## 10. Fairness & determinisme

- **Fair-premium (#1142):** promovering, salg og slip købes/udføres udelukkende med in-game-penge; premium giver aldrig bedre forventet output. Ingen betalt fordel.
- **Determinisme:** detektion + default-sweep er idempotente og deterministiske, så gen-kørsel giver samme resultat (samme kontrakt som resten af season-transition).

## 11. Test-strategi

- **Unit (`node --test`):** graduate-detektion (alder ≥ 22 ved sæson-skift), de tre resolution-handlinger, default-kæde-prioritering (promover→sælg→slip), edge cases (fuld trup, ikke råd, usolgt), idempotens (gen-kørt transition + sweep).
- **Integration:** season-transition opretter graduation-rows for de rigtige ryttere; sweep resolver udløbne korrekt.
- **Sim/scorecard:** kør en sæson-skift-dry-run mod en fiktiv akademi-population og bekræft at default-kæden fordeler graduates plausibelt (ingen masse-slip, ingen cap-brud). Genbrug `academyEconomySimulation.js`-stien.
- **Frontend (`node --test` + Playwright):** graduerings-sektion renderer, knapper kalder ruterne, spærret-promover vises korrekt. Refresh core-smoke snapshots hvis akademi-kortet ændrer sig visuelt (alle 3 projekter).
- **CI-gate-sæt** (verify-local + eslint + i18n-leak + tone-em-dash + warning-budget) før PR.

## 12. Out of scope (senere)

- Junior/U23-hold + fulde ungdomskalendere (#958).
- "Akademi-output"-stats / historik-visning (graduation-tabellen muliggør det senere).
- Facilitet-niveauer + drypvise scouting-fund (#1308 fast-follow, separate spor).

## 13. Implementerings-rækkefølge (til writing-plans)

1. Migration: `academy_graduation`-tabel + RLS + notifikationstype (ejeren merger).
2. Graduate-detektion + row-oprettelse i season-transition (+ tests).
3. Resolution-service: promover/sælg/slip (+ tests).
4. Default-sweep + cron (+ tests).
5. Ruter (`POST /api/academy/graduate/:riderId`, udvid `GET /api/academy/me`).
6. Frontend: graduerings-sektion + banner + notifikation + i18n + help + patch notes.
7. Sim-dry-run + scorecard → ejer-godkendelse af `deadline`-vindue (N dage) før relaunch-relevans.

## 14. Åbne punkter (afklares i plan eller tidligt i implementering)

- **`deadline`-vindue (N dage):** konkret værdi sættes via sim + ejer-godkendelse (ikke autonomt).
- **Provenu ved auto-salg:** fuld market_value eller en brøkdel? (Afklares når økonomi-effekten ses i sim.)
- **Salgs-mekanik:** ren auktion vs. fast-pris-listing — bekræft hvad det eksisterende marked understøtter for en sælger-initieret listing.
