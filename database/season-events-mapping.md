# Sæsonhændelser — Teknisk Kortlægning

Dokument over alle automatiske og manuelle hændelser ved de fire kritiske overgangspunkter i spillet.
**Status-kolonnen skelner mellem hvad der er implementeret og hvad der mangler.**

---

## 1. Transfervindue ÅBNER

### Trigger
Manuelt via admin (ingen automatisk cron). Tabel: `transfer_windows`, felt: `status = 'open'`.

| Hændelse | Placering | Status |
|---|---|---|
| Sæt `transfer_windows.status = 'open'` | Admin-handling i DB | ✅ Tabel eksisterer |
| Aktiver ventende transfers: ryttere med `pending_team_id` sættes til `team_id = pending_team_id`, `pending_team_id = null` | Ingen kode fundet — sker ikke automatisk | ❌ Mangler endpoint |
| Notifikation til alle managers: "Transfervinduet er åbent" | Ingen kode fundet | ❌ Mangler |
| Aktiver ventende lejeaftaler (`loan_agreements.status = 'pending'` → `active` hvis sæson passer) | Ingen kode fundet | ❌ Mangler |
| Aktiver ventende byttehandler (`swap_offers.status = 'awaiting_confirmation'`) | Ikke relevant — skifter omgående | — |

### Adfærd mens vinduet er åbent
- Auktioner kan starte og byder direkte → `riders.team_id` sættes ved auktionsluk (cron hvert 60. sek)
- Transfertilbud accepteret → `riders.team_id` sættes omgående (ingen ventekø)
- Byttehandler bekræftet → `riders.team_id` byttes omgående

---

## 2. Transfervindue LUKKER

### Trigger
Manuelt via admin. Sæt `transfer_windows.status = 'closed'`.

| Hændelse | Placering | Status |
|---|---|---|
| Sæt `transfer_windows.status = 'closed'` | Admin-handling i DB | ✅ Tabel eksisterer |
| Nye transfers sættes i kø: `riders.pending_team_id` i stedet for `team_id` | `POST /api/auctions` l. 459–464 — checker `transfer_windows.status` | ✅ Implementeret for auktioner |
| Direkte transfertilbud respekterer vinduet? | `PATCH /api/transfers/offers/:id` — checker **ikke** `transfer_windows.status` | ❌ Vinduetjek mangler på transfers |
| Byttehandler respekterer vinduet? | `PATCH /api/transfers/swaps/:id` — checker **ikke** `transfer_windows.status` | ❌ Vinduetjek mangler på swaps |
| Lejeaftaler respekterer vinduet? | `PATCH /api/loans/:id` — checker **ikke** `transfer_windows.status` | ❌ Vinduetjek mangler på loans |
| Notifikation til alle managers: "Transfervinduet er lukket" | Ingen kode fundet | ❌ Mangler |
| Igangværende auktioner: afsluttes inden lukning? | Ingen tvangsluk — kører videre til `calculated_end` | ⚠️ Ingen tvangsafslutn. |

---

## 3. SÆSONSTART

### Trigger
Ingen automatisering — admin opretter sæson manuelt og sætter `seasons.status = 'active'`.

| Hændelse | Placering | Status |
|---|---|---|
| Ny sæson oprettes: `seasons` tabel, `status = 'active'` | Admin-handling i DB | ✅ Tabel eksisterer |
| Løb oprettes og knyttes til sæsonen | `POST /api/admin/races` | ✅ Implementeret |
| `season_standings`-rækker oprettes for alle hold | Ingen kode fundet — sker ikke automatisk | ❌ Mangler endpoint |
| Sponsorindtægt udbetales (sæsonstart) | Ingen kode — udregnes kun i preview | ❌ Mangler |
| Lejegebyr for aktive lån trækkes (pr. sæson) | Kun ved accept i `PATCH /api/loans/:id` — ikke ved sæsonstart | ❌ Mangler periodisk træk |
| Lånrenter advarsler sendes | `checkDebtWarnings()` i cron (hvert 6. t.) | ✅ Implementeret |
| Sæsonnotifikation til alle managers | Ingen kode fundet | ❌ Mangler |
| Board-mål nulstilles / ny sæsons mål sættes | `board_profiles.current_goals` — ingen automatik | ❌ Mangler |

---

