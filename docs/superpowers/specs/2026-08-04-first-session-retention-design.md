# Første-sessions-retention: comeback-buen (signup → 48 timer)

**Dato:** 2026-08-04 · **Refs:** [#3310](https://github.com/NicolaiDolmer/CyclingZone/issues/3310) (grundlag + måle-korrektion), #1369 (retention-arkitektur), #2853 (e-mail-loop), #2180 (36t-varsel), #1140 (første 20 min — IKKE denne spec)
**Status:** Ejer-godkendt sektionsvist 4/8 (S1 mockup-godkendt, S2 + S3 godkendt). E-mail-flip er eksplicit IKKE en del af denne slice (ejer 4/8: "ikke klar til at tænde email loop").

## Problem + evidens (korrigeret 4/8, se #3310-kommentaren)

- Dag-1-retention målt via `users.last_seen` (server-side, IKKE consent-gated): **~64 % (juni) → ~31 % (seneste 2 uger)**. En reel halvering. De tidligere tal (19-24 %) var consent-forvrængede (32 % af nye brugere har aldrig givet analytics-consent og er usynlige i `player_events`).
- **100 % af nye rigtige hold har løbsresultater** (median 14 t efter signup) — men kun **~34 %** af nye managere har bekræftet set et resultat (`teams.my_result_seen_race_id`, gulv: kolonnen landede 18/7).
- Diagnose: ikke pacing, men **gen-engagering**. Spilleren opretter hold, logger ud, og ingen fortæller dem at deres løb blev kørt. Ingen kanal når i dag en udlogget spiller (e-mail-loopet er bygget men står på `off`; Discord-DM kræver kobling).

## Ejer-beslutninger der rammer designet (4/8)

1. **E-mail er bærende kanal i designet** — kæden bygges e-mail-KLAR, men flippet `off → dry_run → on` er ejer-gated og sker senere (#2853: tekst-godkendelse + `RESEND_API_KEY` + `EMAIL_UNSUB_SECRET`).
2. **Scope = comeback-buen** (signup → 48 t). Aktiverings-problemet i session 1 (63 % udtog hold → 38 % første bud) er #1140 og får sin egen design-session.
3. Tilgang B: kæde + deep-links + ét designet landings-øjeblik. Ingen ny side, ingen nye notifikationstyper, ingen migrationer.

## S1 · Landings-øjeblikket ("Your first race")

Dashboardet, ikke en ny side. Gate: manageren har mindst ét finaliseret resultat OG `my_result_seen_race_id` er null (samme server-flag som "Nyt"-badgen, #2593 del 2).

Når gaten er sand:

- `MyLatestResultCard` rykker **øverst** på dashboardet, over `OnboardingProgressCard` (som forbliver monteret nedenunder, visuelt nedtonet).
- Kortet renderer i **første-løbs-variant**: titel "Your first race is in the books" + "New"-pill; framing-linje med afslutningstidspunkt og "while you were away"; eksisterende indhold genbruges 1:1 (topplacering i Bebas, sekundære ryttere, recap-linje fra `buildRaceRecap`, totaler).
- **Viewets ene guldknap:** "Read the full race story" → `/races/:raceId` (etaperapporten #2356 ER historien). `TeamSelectionCtaCard`s CTA nedgraderes til sekundær så længe første-løbs-varianten er aktiv (guld-rationen, PAGE_TEMPLATES).
- Blød hale ved knappen: "Next race: {navn}, in {n} days" (ingen tvang, jf. doktrinen).
- Efter set (server-flaget sættes af eksisterende `useSeenBadge`-flow): dashboardet falder tilbage til normal rækkefølge og normal korttitel.

Mockup godkendt af ejer 4/8 (chat-widget `first_race_moment_dashboard_card`).

## S2 · Beskedkæden (48 timer, hver besked har et klikmål)

| Tid | Besked | I dag | Ændring |
|---|---|---|---|
| T0 (hold oprettet) | `welcome` in-app | Live (#3292) | Uændret |
| ~14 t (første løb finaliseret) | `race_result` in-app | Fyrer til deltagende menneske-hold | **Første-resultat-copy-variant** på SAMME type: "Your first race is in the books". Notifikationen skal ALTID bære `related_id`/`metadata.raceId`, så den eksisterende betingede race-link-sti i `NotificationsPage.jsx` (linje ~526) rammer løbet; `/resultater` forbliver kun fallback |
| 20-30 t | Dag-1-mail (`emailDay1Sweep`) | Bygget, dormant (`email_loop_enabled=off`) | Template-CTA deep-linker til holdets seneste løbsside. Ingen flip i denne slice |
| 36 t før næste løb | `selection_warning` in-app | Backend live (#3280), men UI = generisk klokke uden link | `TYPE_CONFIG`-entry i `NotificationsPage.jsx` (ikon, farve, deep-link `/races/:raceId#selection`) + "Auto-select"-knap i udtagelses-panelet oven på eksisterende `POST /races/:raceId/selection/auto` (sekundær knap, aldrig guld nr. 2). Lukker #2180's frontend-rest |

Bevidst udeladt: Discord-DM for `selection_warning` (afventer ejer-go på DM-volumen), race-digest-ændringer, e-mail-flip.

Copy-regler: EN først, DA sekundært; ingen em-dash i player-facing copy (`tone-check-em-dash.mjs`); ingen emoji.

## S3 · Måling + succeskriterier

**Kanoniske mål (ikke consent-gatede):**

1. **Dag-1-retention:** andel af ugekohorte (ekskl. seneste 2 dage) med `last_seen >= created_at + 24 h`. Ny række på admin-sprint-metrics. Event-serien beholdes som sekundær med consent-loft (68 %) angivet.
2. **Payoff:** andel nye managere med bekræftet set første resultat (`my_result_seen_race_id` sat). Baseline ~34 % (gulv).
3. Sekundær: `notification_clicked` pr. type for `race_result`/`selection_warning` (consent-gated, kun retningsgivende).

**Succeskriterier:**

- Primær: payoff-målet **≥60 %** af nye managere, målt 2 uger efter ship (kan flyttes uden e-mail).
- Sekundær: dag-1 (last_seen) mod **45-50 %** — fuld effekt forventes først EFTER e-mail-flip; rapporteres ærligt opdelt før/efter.
- Guardrail: ingen stigning i notifikations-sletninger/opt-outs.

## Implementeringsnoter

- **Filer (forventet):** `frontend/src/components/MyLatestResultCard.jsx` (variant), `frontend/src/pages/DashboardPage.jsx` (rækkefølge-gate + CTA-nedgradering), `frontend/src/pages/NotificationsPage.jsx` (`TYPE_CONFIG`: `selection_warning` + `race_result`-deep-link), `backend/lib/notificationService.js` (første-resultat-copy-variant), `backend/lib/emailTemplates.js` + `emailDay1Sweep.js` (deep-link), `frontend/src/pages/RaceDetailPage.jsx` (Auto-select-knap i selection-panelet), admin-sprint-metrics: ny read-only RPC `get_day1_retention_cohorts` (ugekohorter, `last_seen`-metoden fra #3310-kommentaren, ekskl. seneste 2 dage) + række på `/admin/sprint-metrics`.
- Ingen tabel-/skemaændringer og ingen nye notifikationstyper. Præcisering (4/8, post-godkendelse): admin-rækken kræver dog én idempotent RPC-migration (`get_day1_retention_cohorts`, `CREATE OR REPLACE FUNCTION`, read-only) — Claude applier selv post-merge under #2642-rammerne. i18n en+da for al ny copy.
- Template-compliance: alle nye elementer komponeres af eksisterende opskrifter (PAGE_TEMPLATES.md); én guld-primær pr. view håndhæves i begge berørte views (dashboard + løbsside).
- Pre-flight: `verify-local.ps1` + `npm run lint` + alle 3 playwright-projekter (UI-ændringer). Patch notes + `help.json` (en+da) ved ship — kæden er brugerrettet.
- UI-merge kræver ejer-visuel-godkendelse (memory-regel): preview/screenshots af dashboard-varianten + notifikationsrækken før merge.

## Ikke i denne spec

- E-mail-flip (`off → dry_run → on`) — ejer-gated, #2853.
- Discord-DM-udvidelser.
- Session-1-aktivering (første 20 min, bud-funnel) — #1140, egen design-session.
- Retention-arkitekturens D7/D30-loops (world feed, museum) — #1369/narrative-systems-spec.
