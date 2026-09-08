# Research-grundlag: SSOT'er for forretningslaget (GROWTH, ANALYTICS, EMAIL, COMMS)

Målt og kortlagt 8/9 2026 kl. 19:20-20:10 (Europe/Copenhagen) af Fable som arkitekt, to sonnet-Explore-agenter (docs + kode) og direkte GitHub-sweep. Formål: grundlag for fire nye SSOT-dokumenter efter `docs/BILLING_STACK.md`-modellen. Alt nedenfor er læst i kode/docs eller målt mod prod (read-only). Verifikationsniveau: ✅ målt mod live-system · 📄 fra kode/dokumentation · ❓ uverificeret.

## §0 Tal på bordet (✅ målt 8/9 kl. 19:30)

| Tal | Værdi | Kilde/definition |
|---|---|---|
| Brugere i alt / menneskehold | 263 / 241 | `users`; `teams` med `is_ai=false, is_test_account=false, is_bank=false` |
| Aktive 1 d / 7 d / 30 d | 55 / 74 / 122 | `users.last_seen`, kun brugere med menneskehold |
| Signups 7 d / forrige 7 d / 30 d | 6 / 12 / 57 | `users.created_at` |
| Signups pr. uge (mandag) | 29/6: 29 · 6/7: 23 · 13/7: 5 · 20/7: 32 · 27/7: 19 · 3/8: 18 · 10/8: 17 · 17/8: 12 · 24/8: 20 · 31/8: 6 · 7/9: 1 | samme |
| D7 (rolling, `get_cohort_retention`) | 3/8: 55,6 % · 10/8: 17,6 % · 17/8: 33,3 % · 24/8: 30,0 % | RPC |
| Aktive abonnementer (SQL) / Alunta | 17 / 18 | `subscriptions.status in (active,past_due) and alunta_subscription_id not null`; Alunta `get_business_overview` |
| MRR ekskl. moms (Alunta) | 659,33 kr (ARPU 36,63; 17 nye i september, 0 churn) | Alunta |
| Checkout gennemført / startet, 7 d | 16 / 19 (84 %) | `subscriptions.last_event_id like 'checkout.completed%'` / `terms_accepted_at` |
| Abonnenter pr. sprog | da 12, en 8 (alle Founder); 0 EUR-køb siden EUR-checkout gik live 4/9 | `subscriptions` join `users.language` |
| Sovende (>30 d) m. `email_marketing=true` | 84 (af 167 med samtykke) | `consent_preferences->>'email_marketing'` |
| Spørgeskema `2026-09-features` | 32 startet, 23 gennemført af 241 (9,5 %), 12,0 min gns. | `SURVEY_SYSTEM.md` §5.1 |
| Signup-attribution, alle 152 rækker | utm_source: chatgpt.com 10, reddit 3, ingen 139 · referrer-domæne: google.com 22 (+google.at 1), reddit.com 14 + reddit-app 4, chatgpt.com 9, gmail-app 11, hattrick.org 3, ingen 79 | `signup_attribution` (123 af 137 signups sidste 60 d attribueret = 90 %) |
| Clarity, non-bot sessions 6-8/9 | Direct 293, self-referral 210, msn 8, stripe 7, google 7, alunta 1 | Clarity MCP (kun samtykkende brugere) |
| Google-indeks | 1 side (målt 21/8, #4067) | |
| PostHog | projekt findes (EU, id 259474), 0 events nogensinde | PostHog MCP `read-data-schema` |
| Vercel Web Analytics | ejer: slået til; MCP-API svarer 404 "Web Analytics not found" (samme 27/8, 30/8, 8/9) | ❓ årsag ukendt (plan/scope) |
| Ahrefs MCP | "Insufficient plan" på keywords-explorer og GSC-tools | |
| Discord MCP | forbindelse fejlede 8/9 | |

Regnestykke bag levebrødet: ARPU ~37 kr ekskl. moms; 25.000 kr/md kræver ~680 betalende; ved 5-8 % konvertering ~8.000-13.000 aktive spillere (i dag 74). Tilgang, ikke konvertering, er flaskehalsen (18 af 74 aktive betaler = 24 %).

## §1 Kode-kortlægning (📄)

### 1.1 Analytics-vendors i frontend
Alle adfærds-vendors er gated bag `hasConsent("analytics")` (`frontend/src/lib/consent.jsx`), monteret i `AnalyticsBoundary` (`frontend/src/lib/sentry.jsx:138-152`, egen error boundary så et analytics-skew aldrig vælter appen). Ingen teardown ved tilbagekaldelse; næste load respekterer valget.

| Vendor | Fil | Env (kun navne) | Kun prod | Bemærkning |
|---|---|---|---|---|
| GA4 | `lib/gaIntegration.jsx` | `VITE_GA_MEASUREMENT_ID` | ja | gtag injiceres først post-accept; Consent Mode v2 med ads denied; SPA-routes kræver Enhanced Measurement ON i GA4-admin (uverificeret) |
| Vercel Web Analytics | `lib/vercelAnalyticsIntegration.jsx` | ingen | ja | `@vercel/analytics/react` |
| Clarity | `lib/clarityIntegration.jsx` | `VITE_CLARITY_PROJECT_ID` | ja | dynamic import; `consentV2` straks efter init (postmortem 3/8); identify pr. route; tags manager_id/division/season; `entry_referrer=self` mod #3819 |
| Web Vitals | `lib/webVitalsIntegration.jsx` | ingen | ja | sender til GA4 via gtag; erstatter betalt Speed Insights (ikke installeret) |
| Sentry | `lib/sentry.jsx`, `backend/instrument.mjs` | `VITE_SENTRY_*`, `SENTRY_*` | ja | IKKE consent-gated (fejl, ikke adfærd); kun UUID |
| Traffic beacon | `lib/trafficBeacon.js` | ingen | | cookie-fri, IKKE consent-gated, kun offentlige sider, til `traffic_events`, dedupe via `visit_hash` |
| PostHog | findes ikke i kode | | | ejer-beslutning 27/8 (#4321): additivt lag; 2 af 9 leverancer klar |

Consent-kategorier: `necessary, analytics, marketing, email_marketing`; default alt nej; gemmes i `localStorage["cz_consent_v1"]` + spejles til `users.consent_preferences` (DB vinder). Banner-tekster i `frontend/public/locales/*/banners.json` (`consent.categories.*`). `email_marketing`-kategorien bruges IKKE af mail-sweeps (de bruger `users.email_prefs` opt-out).

### 1.2 Server-side events
`player_events(id, team_id, user_id, event_name, event_data, created_at)`. Skrive-veje: (1) `frontend/src/lib/logEvent.js`, consent-gated på `analytics`; (2) `backend/lib/billingCheckout.js:140-159` `checkout_started` og `backend/lib/aluntaWebhook.js:281-287` `checkout_completed`, service-role, ikke gated. `KNOWN_EVENTS` (logEvent.js:56-147) har 29 navne; derudover fyres uden at stå i listen: `academy_promote/intake_pull/demote/release`, `facility_upgrade`, `staff_hire/fire`, `training_week_plan_set`, `training_rider_week_plan_set`, `onboarding_first_bid_recommendation_shown/clicked`, `feature_rider_*_tab_opened` (5), plus de to server-events.

Andre tabeller: `growth_metric_snapshots` (dagligt cron via RPC `compute_daily_growth_snapshot`, service-role-only), `global_rank_weekly_snapshot`, `nps_responses` (klient-insert, gating i `lib/npsGating.js`: ≥3 løbsdage, 90 dages throttle), `signup_attribution` (first-touch fanges i `lib/attribution.js` til `localStorage["cz_attribution_v1"]` ved FØRSTE besøg, "never overwrite"; rækken skrives server-side i `backend/routes/api.js:8788-8798` ved holdoprettelse, `PUT /api/teams/my`, kun `result.created===true`; service-role-only; læses via `GET /api/admin/attribution`), `traffic_events` (180 d retention-cron), `identity_events` (180 d).

`users.browser_language` (#4811): kolonne fra 3/9, skrives kun af `handle_new_user()` ved nye signups (LoginPage.jsx:352-367 sender `navigator.language`); 0 rækker 5/9 er konsistent med alderen, ikke nødvendigvis en fejl. `users.last_seen`: RPC `touch_user_presence` (60 s throttle) fra `POST /api/presence` (Layout.jsx heartbeat), ikke consent-gated.

### 1.3 Metrik-definitioner i kode
- `get_cohort_retention(p_weeks)` (`database/2026-06-09-cohort-retention-rpc.sql`): aktivitet = `GREATEST(users.last_seen, max(player_events.created_at))`; kohorte = signup-uge (mandag UTC); D1/D3/D7 er rolling ("aktivitet ≥ signup + N dage"), eligibility kræver signup + N ≤ now; admin/service_role.
- `get_sprint_metrics(p_window)`: DAU/WAU/MAU = distinct user fra `last_seen` ∪ `player_events`; D7 = signup ≥7 d siden og aktivitet i sidste 7 d; `avg_session_secs` fra player_events pr. bruger-dag (≥2 events); begge RPC'er revoked for `authenticated` 6/9 (#4870), kun via `GET /api/admin/growth/sprint-metrics`.
- Admin growth (`frontend/src/pages/AdminGrowthPage.jsx`, 7 faner): routes `GET /api/admin/metrics|attribution|retention|growth/snapshots|growth/sprint-metrics|growth/customers|growth/nps` (`backend/routes/api.js:8866-9142`). NPS: promoter 9-10, passiv 7-8, detractor 0-6 (`backend/lib/growthSnapshot.js`).
- Kendt kode-drift: `PLAN_PRICE_CENTS.semiannual = 26500` i `growthSnapshot.js` + `database/2026-09-02-growth-snapshot-paying-only-4636.sql` mod faktisk pris 21200 øre (BILLING_STACK) → LTV i admin er for høj.
- Audit 7/9 (`docs/audits/launch-cohort-dropoff-2026-09-07.md`): `player_events` alene undertæller aktivitet (consent-gated); kanonisk aktivitet = union af `player_events ∪ auction_bids ∪ race_entries (manuelle) ∪ xp_log ∪ forum ∪ last_seen`. "Aktiv" i `SURVEY_SYSTEM.md` §6.2 = last_seen inden 7 d; "sovende" i `managerActivity.js`/win-back = last_seen > 30 d.

### 1.4 Mail (Resend)
Typer: `welcome`, `day1`, `race_digest` (`backend/lib/emailTemplates.js:32`). Gate-kæde i `emailService.js:sendLoopEmail`: (1) `app_config` pr. type `email_loop_welcome|day1|race_digest` = off|dry_run|on (fallback `email_loop_enabled`, fail-safe off) → (2) dedupe `email_log.dedupe_key` (dry_run blokerer aldrig, #5038) → (3) `users.email_prefs` opt-out (`emailPrefs.js`, fravær = enabled, `{"all":false}` = global afmelding) → (4) dry_run logger uden Resend → (5) on sender med `idempotencyKey=dedupeKey`. Afsender hardkodet `Cycling Zone <updates@cyclingzone.org>`. Unsubscribe `GET/POST /api/email/unsubscribe` (signeret med `EMAIL_UNSUB_SECRET`). Webhook `POST /api/email/resend-webhook` (Svix-signatur, `RESEND_WEBHOOK_SECRET`, idempotent på `email_events.provider_event_id`; hård bounce/klage → `email_prefs.all=false`). Sundhedsrapport kl. 08 (`emailHealthReport.js`: bounce >2 %, klage >0,1 % ved ≥10 sendte, døde retries, type med kandidater men 0 sendt to døgn). Retry `emailRetrySweep.js` (5 min → 8 t, max 8 forsøg; 4xx = permanent). Crons: welcome 5 min, day1 60 min, digest 60 min, retry 5 min, health 60 min. Status 8/9 18:07: welcome+day1 = on (første mail delivered), race_digest = off. GDPR-gæld: `emailRaceDigestSweep.js` tjekker aldrig `consent_preferences.email_marketing` (winback-audit 2/9 §1.2). Win-back-type findes ikke i kode. Lærdom 8/9: mail-assets skal have content-hash i URL (proxy-cache).

### 1.5 Scripts og marketing-site
- Tal-scripts: `scripts/sentry-issues.mjs` (mønster: nøgler kun via env, `infisical run --env=dev -- node ...`, `--json`), `backend/scripts/backfill-growth-snapshots.js`, `backend/scripts/snapshot-sprint-metrics.mjs` (workflow `.yml.disabled`). Intet mandagstal-script findes.
- `marketing/` (Next.js App Router): `/`, `/how-it-works`, `/pro-cycling-manager-alternative` + `/da/...`, `robots.ts`, `sitemap.ts`, egne locales/komponenter. Merget 2/9 (#4659). Ingen Vercel-projekt (kun `cycling-zone` findes), ingen rewrites i `frontend/vercel.json` (kun unsubscribe → Railway og SPA-fallback → `/app.html`). Nuværende forside på cyclingzone.org er `frontend/src/pages/LandingPage.jsx` prerenderet på engelsk af `frontend/scripts/prerender.mjs` (bevidst: CDN cacher `/` uden Accept-Language). `frontend/public/sitemap.xml` og `robots.txt` er statiske.
- Referral/invite: intet i kode (#1173 ejer-beslutning 23/7: 7 dages Pro ved aktiv ven, 1 md Pro ved betalende ven). Discord: `discord_id` indtastes manuelt, DM-prefs 6 typer (`discordDmPrefs.js`), rollesync pr. division, én bot.

## §2 Docs-kortlægning (📄)

### 2.1 SSOT-kandidater (absorberes)
- GROWTH: `docs/superpowers/specs/2026-09-02-30-dages-pengeplan.md` (§0 grundtal, §0.9 mandagstal med SQL, §1-3 satsninger; MASTERPLAN kalder den SSOT for bane 2), `docs/audits/launch-cohort-dropoff-2026-09-07.md` (auto-udfyldt vs selv-sat opstilling 29,9 % vs 57,9 % uge-2; første session binder), `docs/audits/winback-consent-audit-2026-09-02.md` (gate = `email_marketing` eksplicit true; NULL ≠ samtykke), `docs/audits/inactive-managers-2026-09-03.md` (inaktiv = last_seen > 30 d, #4307).
- ANALYTICS: `docs/seo/2026-06-21-seo-ownership.md` (ét ansvar pr. værktøj: GSC = rank/impressions, GA4 = adfærd, Ahrefs = backlinks, Morningscore = keyword/rank, Lighthouse-CI = CWV lab, web-vitals → GA4 field; SPA+GA4-faldgrube; key events snake_case), `docs/clarity/README.md` (weekly review, `player_events` som sandhed for sessionstal mod Clarity 115×-oppustning #3819, self-referral, bot-håndtering), `docs/SURVEY_SYSTEM.md` (egen SSOT, link), `.claude/learnings/2026-08-03-clarity-missing-consentv2-signal.md`.
- EMAIL: `docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md` (secrets, flag, verifikations-SQL, rollback, drift: webhook, MX, DMARC-trappe p=none → aggregator → 2-3 rene uger → quarantine → reject, Postmaster/SNDS, tærskler), winback-audit, `docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md` (godkendte tekster), `.claude/learnings/2026-09-08-email-asset-cache.md`.
- COMMS: `docs/TONE_OF_VOICE.md` (EN-first, jeg-stemme, 4 låste tone-beslutninger 21/6, fairness-løftet ordret, forbudte termer, em-dash-forbud med CI-guard `scripts/tone-check-em-dash.mjs`, patch-notes-format låst 14/8, founder-prosa-slots), `docs/SOCIAL_RULES.md` §0 (aldrig beskeder på ejerens vegne; undtagelse: automatiske systemfeeds), MASTERPLAN bane 2 pkt. 12 (MAN uge-note · ONS spørgsmål · SØN ugens øjeblik, #428), `docs/comms/2026-06-21-relaunch-comms-kit.md` (proces-skabelon med `[FOUNDER-PROSA]`-slots), #4117 (13 klar-til-post tråde i `docs/discord/2026-08-21-community-traade-en.md`), #4820 (9 forum-emner), #2236 (Reddit/Discord-tracker med rules of engagement: 90/10, aldrig bart link, UTM `?utm_source=reddit&utm_medium=community&utm_campaign=<community>`).

### 2.2 Historisk/arkiv (modsiger nutiden)
`docs/strategy/BUSINESS_MODEL.md` (4 tiers 49/89/149, 25/5), `ASSUMPTIONS_TO_VALIDATE.md`, `TDF_2026_LAUNCH_PLAN.md`, `PARKED_QUESTIONS.md`, `docs/LAUNCH_ROADMAP.md` (selv-mærket historisk), `docs/SPRINT_DASHBOARD.md` (maj-sprint), `docs/RelaunchControlTowerPlan.md` (superseded), `docs/launch/2026-06-21-go-nogo.md`, `docs/discord/2026-06-21-content-calendar.md` (åbne ejer-beslutninger, andre slot-navne), `docs/discord/2026-06-21-bot-config.md`.

### 2.3 Modstrid fundet
1. Tier-navne: `TONE_OF_VOICE.md` kalder Premium/Pro Analyst/Patron "låst" (19/5); produktet er ét tier "CZ Pro" (`2026-06-26-cz-pro-monetization-design.md`, BILLING_STACK).
2. "Aktiv": 7 d (survey) vs 30 d-dormancy (growth) vs union-af-kilder (7/9-audit) vs `player_events` som sandhed (clarity/README).
3. Mail-status: runbook + 7/9-audit siger dormant; NOW.md 8/9 siger on.
4. LTV-pris i kode 26500 vs 21200 øre.
5. MRR-tal hardcodet i pengeplan (188 kr) og NOW.md (436 kr) mod Alunta nu (659 kr): SSOT skal bære formlen, ikke tallet.

### 2.4 Format-krav
BILLING_STACK-modellen: `# <Område> — SSOT`, blockquote med formål + dato + issue + "læs FØR" + verifikationsnøgle; §-nummererede sektioner med ✅/📄/❓ pr. påstand; "Åbne punkter"-tabel + "Ryddet"-log; "Faldgruber" (kort liste); "Relateret"; drift-tjek (kørbar kommando). Registrering: linje i `docs/META_DOCS_INDEX.md` under "SSOT'er" (BILLING_STACK mangler selv der i dag) og i AGENTS.md hard rule 30-listen "Områder og deres SSOT" (~linje 91). Hard rule 30: nyt område fødes MED sit SSOT; regel-ændring opdaterer SSOT i samme PR; flag-flip opdaterer `FEATURE_REGISTRY.yml`. Intet eksplicit token-loft for SSOT'er; BILLING_STACK er ~384 linjer.

## §3 GitHub-issues i området (åbne, 8/9)
Vækst: #4321 PostHog (ejer-valg 27/8) · #3796 UTM-konvention + "hvor hørte du om os" (foreslår `docs/marketing/UTM_CONVENTION.md`) · #3797 GSC via service-konto + funnel pr. kanal · #4322 AI-assistenter som kanal · #1407 SEO-måle-lag + ejerskabs-doc · #1301 SEO-epic (loop: research → prioritér → byg → mål → iterér) · #4067 marketing-site (næste: Vercel-projekt + rewrites) · #2824 synlighed udefra · #2236 outreach-tracker · #2759 FB-annoncer + TikTok (ejer 20/7, ikke startet) · #1173 referral · #4964 launch-kohorte 28,6 % (ejer-valg) · #2760 win-back · #3453 admin/growth opdateres ikke automatisk · #1784 Vercel spend-loft · #3487 AI-crawler-andel · #1369 CRO-loop. Mail: #2853 flip (welcome+day1 on 8/9) · #1461 DMARC · #4616 nøgleblok (EUR-testkøb udestår). Comms: #428 ugerytme · #4117 tråd-bank · #4820 indholdsplan · #4235 forum vs Discord (15/9) · #4521 patch-notes-SSOT · #2758 daglig Discord-triage · #1283 founder-stemme-session · #2761 Discord-invite i indbakken. Målebrud: #4811 browser_language · #4646 checkout-frafald (events shipped i #4655).

## §4 Ejer-beslutninger 8/9 kl. 20:15-20:40 (bindende for de fire SSOT'er)

1. **Struktur:** fire SSOT'er efter BILLING_STACK-modellen: `docs/GROWTH_STACK.md`, `docs/ANALYTICS_STACK.md`, `docs/EMAIL_STACK.md`, `docs/COMMS_PLAYBOOK.md`. Runbooks (EMAIL_LOOP_GO_LIVE_RUNBOOK, clarity/README, SURVEY_SYSTEM, seo-ownership) forbliver og linkes. TONE_OF_VOICE forbliver stemme-SSOT; SOCIAL_RULES forbliver teknisk Discord/DM-SSOT.
2. **Mandagstal:** GROWTH_STACK overtager pengeplanens §0.9 som evig procedure + script `scripts/monday-numbers.mjs`. Pengeplanen forbliver 30-dages-plan og linker. MASTERPLAN peger fremover på GROWTH_STACK som bane 2-SSOT.
3. **Tier-navne:** Premium / Pro Analyst / Patron er døde. Kun "CZ Pro" og "Founder" er tilladte produkttermer. TONE_OF_VOICE rettes i samme bølge; BUSINESS_MODEL.md markeres historisk.
4. **Arkiv:** de ni gamle docs (strategy/BUSINESS_MODEL, ASSUMPTIONS_TO_VALIDATE, TDF_2026_LAUNCH_PLAN, PARKED_QUESTIONS, SPRINT_DASHBOARD, RelaunchControlTowerPlan, LAUNCH_ROADMAP, launch/2026-06-21-go-nogo, discord/2026-06-21-content-calendar) flyttes til `docs/archive/` med "historisk, afløst af X"-stub EFTER at §5-uddragene er båret over. SPRINT_DASHBOARD afregistreres i META_DOCS_INDEX (linje ~36). TDF_2026_LAUNCH_PLAN får SUPERSEDED-stub pga. 5 indgående links.
5. **Værktøjer der findes:** GA4-property (modtager data) og GSC (verificeret). Morningscore og betalt Ahrefs findes IKKE; skriv dem ud af seo-ownership-arven. Vercel Web Analytics: ejer siger tændt, API 404 (❓).
6. **GA4 beholdes** ved siden af PostHog (ejer-valg). Ét ansvar pr. værktøj: GSC = søgning, GA4 = adfærd/GSC-kobling, PostHog = produkt-funnels/retention/attribution + MCP, Clarity = replay/dead clicks (revurdér efter 4 ugers PostHog-drift, #4321), Postgres = sandhed for tragt/attribution/penge.
7. **GSC-adgang:** Google service-konto, JSON-nøgle i Infisical (navn `GSC_SERVICE_ACCOUNT_JSON`), script `scripts/gsc-report.mjs` efter sentry-issues-mønstret, ejer-guide i `docs/runbooks/`.
8. **Marketing-site:** Fable opretter Vercel-projektet (root `marketing/`) via MCP; rewrites fra cyclingzone.org som separat PR med ejer-go.
9. **Ugerytme:** én fast distributionsdag om ugen (ejer, 4-6 timer) + de tre comms-slots MAN/ONS/SØN (#428). Claude forbereder udkast og tal dagen før. Skrives ind i GROWTH_STACK og COMMS_PLAYBOOK.
10. **Betalte annoncer:** lille test (500-1.000 kr, Reddit/Facebook, UTM) i ugen op til S4 27/9; udkast + målgruppe fra Claude, ejer godkender budget. Betingelse (G4-princippet): dag-1-krogen skal holde først.
11. **Skribenter:** fire opus-workers, én pr. dokument, Fable reviewer linje for linje før ejeren ser dem.
12. **PostHog-wiring (#4321)** i samme bølge: SDK bag analytics-consent, reverse proxy, pageviews + de kendte events spejlet, GA4 beholdes.

## §5 Uddrag fra de ni arkiv-docs der SKAL bæres over (ejer-godkendt 8/9)

| # | Indhold | Kilde | Mål-SSOT |
|---|---|---|---|
| 1 | Interview-guide: opvarmning → kerne-loop (løb/træning/ungdom/transfer) → retention og deling → afslutning | `docs/launch/2026-06-21-go-nogo.md` §3b | GROWTH_STACK |
| 2 | G4-princip: marketing tændes ikke ind i en utæt spand; bug-/dag-1-porten er forudsætning, ikke vægtet signal | go-nogo §1 (G4) | GROWTH_STACK |
| 3 | Rullende D7 (`get_sprint_metrics`) ≠ kohorte-D7 (`get_cohort_retention`); rullende bruges kun som sanity-check, aldrig som gate-tal | go-nogo §2c | ANALYTICS_STACK |
| 4 | Reddit-måling: upvotes, kommentarer, signups inden 48 t efter opslag | `docs/strategy/ASSUMPTIONS_TO_VALIDATE.md` A10 | GROWTH_STACK |
| 5 | Discord-slot-skabeloner MAN weekend recap (top 5 bevægelser + manager-historie + næste løb) · ONS ét dilemma som reaction-poll koblet til patch notes · FRE Feature Friday · SØN Manager of the Week (3 spørgsmål: taktik/favorit/råd); delegér ONS-poll til moderator ved ≥30 aktive | `docs/discord/2026-06-21-content-calendar.md` | COMMS_PLAYBOOK (kanalnavne er antagelser, verificér) |
| 6 | Syntese-skabelon: tema × frekvens × citat × søjle | go-nogo §3c | GROWTH_STACK |
| 7 | r/procyclingmanager (testet, kendte regler) + r/peloton (utestet kandidat) | TDF_2026_LAUNCH_PLAN, PARKED_QUESTIONS | GROWTH_STACK |
| 8 | Metrik-kategorier for go/no-go (Discord, survey, interviews, venteliste-ratio), kun strukturen | `docs/SPRINT_DASHBOARD.md` | ANALYTICS_STACK |

## §6 Tekniske valg truffet af Fable (ingen ejer-beslutning nødvendig)

- **Aktivitets-definitioner navngives i ANALYTICS_STACK** og bruges konsekvent: `aktiv/1d`, `aktiv/7d`, `aktiv/30d` = brugere med menneskehold og aktivitet i vinduet, hvor aktivitet = `users.last_seen` ∪ `player_events` ∪ `auction_bids` ∪ manuelle `race_entries` ∪ `xp_log` ∪ forum-skrivning (7/9-audit); `sovende` = ingen aktivitet i 30 d (#4307); `survey-aktiv` = last_seen ≤ 7 d (kun SURVEY_SYSTEM). `player_events` alene er consent-gated og må ikke stå alene som aktivitetsmål.
- **Grænsen COMMS_PLAYBOOK vs SOCIAL_RULES:** COMMS = hvad, hvornår, hvor og i hvilken tone der kommunikeres (kadence, kanaler, skabeloner, kampagne-skabelon, opslags-bank); SOCIAL_RULES = teknik (kobling, rollesync, DM, notifikationer). §0-reglen citeres i COMMS med link, gentages ikke.
- **EMAIL_STACK vs runbook:** EMAIL_STACK = typer, gates, samtykke-hjemmel pr. type, drift-tærskler, kendte huller, adgang; runbook = trin-for-trin ved flip/rollback. Ingen SQL dubleres; runbook linkes.
- **LTV-prisdrift** (26500 vs 21200 øre) oprettes som separat kode-issue, rettes ikke i docs-bølgen.
- **UTM-konvention** (#3796) skrives ind i GROWTH_STACK (ikke som separat `docs/marketing/UTM_CONVENTION.md`): `utm_source` = kanal (discord/reddit/email/hattrick/chatgpt-ads osv.), `utm_medium` = community/social/email/paid, `utm_campaign` = anledning (fx `s4-launch`).
- **AI-assistenter som kanal** (#4322): kanal-gruppe "AI assistant" (chatgpt.com, perplexity.ai, claude.ai, copilot.microsoft.com, gemini.google.com) defineres i GROWTH_STACK og bruges i monday-numbers.