## 4. SÆSONAFSLUTNING

### Trigger
Manuel admin-handling. Preview-endpoint er implementeret; eksekvering mangler.

### Preview (implementeret)
`GET /api/admin/season-end-preview/:seasonId` beregner for hvert hold:

| Beregning | Output-felt |
|---|---|
| Samlede lønsudgifter | `salary_deduction` |
| Renteudgifter på aktive lån | `loan_interest` |
| Saldo efter løn + renter | `balance_after` |
| Om nødlån er nødvendigt | `needs_emergency_loan` + `emergency_loan_amount` |
| Næste sæsons sponsorindtægt (board satisfaction-justeret) | `next_season_sponsor` |
| Nuværende placering i division | `current_rank` |

Sponsor-modifier: satisfaction ≥ 80 → ×1,20 · satisfaction 50–79 → ×1,00 · satisfaction < 50 → ×0,80

### Eksekveringshændelser (INGEN er automatiseret)

| Hændelse | Placering | Status |
|---|---|---|
| Lønninger trækkes fra alle holds balance | Ingen `execute`-endpoint fundet | ❌ Mangler |
| Renter på lån tilskrives / trækkes | Ingen eksekvering — kun advarsel i cron | ❌ Mangler |
| Nødlån oprettes for hold med negativ saldo | Ingen eksekvering | ❌ Mangler |
| Sponsorindtægt indsættes på alle holds balance | Ingen eksekvering | ❌ Mangler |
| Op- og nedrykning eksekveres: `teams.division` opdateres | Frontend viser zoner (top 2 op, bund 2 ned) men intet opdaterer `teams.division` | ❌ Mangler |
| `seasons.status` sættes til `'completed'` | Ingen kode fundet | ❌ Mangler |
| Aktive lejeaftaler hvis `end_season` nået: `status = 'completed'` | Ingen cron/hook | ❌ Mangler |
| Aktive lån: restgæld kan vokse med renter | `loanEngine.js` har logik — ikke kaldt automatisk | ❌ Mangler cron-kald |
| Board satisfaction opdateres baseret på sæsonresultat | Ingen kode fundet | ❌ Mangler |
| Ny sæsons board-mål genereres | Ingen kode fundet | ❌ Mangler |
| Notifikation til alle managers: "Sæsonen er afsluttet" | Ingen kode fundet | ❌ Mangler |
| `season_standings` låses / arkiveres | Sker implicit — ny sæson oprettes | ✅ Implicit |

---

## Opsummering: Hvad mangler

### Kritiske huller (blokerer korrekt spilflow)

1. **`POST /api/admin/execute-season-end`** — den faktiske eksekvering af sæsonafslutning:
   - Træk løn
   - Træk/tilskriv renter
   - Opret nødlån
   - Indsæt sponsorindtægt
   - Opdater `teams.division` for op/nedrykkere
   - Sæt `seasons.status = 'completed'`
   - Opret ny sæsons `season_standings`-rækker
   - Afslut udløbne lejeaftaler

2. **`POST /api/admin/open-transfer-window`** — ved åbning:
   - Aktiver ventende transfers (`pending_team_id → team_id`)
   - Notifikation til alle managers

3. **`POST /api/admin/close-transfer-window`** — ved lukning:
   - Notifikation til alle managers
   - Eventuelt tvangsluk aktive auktioner efter X timer

4. **Transfervinduetjek på transfers, swaps og loans** — `PATCH /api/transfers/offers/:id`, `/swaps/:id` og `/loans/:id` bør alle respektere `transfer_windows.status` på samme måde som auktioner allerede gør.

### Sekundære mangler

5. Periodisk lejegebyr-træk ved sæsonstart for aktive lån (frem for kun ved accept)
6. Board satisfaction-opdatering ved sæsonafslutning
7. Cron-kald til `loanEngine` for renteberegning ved sæsonafslutning

---

## Cron-oversigt (eksisterende)

| Interval | Opgave | Fil |
|---|---|---|
| Hvert 60. sek | Afslut udløbne auktioner | `cron.js: finalizeExpiredAuctions()` |
| Hvert 6. time | Send gældsadvarsler til hold med negativ saldo | `cron.js: checkDebtWarnings()` |
| — | Sæsonafslutning / transfervindue | **Mangler** |
