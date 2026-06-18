# Bestyrelses-tilfredshed bliver læsbar — løb-for-løb historik + "hvorfor" (design)

**Dato:** 2026-06-18 · **Status:** GODKENDT (ejer, brainstorm 18/6) · **Slice:** `slice:tdf-launch`
**Afløser:** #1187 (lukket completed 18/6 — mekanikken virker; dette er UX-laget ovenpå).
**Relaterede:** #1268 (mekanik-wiring, merged 11/6) · #1265 (ren weekend-mekanik) · #955 (trend-pil + kvalitative labels) · #1030 (klikbar tilfredsheds-forklaring) · #1147 (Living World — C-sporet) · #805 (board_test_mode).

---

## 1. Kontekst (verificeret mod kode + prod 18/6)

Den løbende bestyrelses-tilfredshed (beslutning B, #1187) blev bygget + merged 11/6 (PR #1268): satisfaction bevæger sig ±5 pr. løbs-finalisering mod et target, og `budget_modifier` følger live. **Prod-data 18/6 bekræfter den virker:** 72 ægte boards spredt 25–73 (kun 3 på 50), modifier 0.9/1.0/1.1.

**Problemet er ikke mekanikken — det er læsbarheden.** Frontend har allerede en trend-pil (`getSatisfactionTrend`, #955), kvalitative labels (#955/#816), en klikbar tilfredsheds-forklaring (#1030) og en historik-tabel. Men **hele den maskine fodres af `board_plan_snapshots`, som er per-sæson og kun skrives ved sæson-slut** (`economyEngine.js` upsert, unik pr. board+sæson). Midt i sæsonen er den tom → spilleren ser et tal der ændrer sig i stilhed: ingen pil, ingen historik, intet "hvorfor".

## 2. Mål og scope

**Mål (A):** spilleren ser tilfredsheden bevæge sig **løb for løb** med retning (▲/▼), en glat synlig kurve, og *hvorfor* den flyttede sig — ved at logge og vise det mekanikken allerede gør.

**Ejer-besluttet ambitions-rækkefølge (brainstorm 18/6):**
- **A — Fundament (DETTE spec):** ugentlige/løbs-events tænder trend-pil + weekend-historik + "hvorfor"-linje + sparkline.
- **B — senere:** proaktivt los (notifikation/dashboard-kort efter weekenden).
- **C — når det passer:** narrativ/personlighed + finere kadence (Living World, #1147).

**Non-goals (A):** ingen ændring af satisfaction-mekanikken eller -tallene; ingen notifikationer (B); intet narrativ (C); ingen ny cron.

**Kritisk konsekvens:** A er **visnings-only** — tallene beregnes allerede af den eksisterende ±5-motor; vi *logger + viser* dem. Derfor er A **ikke balance-følsom** og udløser **ikke** simulér-før-ship-harness-kravet. (Hvis nogen del senere ændrer hvordan tallet beregnes, falder det ud af A's scope og ind under balance-reglen.)

## 3. Låste beslutninger

1. **Ny tabel `board_satisfaction_events`** — ikke genbrug af `board_plan_snapshots` (per-sæson unik + bruges som plan-baseline i `boardGoalContext.js`; weekend-rows ville knække begge).
2. **"Hvorfor"-dybde v1:** løbsnavn + "X/Y mål nået" + kategori-niveau-grund fra `feedback.strongest_category`/`weakest_category` (resultater/økonomi/identitet/rangering). Specifikt mål-navn ("etapesejr nået") = fast-follow.
3. **Visnings-only** (se §2).

## 4. Arkitektur

### 4.1 Datamodel — `board_satisfaction_events` (ny tabel + migration)

Ét row pr. board pr. løbs-finalisering (mekanikken kører pr. afviklet løb, ikke pr. kalender-weekend):

| Kolonne | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `board_id` | uuid fk → board_profiles | |
| `team_id` | uuid fk → teams | redundant til simple queries |
| `season_id` | uuid fk → seasons | |
| `race_id` | uuid fk → races (nullable) | null kun hvis kalder ikke har løb |
| `race_name` | text | denormaliseret til timeline (løbsnavne er stabile) |
| `race_days_completed` | int | sæsonens stand efter finaliseringen (ordering/dedup) |
| `satisfaction_before` | int | |
| `satisfaction_after` | int | |
| `satisfaction_delta` | int | = after − before (kan være 0) |
| `goals_met` | int | fra evalueringen denne finalisering |
| `goals_total` | int | |
| `reason_category` | text (nullable) | `feedback.strongest_category`/`weakest_category` afhængig af delta-retning |
| `created_at` | timestamptz default now() | |

- **Idempotens:** unique `(board_id, race_id)` → re-import af samme løb upserter samme row (mekanikken er allerede konvergerende, så delta genberegnes stabilt). Hvis `race_id` er null: fald tilbage til unique `(board_id, season_id, race_days_completed)`.
- **Adgang:** tabellen serveres **kun server-side** via backend-API'et (service-role, `routes/api.js`). Frontend læser den IKKE direkte via Supabase-klienten → **ingen anon/authenticated GRANT eller RLS-policy nødvendig.** (Hvis den nogensinde læses klient-side: tilføj policy + grants i samme migration — jf. kolonne-privilegie-reglen.)
- Migration ligger i `database/*.sql` → **PR med migration = ejer merger** (auto-applies i prod).

### 4.2 Backend — skriv eventet hvor tallet allerede beregnes

`backend/lib/boardWeekendFinalization.js` (`processBoardWeekendFinalization`) opdaterer i dag `board_profiles` pr. board (linje ~292). Tilføj: efter hver vellykket board-opdatering, skriv ét `board_satisfaction_events`-row med før/efter/delta + `goals_met`/`goals_total` (fra `update`/`evaluateBoardSeason`-resultatet) + `reason_category` + løbs-kontekst.

- **Løbs-kontekst videreføres fra kalderne:** `raceRunner.simulateRace` (relaunch-stien, kender `race.id`/`race.name`) og `pcmResultsImport` sender `{ race_id, race_name }` med ind i `processBoardWeekendFinalization` (i dag sendes kun `season` + `previousRaceDaysCompleted`).
- **`reason_category`-udledning:** `evaluateBoardSeason().feedback` har allerede `strongest_category`/`weakest_category`. Ved positiv delta → `strongest_category`; ved negativ → `weakest_category`; ved 0 → null.
- **Fejl-isolation bevares:** event-skrivning ligger inde i samme try/catch pr. board som i dag — en fejl tæller i `summary.errors`, vælter aldrig finaliseringen.
- **Mekanikken er uændret** — ingen ny formel, intet nyt clamp, ingen ny trigger.

### 4.3 API

Board-detail-endpointet i `backend/routes/api.js` (det der i dag returnerer `snapshots`/`recentSnapshots`, ~linje 7061/7688) tilføjer en `satisfactionEvents`-liste: de seneste N events (fx 10) pr. board for den aktive sæson, sorteret `created_at` faldende. Ingen ændring af de eksisterende felter.

### 4.4 Frontend — `frontend/src/pages/BoardPage.jsx`

- **Trend-pil:** `getSatisfactionTrend` fodres af seneste **event** in-season (fallback til sæson-snapshot når events mangler) → pil + delta vises hele sæsonen, ikke kun efter sæson-slut.
- **Ny "weekend for weekend"-timeline:** løbsnavn + delta (farvet ▲/▼) + "X/Y mål" pr. event (skitse godkendt 18/6).
- **Sparkline:** satisfaction over de seneste events (synlig glat kurve).
- **"Hvorfor"-linje:** løbsnavn + kategori-grund (genbrug `CATEGORY_LABELS` + eksisterende `feedback`-i18n) + "X/Y mål nået".
- **Styling:** app'ens editorial brand (Bebas, `cz-`-tokens, ægte løbsnavne) — skitse-widgeten var kun wireframe. Følger eksisterende `SatisfactionMeter`/board-mønstre. EN-først, DA-under.

## 5. Edge cases

- **`race_id` null (PCM-sti uden enkelt-løb):** brug fallback-unique `(board_id, season_id, race_days_completed)`; `race_name` = generisk ("Løbsweekend") hvis ukendt.
- **Re-import af samme løb:** upsert → opdaterer samme event-row (idempotent, jf. `recomputeSeasonRaceDays`).
- **Baseline/ufærdige planer:** ekskluderes (samme filter som mekanikken: `is_baseline=false`, `negotiation_status='completed'`).
- **Sæson ikke aktiv:** mekanikken skipper allerede (`season_not_active`) → ingen events.
- **Delta = 0:** event skrives stadig (timeline skal vise "ingen bevægelse" weekender, så kurven er sammenhængende).
- **Sæson-skift:** events knytter sig til `season_id`; ny sæson starter en frisk timeline (anker-logikken i mekanikken er uændret).

## 6. Verifikation

- Backend `node --test`: event skrives ved board-opdatering; idempotens (re-run = upsert, ingen dublet); `reason_category`-retning; fejl-isolation (event-fejl vælter ikke finaliseringen).
- Caller-tests: `raceRunner` + `pcmResultsImport` sender løbs-kontekst.
- Frontend `node --test` (`frontend/`): trend-pil fra event, timeline-rendering, tom-tilstand.
- `npx playwright test core-smoke` alle 3 projekter (visuel ændring → refresh snapshots).
- Fuld CI-gate (lint + i18n-leak + tone + warning-budget).
- Patch notes + `help.json` (en+da): "Bestyrelsen viser nu løb-for-løb hvorfor tilfredsheden flytter sig."

## 7. Filer

`database/<ny migration>.sql` · `backend/lib/boardWeekendFinalization.js` · `backend/lib/raceRunner.js` (kalder-kontekst) · `backend/lib/pcmResultsImport.js` (kalder-kontekst) · `backend/routes/api.js` (board-endpoint) · `frontend/src/pages/BoardPage.jsx` (+ evt. ny lille timeline-komponent) · `frontend/src/lib/boardUtils.js` (trend-helper hvis nødvendig) · `help.json` (en+da) · `PatchNotesPage.jsx`.

## 8. Åbne spørgsmål (afklares i plan)

- Eksakt board-endpoint BoardPage forbruger (to kandidater ~7061/7688) — plan verificerer hvilket.
- Antal events i API-svar (foreslået 10) + om sparklinen skal vise hele sæsonen eller seneste N.
- `reason_category` → vises som label direkte, eller mappes til en kortere "hvorfor"-sætning via eksisterende `feedback.headline_key`.
