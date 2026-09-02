# 30-dages pengeplan (2/9 til 2/10-2026)

**Status:** §0 målt 2/9 kl. 17:05-17:15 (Supabase prod read-only + Alunta MCP + kode på `main` a841d48). §1-§4 skrives efter ejer-beslutningerne samme aften. Ejer godkender før byg.
**Ejer af tallene:** Fable (arkitekt). Sonnet-workers udfører.
**Relaterede SSOT'er:** [`BILLING_STACK.md`](../../BILLING_STACK.md) · [`EMAIL_LOOP_GO_LIVE_RUNBOOK.md`](../../EMAIL_LOOP_GO_LIVE_RUNBOOK.md) · [`MASTERPLAN.md`](../../MASTERPLAN.md) §D · monetiserings-spec [26/6](2026-06-26-cz-pro-monetization-design.md) §6-§7.

## §0 Tal på bordet (målt 2/9 kl. 17:07-17:11 CPH)

### 0.1 Grundtal

| Tal | Målt | Prompt sagde | Definition (SQL) |
|---|---|---|---|
| Menneskehold | **235** | 232 | `teams` med `is_ai=false`, ikke test, ikke bank |
| Brugere i alt | 257 | | `users` = `auth.users` (ingen drift) |
| Aktive 7 d / 30 d | **83 / 126** | 83 / 126 | `users.last_seen` inden for vinduet, kun brugere med menneskehold |
| Aktive sidste døgn | 56 | | samme, 1 dag |
| Signups 30 d / 7 d / denne uge | **68 / 10 / 1** | 68 / 10 / 1 | `users.created_at` |
| Sovende (>30 d) | **109** | 109 | `last_seen` ældre end 30 d eller null |
| Sovende MED marketing-samtykke | **77** | | `consent_preferences->>'marketing' = true` |
| Marketing-samtykke i alt | 164 | 164 | samme flag, alle brugere |
| Sprog alle / aktive 30 d | en 186, da 71 / en 79, da 47 | "169 engelsksprogede" | `users.language` |
| Founder-pladser brugt | 3 af 50 | | `subscriptions.is_founder` |

### 0.2 Retention pr. signup-uge (admin-definitionen, `get_cohort_retention`: aktivitet = `last_seen` ∪ `player_events`)

| Uge (mandag) | Signups | D1 | D7 | D30 |
|---|---|---|---|---|
| 29/6 (lanceringsbølge) | 68 | 59 % | 47 % | 35 % |
| 6/7 | 23 | 57 % | 52 % | 35 % |
| 13/7 | 5 | 40 % | 40 % | 40 % |
| 20/7 | 32 | 28 % | 16 % | 13 % |
| 27/7 | 19 | 47 % | 32 % | 21 % |
| 3/8 | 18 | 61 % | 56 % | ikke 30 d endnu |
| 10/8 | 17 | 24 % | 18 % | |
| 17/8 | 12 | 67 % | 33 % | |
| 24/8 | 20 | 40 % | 18 % (2 af 11 berettigede) | |
| 31/8 | 1 | 1 af 1 | | |

D30 er beregnet med samme aktivitets-definition (auth.users-kohorte, egen SQL, RPC'en har ikke D30). Prompten sagde "D1 54 %, D7 39 % samlet, 18-36 % for juli-august"; ugetallene ovenfor er de rigtige at styre efter: august svinger 18-56 % på D7, og de to seneste fulde uger ligger på 18 % og 33 %.

### 0.3 Tragten (153 signups på 60 dage til 2/9)

| Trin | Antal | Andel af signups |
|---|---|---|
| Signup | 153 | 100 % |
| Har hold (starter-trup tildelt) | 140 | 92 % |
| Har mindst ét løbsresultat | 137 | 90 % |
| Kom tilbage dag 1 eller senere | 68 | 44 % |
| Kom tilbage i uge 2 (7+ dage efter signup, 143 berettigede) | 44 | 31 % |
| Har afgivet mindst ét bud (`auction_bids`) | 87 | 57 % |

**Korrektion:** "47 af 137 draftede aldrig et hold" holder ikke mod `teams.starter_squad_allocated_at`: 13 af 153 (8 %) har intet hold, og alle 140 hold har fået starter-trup. Tragtens hul er ikke draften; det er dag 1 til uge 2: 92 % får hold og løb, 44 % kommer tilbage, 31 % er der i uge 2.

**Bud og overlevelse (verificeret af uafhængig måling 2/9 17:25):** af de 44 der er der i uge 2 har **42 budt (95 %)**; af de 99 tabte har 37 budt (37 %) og 62 aldrig budt. Første bud er den handling der bedst adskiller dem der bliver fra dem der forsvinder. Første måling brugte `player_events` og undervurderede bud-andelen; `auction_bids` er SSOT.

**Køber-pulje (målt 2/9):** 27 af de 83 aktive/7d er top-3 i egen division, 14 af dem nr. 1. Det er den realistiske Pro-pulje ud fra §0.5-profilen. 32 af 235 menneskehold har Discord koblet, 23 af dem aktive/7d. Der findes ingen rabat-, kampagne- eller referral-mekanik i koden; enhver af dem er nyt byggeri.

### 0.4 Pro: MRR, abonnenter, checkout 2/9

**Alunta (17:06):** MRR **113,87 kr. ekskl. moms** (142 kr. inkl.), 3 aktive abonnementer (2 × "CZ Pro 6 Months" DKK, 1 × "CZ Pro 1 month"), ARPU 37,96, 0 churn, 6 kunder i alt hvoraf 3 uden abonnement. Planer: DKK-månedsplan 3920 øre og DKK-halvår 21200 øre (= 265 kr.) er begge **i checkout**; EUR-planerne (519 cent / 2799 cent) findes men er **ikke i checkout** og har tom `payment_providers` (DKK-planerne er låst til Stripe). MRR-breakdown: 6 mdr 74,67 + 1 md 39,20.

**De 6 rækker i `subscriptions` (kun 5 startede 2/9; den sjette er fra 25/7):**

| Hold | Accept (CPH) | Sprog | Enhed (seneste identity-events) | Plan | Udfald |
|---|---|---|---|---|---|
| 8073fb4a Équipe Lorraine Acier | 25/7 (før accept-flow) | en | Windows | 1 md | active, Founder, periode til 30/9 |
| ff613180 Bacon Fræsers | 2/9 11:03 | da | iOS + Windows | ukendt (default 6 mdr) | inactive; Alunta-kunde 6063 oprettet, intet abo |
| dd7665b4 Lidl-Leffe Pro Drinking | 2/9 12:04 | da | Windows | 6 mdr | active, Founder, periode til 1/3-2027; betalte 295, krediteret 30 (#4616) |
| bb59dd4e Wander Riders | 2/9 12:30 | en | Android + Windows | ukendt | inactive; Alunta-kunde 6065 oprettet, intet abo |
| 814b9df1 Bad At Names | 2/9 14:57 (række 09:53) | da | ingen events 3 d | ukendt | inactive; Alunta-kunde 5507 (ældre) |
| 82d343f7 LEGO-Vestas Cycling Team | 2/9 16:34 | en | Windows + Android | 6 mdr (sat af reconcilen 17:30) | active, Founder; **uden Alunta-id og periode i 55 min** (se 0.6) |

Planvalg gemmes ikke ved vilkårsaccept (`billingCheckout.js` skriver kun `terms_accepted_at`), så de tre frafaldnes plan er ukendt; `/pro` forudvælger 6 mdr. **Gennemførelse 2/9: 2 af 5 = 40 %.** Frafaldet ramte 2 danske + 1 engelsk; alle tre er aktive spillere (D1, placering 22, 3 og 9). `/pro` havde 18 unikke besøg på 7 dage (24 hits).

**Korrektion:** `/pro` ER linket fra appen: bund-menuen i `Layout.jsx` (nav.item.pro, ejer-go 20/8, #3104 etape D). #2806 punkt 1 er leveret; punkt 2 (isPro gater intet) står: `isPro()` i `backend/lib/entitlement.js` kaldes ingen steder, og frontenden viser kun ProBadge til køberen selv (`Layout.jsx:326`).

### 0.5 Hvad de 3 betalende har til fælles (mod de 3 der faldt fra)

| | 8073fb4a | dd7665b4 | 82d343f7 | Frafald ff613180 / bb59dd4e / 814b9df1 |
|---|---|---|---|---|
| Signup | 16/4 (beta-start) | 29/6 | 24/6 | 30/6 / 29/6 / 15/4 |
| Division, placering | D1, nr. 2 | D2, nr. 1 | D1, nr. 1 | D1 nr. 3 / D1 nr. 9 / D1 nr. 22 |
| Level | 12 | 21 | 50 | 12 / 5 / 4 |
| Bud i alt | 216 | 306 | 404 | 264 / 124 / 53 |
| Discord koblet | ja | ja | ja | ja / ja / ja |
| Sprog | en | da | en | da / en / da |
| Set i dag | ja | ja | ja | ja / ja / ja |

Fællesnævner: **topplacering i egen division** (nr. 1-2), 2+ måneders anciennitet og tung auktionsbrug. Betaling er et statussignal fra dem der allerede vinder. Frafaldet er ikke passive spillere; de er også aktive i dag. Det peger på checkout-friktion (pris 295 vs 265, dansk betalingsside, kort-only), ikke manglende lyst.

### 0.6 Team 82d343f7 (verificeret FØRST)

Alunta: kunde "Eli Lamhauge" (6066) har et **billable, aktivt** abonnement, næste træk 2/3-2027. Pengene er trukket. Vores række: `checkout.completed` modtaget 16:35 CPH, `status=active`, `is_founder=true`, men `alunta_customer_id`, `alunta_subscription_id`, `plan_interval` og `current_period_end` er alle null, fordi `checkout.completed` ikke bærer felterne (kendt, `BILLING_STACK.md` §5). `computeIsPro()` kræver periodeslut, så **kunden så ikke Pro i 55 minutter** (16:35 til 17:30, hvor den timelige reconcile fra boot 16:30 samlede rækken op; verificeret 18:23: ids, `semiannual` og periode til 1/3-2027 er sat).

**Rod-årsag (Railway-log 16:36 CPH):** `subscription.created` og `subscription.started` for kunden blev afvist med `teamId: null`. `aluntaWebhook.js:139` læser kun `data.external_customer_id` på topniveau; Alunta lægger den under `data.customer.external_customer_id` på subscription-events (målt REST-form i `BILLING_STACK.md` §5). Så de events der bærer id'er og periode smides væk, og Pro afhænger af reconcilens kadence. Fix-klasse: (a) læs også `data.customer.external_customer_id` + `data.interval`, (b) kald reconcilen for det ene hold straks ved `checkout.completed`, (c) `computeIsPro()` giver `active` uden `current_period_end` 24 t respit fra `last_event_at`. Postmortem skrives med fixet.

### 0.7 Cron-status (#4644, målt)

`backend/cron.js` har allerede boot-run for 13 af døgn-jobbene (debt, role-sync, retention ×2, balance-drift, ownership, double-booking, training-slot, intake-expiry, fairplay, season-count, bot-token, alunta-overdue) plus reconcilen (hver time). **Kun to døgn-jobs mangler boot-run, og de er begge målt døde:**

| Job | Sidste kørsel | Evidens |
|---|---|---|
| growth snapshot | 2/9 kl. 15:04 CPH, før det 16/8, 12/8, 8/8, 2/8 | `growth_metric_snapshots.snapshot_date`: 114 rækker, sporadisk siden 2/8 |
| global rank weekly snapshot | 12/8 | `global_rank_weekly_snapshot.captured_at` |

Så #4644 er rigtigt i konklusionen (mandagstal kan ikke tages fra snapshots) men forkert i omfang: 2 jobs, ikke 15. Fix er lille: boot-run + idempotent upsert på dato for begge, og en test der fejler hvis en 24h-registrering hverken har boot-run eller kalender-kadence.

### 0.8 Øvrige målte fakta til nøgleblokken

- **Alunta-notifikationer:** ALLE betalingshændelser er slået fra (`membership_created/started/renewed/cancelled/ended`, `invoice_paid`, `payment_failed`, `checkout_completed`, `webhook_delivery_failed`). Kun momsnummer-, radar- og integrationsfejl-digest er tændt.
- **Resend:** MCP-nøglen er ugyldig (400), så domænestatus kan ikke aflæses herfra; ejeren tjekker dashboardet (runbook §1-§2).
- **Railway MCP:** uautoriseret i denne session; CLI er logget ind, keys-only probe = `scripts/probe-railway-keys.ps1`.
- **Dinero-integration:** 3 fejl i perioden, seneste 4/8. Ikke aktuelt.
- **PostHog:** findes ikke i koden (0 forekomster i frontend/backend). #4646-events bygges som `player_events` (`checkout_started`/`checkout_completed` med plan + valuta), ikke PostHog. Analytics-samtykke er kun givet af en del af spillerne; transaktionelle events er samtykkefrie.
- **PR #4608:** draft, CONFLICTING mod main (skal rebases, formentlig `patchNotes.js` + `BILLING_STACK.md`).

### 0.9 De tre mandagstal (SSOT herfra, måles hver mandag kl. 09 via SQL + Alunta MCP)

1. **MRR + aktive abonnementer.** Alunta `get_business_overview` (MRR ekskl. moms, aktive abonnementer) krydset med:
   ```sql
   SELECT count(*) AS aktive_abo FROM subscriptions
   WHERE status IN ('active','past_due') AND alunta_subscription_id IS NOT NULL;
   ```
   Baseline 2/9: **113,87 kr. / 3**. Indtil webhook-fixet (0.6) er landet, kan SQL'en undertælle med 1 i timen efter et køb; Alunta-tallet er sandheden ved uenighed. **Fornyelse inde i vinduet:** månedskunden 8073fb4a ruller 1/10, dagen før planens deadline; #4555 periode-rul-vagten skal være live før den dato.
2. **D7 for seneste fulde kohorte.** `SELECT * FROM get_cohort_retention(4);` og aflæs `d7_pct` for den seneste uge med `d7_eligible >= 5`. Baseline 2/9: **18 % (uge 24/8), 33 % (uge 17/8)**.
3. **Gennemførte / startede checkouts, rullende 7 dage.**
   ```sql
   SELECT count(*) FILTER (WHERE terms_accepted_at > now() - interval '7 days') AS startede,
          count(*) FILTER (WHERE last_event_at > now() - interval '7 days' AND last_event_id LIKE 'checkout.completed%') AS gennemfoerte
   FROM subscriptions;
   ```
   Baseline 2/9: **2 / 5 (40 %)**. Når #4646-events lander, måles på `player_events` i stedet (fanger også dem der aldrig accepterer vilkår).

Hvem måler: Claude (Code) mandag morgen som første handling i ugens session; tallene skrives i `docs/NOW.md` Betaling-linjen og i #4646-tråden.

## §1 Hypoteser

_(udfyldes efter fase 1)_

## §2 Mål pr. 2/10

_(udfyldes efter fase 1)_

## §3 Ugemilepæle

_(udfyldes efter fase 1)_

## §4 Ud af S3-vinduet (det ubekvemme)

_(udfyldes efter fase 1)_
