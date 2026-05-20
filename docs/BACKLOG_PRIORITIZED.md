# Backlog — prioriteret view (alle 150 åbne issues)

> **Opdateret:** 2026-05-15 · **Aktivt sprint:** Monetization Validation 2026-05-18 → 2026-06-17
> **Formål:** Single source of priority for hele backlog set fra fuldtidsmål-perspektiv (~14k DKK/md gross = ~200 betalende brugere). Sprint-mekanik bor i [`SPRINT_DASHBOARD.md`](SPRINT_DASHBOARD.md); strategi i [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md). Denne fil opdateres ved store priorit-shifts (ugentligt under sprint, ellers ad-hoc).

## Sådan læser du denne fil

3 akser styrer prioriteringen:

**Værdi-tier** (V1 højest):
- **V1** Sprint-validation direkte (vinder/taber Go-beslutningen)
- **V2** Retention-bygning (beta-spillere — D7/D14 driver hele revenue-modellen)
- **V3** Mobile/UX i live beta (Discord-launch = mobile trafik)
- **V4** Brand-load / UCI-IP-migration (blokerer commercial launch)
- **V5** Monetization-infrastruktur (Stripe/ApS/MoR — kun POST Go)
- **V6** Infrastruktur/scaling (forsikring — bygger ikke MAU)
- **V7** Tech-debt der bider (bremser dev velocity)
- **V8** Nice-to-have (overvej-luk hvis ikke retention/monetization)

**Blocker-status:**
- 🟥 Blokerer sprint · 🟧 Blokerer commercial launch · 🟨 Blokerer retention · ⬜ Ikke-blokerende

**Tid-bucket:** T-1 / uge 21 / uge 22 / uge 23 / uge 24 / juni-juli / Q3 / senere / overvej-luk

---

## 🎯 Top 10 highest-leverage for fuldtidsmålet

| # | Issue | Hvorfor det er top-10 |
|---|---|---|
| 1 | [#367](https://github.com/NicolaiDolmer/CyclingZone/issues/367) Mobile UX-verify | T-1 deadline (lør 17/5). Hvis mobile er broken når 50+ Discord-folk lander mandag, bouncer hele sprintet før det starter. Single point of failure. |
| 2 | [#359](https://github.com/NicolaiDolmer/CyclingZone/issues/359) `founder_supporter_waitlist` tabel + RLS | Foundation for alle 5 waitlist-tasks. Uden denne kan sprint w3 ikke gå live. |
| 3 | [#360](https://github.com/NicolaiDolmer/CyclingZone/issues/360) GDPR privatlivspolitik + samtykke | Juridisk hard-block for første waitlist-signup. Ikke ship-kompatibelt uden. |
| 4 | [#46](https://github.com/NicolaiDolmer/CyclingZone/issues/46) Forskellig balance UI (cache-stale) | Aktiv retention-killer: managers mistror økonomien efter hver transaktion. D7-killer. |
| 5 | [#258](https://github.com/NicolaiDolmer/CyclingZone/issues/258) + [#259](https://github.com/NicolaiDolmer/CyclingZone/issues/259) + [#9](https://github.com/NicolaiDolmer/CyclingZone/issues/9) Mobile auktion-bugs | Auktioner er primary game loop. Ny Discord-trafik = mobil; broken auktion = instant bounce. |
| 6 | [#251](https://github.com/NicolaiDolmer/CyclingZone/issues/251) Ønskeliste viser 'fri agent' for købte ryttere | Trust-breach: managers handler på falsk data. Aktivt frustrerer beta-spillere. |
| 7 | [#54](https://github.com/NicolaiDolmer/CyclingZone/issues/54) S-02d board-mål arver fra gamle plan-cyklusser | Board er core retention-feature. Falsk data = managers stopper med at læse board. |
| 8 | [#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) + [#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362) Landing page + waitlist-form | Hele konvertering-pipelinen. Måler willingness-to-pay = direkte input til day-30 Go. |
| 9 | [#239](https://github.com/NicolaiDolmer/CyclingZone/issues/239) Sæson 0 → 1 transition-engine | Blokerer første sæson-skifte. Hvis spillere ikke får sæson-overgang under sprintet, mister vi den vigtigste retention-test (kommer de tilbage til sæson 2?). |
| 10 | [#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363) + [#364](https://github.com/NicolaiDolmer/CyclingZone/issues/364) + [#365](https://github.com/NicolaiDolmer/CyclingZone/issues/365) Admin dashboard + survey-CTA + sprint-metrics | Måle-instrumentet. Uden disse er day-30 Go-beslutning blind. |

---

## 📅 Tidsbucket-tabel

### T-1 → start sprint (15-17/5) — KRITISK PATH

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| [#367](https://github.com/NicolaiDolmer/CyclingZone/issues/367) | Mobile UX-verify 8 key pages | V3 | 🟥 | Playwright snapshots. Deadline lør 17/5. |

### Uge 21 (18-24/5) — Sprint w1 Foundation + retention-bombe-aftegning

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| [#359](https://github.com/NicolaiDolmer/CyclingZone/issues/359) | Supabase `founder_supporter_waitlist` tabel + RLS | V1 | 🟥 | Foundation for #361-363 |
| [#360](https://github.com/NicolaiDolmer/CyclingZone/issues/360) | GDPR privatlivspolitik + samtykke-flow | V1 | 🟥 | Block for første signup |
| [#366](https://github.com/NicolaiDolmer/CyclingZone/issues/366) | PatchNotes-entry om fair freemium-eksperiment | V1 | 🟥 | 15 min |
| [#46](https://github.com/NicolaiDolmer/CyclingZone/issues/46) | UI balance stale-state efter transaktioner | V2 | 🟨 | Cache-invalidation; samme rod som #224 |
| [#258](https://github.com/NicolaiDolmer/CyclingZone/issues/258) | Bud-historik mangler på mobile auktion | V3 | 🟨 | Discord = mobile |
| [#259](https://github.com/NicolaiDolmer/CyclingZone/issues/259) | Mobil auktion: sortering på 'Alle'-fanen | V3 | 🟨 | Same |
| [#9](https://github.com/NicolaiDolmer/CyclingZone/issues/9) | Sortering mangler på rytteroversigt (mobil) | V3 | 🟨 | Same |
| [#225](https://github.com/NicolaiDolmer/CyclingZone/issues/225) | Guide-banner kan ikke lukkes på /riders | V3 | 🟨 | Onboarding-friction |
| [#251](https://github.com/NicolaiDolmer/CyclingZone/issues/251) | Ønskeliste: 'fri agent' for købte ryttere | V2 | 🟨 | Trust-breach |
| [#54](https://github.com/NicolaiDolmer/CyclingZone/issues/54) | S-02d board-mål arver fra gamle planer | V2 | 🟨 | Board = core retention |
| [#15](https://github.com/NicolaiDolmer/CyclingZone/issues/15) | Holdside mangler total-løn visning | V2 | 🟨 | Økonomi-core; mgrs kan ikke budgettere |
| [#224](https://github.com/NicolaiDolmer/CyclingZone/issues/224) | Manager-navn opdateres ikke i dashboard | V2 | ⬜ | Same cache-rod som #46 |
| [#300](https://github.com/NicolaiDolmer/CyclingZone/issues/300) | Workflow crash: Dansk apostrof i comment-script | V7 | ⬜ | One-liner, blokkerer CI-comment |
| [#367](https://github.com/NicolaiDolmer/CyclingZone/issues/367) | (Hvis ikke afsluttet T-1) | V3 | 🟥 | Roll-over |

### Uge 22 (25-31/5) — Sprint w2 Waitlist-features + survey live

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| [#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) | Landing page for Founder Supporter waitlist | V1 | 🟥 | Manus-copy klar |
| [#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362) | Waitlist-form + UTM source-tracking | V1 | 🟥 | Skriver til #359 |
| [#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363) | Admin dashboard for waitlist intent-scoring | V1 | 🟥 | Decision-input |
| [#364](https://github.com/NicolaiDolmer/CyclingZone/issues/364) | Survey-CTA-banner i app | V1 | 🟥 | Survey-svar = decision |
| [#365](https://github.com/NicolaiDolmer/CyclingZone/issues/365) | Sprint-metrics dashboard i app | V1 | 🟥 | Måle-instrument |
| [#239](https://github.com/NicolaiDolmer/CyclingZone/issues/239) | Sæson 0 → 1 transition-engine | V2 | 🟨 | Første sæson-skifte = retention-test |
| [#45](https://github.com/NicolaiDolmer/CyclingZone/issues/45) | Mange små lån kan overstige gældsloftet (TOCTOU) | V2 | 🟨 | Aktiv exploit |
| [#31](https://github.com/NicolaiDolmer/CyclingZone/issues/31) | Gældsforhandling gør intet ved klik | V2 | 🟨 | Broken feature |
| [#47](https://github.com/NicolaiDolmer/CyclingZone/issues/47) | Søgning kun fornavn (ikke for+efter) | V2 | 🟨 | Daily friction |
| [#21](https://github.com/NicolaiDolmer/CyclingZone/issues/21) | Kommende løb viser forkerte løb | V2 | 🟨 | Trust-breach |
| [#30](https://github.com/NicolaiDolmer/CyclingZone/issues/30) | Bestyrelsen: minus-points for bedre placering | V2 | 🟨 | Board-logic bug |
| [#55](https://github.com/NicolaiDolmer/CyclingZone/issues/55) | BoardPage tæller ikke nye S-02d måltyper | V2 | 🟨 | Board-data |
| [#56](https://github.com/NicolaiDolmer/CyclingZone/issues/56) | Monument-podium tæller ikke Klassiker-importer | V2 | 🟨 | Goal-tracking |
| [#57](https://github.com/NicolaiDolmer/CyclingZone/issues/57) | 1yr youth plan U25-delta uden baseline | V2 | ⬜ | Goal-edge-case |
| [#24](https://github.com/NicolaiDolmer/CyclingZone/issues/24) | Adskil præmiepenge + UCI-points i visning | V2 | ⬜ | Data-clarity |
| [#252](https://github.com/NicolaiDolmer/CyclingZone/issues/252) | Joao Almeida 2x i rytter-data | V7 | ⬜ | Quick data-fix |
| [#161](https://github.com/NicolaiDolmer/CyclingZone/issues/161) | 'Undefined' holdnavn i transferhistorik | V7 | ⬜ | UI-glitch |
| [#34](https://github.com/NicolaiDolmer/CyclingZone/issues/34) | Burde ikke kunne forhandles (screenshot) | V7 | ⬜ | Triage |
| [#41](https://github.com/NicolaiDolmer/CyclingZone/issues/41) | Fejl ved auktioner (screenshot) | V3 | ⬜ | Triage |
| [#38](https://github.com/NicolaiDolmer/CyclingZone/issues/38) | Fejlvisning under auktioner (screenshot) | V3 | ⬜ | Triage |
| [#357](https://github.com/NicolaiDolmer/CyclingZone/issues/357) | AI Ops: Phase 1-3 verificér cold-start <8K | V7 | ⬜ | Aktiv slice; parallel-baggrund |
| [#348](https://github.com/NicolaiDolmer/CyclingZone/issues/348) | Sentry secrets + verificér events | V6 | ⬜ | Observability under launch |
| [#99](https://github.com/NicolaiDolmer/CyclingZone/issues/99) | Tooltip rytter-værdi (formel-forklaring) | V2 | ⬜ | UX-clarity |
| [#251](https://github.com/NicolaiDolmer/CyclingZone/issues/251) | (rollover hvis ikke u21) | V2 | 🟨 | |

### Uge 23 (1-7/6) — Sprint w3 Waitlist GÅR LIVE + advokat

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| Landing page deployes 1/6 | — | V1 | 🟥 | Sprint-task, ikke separat issue |
| Advokat-konsultation | — | V1 | 🟧 | Founder Track, UCI/IP |
| Race-name licens-pris-research | — | V1 | 🟧 | Founder Track |
| [#312](https://github.com/NicolaiDolmer/CyclingZone/issues/312) | Indbakke: aggregér gentagne overbud-notifs | V2 | ⬜ | Inbox-friction |
| [#101](https://github.com/NicolaiDolmer/CyclingZone/issues/101) | Vis bestyrelsens konkrete effekter i UI | V2 | ⬜ | Board-transparens |
| [#25](https://github.com/NicolaiDolmer/CyclingZone/issues/25) | Transferhistorik per-team (hold-basis) | V2 | ⬜ | Retention/scouting |
| [#262](https://github.com/NicolaiDolmer/CyclingZone/issues/262) | Auktionshistorik ikke resat efter beta-fase | V7 | ⬜ | Data-cleanup |
| [#176](https://github.com/NicolaiDolmer/CyclingZone/issues/176) | Indbakke 'ulæste'-counter ikke invalideret | V7 | ⬜ | UI cache |
| [#223](https://github.com/NicolaiDolmer/CyclingZone/issues/223) | Hall of Fame viser oprettelses-username | V7 | ⬜ | Display-bug |
| [#229](https://github.com/NicolaiDolmer/CyclingZone/issues/229) | Side starter i bunden ved page-skift | V7 | ⬜ | Scroll-bug |
| [#42](https://github.com/NicolaiDolmer/CyclingZone/issues/42) | U23-søgning viser U25-kategori | V7 | ⬜ | Category-mismatch |
| [#164](https://github.com/NicolaiDolmer/CyclingZone/issues/164) | Evne-filter slider hopper ved drag | V7 | ⬜ | UI-jank |
| [#162](https://github.com/NicolaiDolmer/CyclingZone/issues/162) | Alder-felt mangler på rytterside (regression) | V7 | ⬜ | Display-regression |
| [#231](https://github.com/NicolaiDolmer/CyclingZone/issues/231) | Løn-kørsel viser '-' for nogle ryttere | V7 | ⬜ | Edge-case display |
| [#248](https://github.com/NicolaiDolmer/CyclingZone/issues/248) | Evne-sortering virker ikke i 'Min situation' | V7 | ⬜ | Sort-bug |
| [#249](https://github.com/NicolaiDolmer/CyclingZone/issues/249) | Bud-historik: sekundær sortering beløb desc | V8 | ⬜ | Minor sort |
| [#346](https://github.com/NicolaiDolmer/CyclingZone/issues/346) | Quality Inbox: 0 fail, 10 warn | V7 | ⬜ | CI-hygiene |
| [#109](https://github.com/NicolaiDolmer/CyclingZone/issues/109) | Ikke alle U25-ryttere kategoriseret | V7 | ⬜ | Data-fix |
| [#37](https://github.com/NicolaiDolmer/CyclingZone/issues/37) | Fejl i løn (skærmbillede) | V7 | ⬜ | Display-fejl efter v2.25 |
| [#36](https://github.com/NicolaiDolmer/CyclingZone/issues/36) | Ryttere uden potentiale (skærmbillede) | V7 | ⬜ | Data-edge case |
| [#347](https://github.com/NicolaiDolmer/CyclingZone/issues/347) | Deploy-verify robust for script/doc-commits | V7 | ⬜ | CI-robustness |
| [#349](https://github.com/NicolaiDolmer/CyclingZone/issues/349) | Opgradér gitleaks før Node 20 deprecation | V7 | ⬜ | Tech-debt |
| [#353](https://github.com/NicolaiDolmer/CyclingZone/issues/353) | Vercel Speed Insights + vitals events | V6 | ⬜ | Performance-monitoring |
| [#293](https://github.com/NicolaiDolmer/CyclingZone/issues/293) | CodeQL: rate-limit + Discord-script sanitization | V7 | ⬜ | Security-tech-debt |

### Uge 24 (8-17/6) — Sprint w4 Decision

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| Day-30 Go/No-Go decision memo | — | V1 | 🟥 | Sprint-task |
| Final 2-3 interviews | — | V1 | 🟥 | Sprint-task |
| Final community poll | — | V1 | 🟥 | Sprint-task |
| (Buffer til at lukke uge 21-23-rollovers) | — | — | — | Forventet 5-10 rollovers |

### Juni-juli (post-sprint, **🔒 BETINGET Go-beslutning**)

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| Stripe vs Paddle vs Lemon Squeezy-implementation | — | V5 | 🟧 | Founder Track |
| ApS-stiftelse + revisor-tjek | — | V5 | 🟧 | Founder Track |
| [#327](https://github.com/NicolaiDolmer/CyclingZone/issues/327) | Secret management væk fra OneDrive-hardlinks | V4 | 🟧 | Pre-commercial |
| Team/rider migration til fiktivt univers | — | V4 | 🟧 | UCI/IP — komplet inden day-30 |
| [#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) | Slice 09: Race-import alle UCI-løb | V2 | ⬜ | Afhænger af #239 |
| [#27](https://github.com/NicolaiDolmer/CyclingZone/issues/27) | Custom gemte scoutingfiltre | V5 | ⬜ | Supporter-tier feature |
| [#26](https://github.com/NicolaiDolmer/CyclingZone/issues/26) | Transfer war-room | V5 | ⬜ | Pro Analyst-tier feature |
| [#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334) | Redis cache for hot endpoints | V6 | ⬜ | Scaling pre-launch |
| [#333](https://github.com/NicolaiDolmer/CyclingZone/issues/333) | Supabase Realtime WebSockets primær | V6 | ⬜ | Scaling |
| [#330](https://github.com/NicolaiDolmer/CyclingZone/issues/330) | Cron ud af webserver + job-locking | V6 | ⬜ | Scaling |
| [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332) | Fase 4 incident playbook + backups | V6 | ⬜ | Ops-maturity |
| [#339](https://github.com/NicolaiDolmer/CyclingZone/issues/339) | Infisical secret-store Phase 1 | V6 | ⬜ | Pre-Stripe |
| [#62](https://github.com/NicolaiDolmer/CyclingZone/issues/62) | Dashboard: Næste bedste handling-panel | V2 | ⬜ | Retention-feature |
| [#324](https://github.com/NicolaiDolmer/CyclingZone/issues/324) | AI baseline reel og verificerbar | V6 | ⬜ | AI/Ops |
| [#306](https://github.com/NicolaiDolmer/CyclingZone/issues/306) | Instrumenter resterende ~10 events fra #137 | V7 | ⬜ | Analytics-completion |
| [#75](https://github.com/NicolaiDolmer/CyclingZone/issues/75) | Stop hook: close-out reminder | V7 | ⬜ | AI/automation |
| [#76](https://github.com/NicolaiDolmer/CyclingZone/issues/76) | PreToolUse: håndhæv NOW.md ≤30 linjer | V7 | ⬜ | AI/automation |
| [#77](https://github.com/NicolaiDolmer/CyclingZone/issues/77) | PreToolUse: bloker writes til arkiverede docs | V7 | ⬜ | AI/automation |
| [#78](https://github.com/NicolaiDolmer/CyclingZone/issues/78) | Scheduled memory-konsolidering | V7 | ⬜ | AI/automation |
| [#73](https://github.com/NicolaiDolmer/CyclingZone/issues/73) | PreToolUse lints på gh issue commands | V7 | ⬜ | AI/automation |
| [#88](https://github.com/NicolaiDolmer/CyclingZone/issues/88) | Branch protection + auto-merge | V6 | ⬜ | DX |
| [#154](https://github.com/NicolaiDolmer/CyclingZone/issues/154) | PatchNotes versionskollision check | V7 | ⬜ | DX |
| [#337](https://github.com/NicolaiDolmer/CyclingZone/issues/337) | Roter lokal `.env` til `sb_secret_*` | V7 | ⬜ | Lokal dev-tooling |
| [#330](https://github.com/NicolaiDolmer/CyclingZone/issues/330) | Cron-platform multi-instance | V6 | ⬜ | Scaling |
| [#331](https://github.com/NicolaiDolmer/CyclingZone/issues/331) | Loadtest + DB performance baseline | V6 | ⬜ | Pre-launch |
| [#92](https://github.com/NicolaiDolmer/CyclingZone/issues/92) | Rytter-arketype som first-class citizen | V8 | ⬜ | Refactor |
| [#102](https://github.com/NicolaiDolmer/CyclingZone/issues/102) | Visualisér bestyrelsens 9 personality-types | V2 | ⬜ | Board-feature |
| [#134](https://github.com/NicolaiDolmer/CyclingZone/issues/134) | Tailwind v3 → v4 migration | V7 | ⬜ | Tech-debt |

### Q3 (jul-sep) — post-launch retention + scaling

| # | Titel | V | 🚦 | Note |
|---|---|---|---|---|
| [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323) | Verdensklasse AI/Ops mod 5-10K brugere | V6 | ⬜ | Long-term scaling |
| [#135](https://github.com/NicolaiDolmer/CyclingZone/issues/135) | Player-behavior-instrumentation → AI-prio | V2 | ⬜ | Post-validation analytics |
| [#91](https://github.com/NicolaiDolmer/CyclingZone/issues/91) | Race Day Live-ticker | V8 | ⬜ | Engagement-feature |
| [#136](https://github.com/NicolaiDolmer/CyclingZone/issues/136) | Ryttere som karakterer (narrativ-lag) | V8 | ⬜ | Engagement |
| [#94](https://github.com/NicolaiDolmer/CyclingZone/issues/94) | Manager cross-season statistik | V8 | ⬜ | Retention |
| [#266](https://github.com/NicolaiDolmer/CyclingZone/issues/266) | Mester-trøjer | V8 | ⬜ | Cosmetic |
| [#264](https://github.com/NicolaiDolmer/CyclingZone/issues/264) | Discord dedikeret sæson-events-kanal | V8 | ⬜ | Community |
| [#352](https://github.com/NicolaiDolmer/CyclingZone/issues/352) | SEO: migrér GSC til eget domæne | V8 | ⬜ | Growth |
| [#288](https://github.com/NicolaiDolmer/CyclingZone/issues/288) | E2E test foundation (Playwright) | V7 | ⬜ | Velocity-investering |
| [#228](https://github.com/NicolaiDolmer/CyclingZone/issues/228) | Auktion: prioritér kolonner + ønskeliste + Mine-fane | V3 | ⬜ | UX-overhaul |
| [#230](https://github.com/NicolaiDolmer/CyclingZone/issues/230) | Auto-cancel proxy når overbudt over loft | V3 | ⬜ | Proxy UX |

### Senere / overvej-luk

| # | Titel | V | Note |
|---|---|---|---|
| [#308](https://github.com/NicolaiDolmer/CyclingZone/issues/308) | Flyt Indstillinger ned | V8 | UX cosmetic |
| [#310](https://github.com/NicolaiDolmer/CyclingZone/issues/310) | Live Bud-feed: fjern 30-sek begrænsning | V8 | Niche |
| [#260](https://github.com/NicolaiDolmer/CyclingZone/issues/260) | Holdnavn altid clickable | V8 | Relaterer #315 (done) |
| [#255](https://github.com/NicolaiDolmer/CyclingZone/issues/255) | Vis manager-navn under holdnavn | V8 | UI tweak |
| [#256](https://github.com/NicolaiDolmer/CyclingZone/issues/256) | Auktionshistorik: antal bud + hold | V8 | Display |
| [#226](https://github.com/NicolaiDolmer/CyclingZone/issues/226) | Auktion PC: sticky rytter-kolonne | V8 | PC-only |
| [#227](https://github.com/NicolaiDolmer/CyclingZone/issues/227) | Auktion filter: nuværende bud ≤ X | V8 | Filter-overload |
| [#261](https://github.com/NicolaiDolmer/CyclingZone/issues/261) | Manuel tal-input på rytter-filtre | V8 | UX nice |
| [#253](https://github.com/NicolaiDolmer/CyclingZone/issues/253) | Patch notes overhaul: kategorier+søg | V8 | Big refactor |
| [#168](https://github.com/NicolaiDolmer/CyclingZone/issues/168) | Vis løbsudgave/årgang i Kalenderen | V8 | Display |
| [#167](https://github.com/NicolaiDolmer/CyclingZone/issues/167) | Bestyrelsesmål-rækkefølge 1/3/5yr | V8 | UX ordering |
| [#165](https://github.com/NicolaiDolmer/CyclingZone/issues/165) | Bestyrelse overall tilfredshed progress bar | V8 | Display |
| [#64](https://github.com/NicolaiDolmer/CyclingZone/issues/64) | Notifikationsbadge 9+ | V8 | Display |
| [#61](https://github.com/NicolaiDolmer/CyclingZone/issues/61) | Global søgning / command palette | V8 | Big feature |
| [#60](https://github.com/NicolaiDolmer/CyclingZone/issues/60) | Mit Hold/Økonomi-overlap tydeliggør | V7 | Refactor |
| [#59](https://github.com/NicolaiDolmer/CyclingZone/issues/59) | Auktionshistorik som fane | V8 | UX |
| [#58](https://github.com/NicolaiDolmer/CyclingZone/issues/58) | Transferside: gruppér faner | V7 | Refactor |
| [#50](https://github.com/NicolaiDolmer/CyclingZone/issues/50) | Mere inddeling i Admin UI | V8 | Admin |
| [#49](https://github.com/NicolaiDolmer/CyclingZone/issues/49) | Ryttertyper-feature | V8 | Vague |
| [#43](https://github.com/NicolaiDolmer/CyclingZone/issues/43) | Patch Notes-side ikke på dansk | V8 | i18n |
| [#103](https://github.com/NicolaiDolmer/CyclingZone/issues/103) | Multi-year mål tidlig opfyldelse | V8 | Design |
| [#198](https://github.com/NicolaiDolmer/CyclingZone/issues/198) | Auktioner code-cleanup magic numbers | V7 | Refactor |
| [#184](https://github.com/NicolaiDolmer/CyclingZone/issues/184) | Test-coverage proxy-bidding | V7 | Test debt |
| [#74](https://github.com/NicolaiDolmer/CyclingZone/issues/74) | Cross-PC migration close-out | V8 | Post-soak |
| [#87](https://github.com/NicolaiDolmer/CyclingZone/issues/87) | GitHub Projects v2 board | V7 | DX |
| [#39](https://github.com/NicolaiDolmer/CyclingZone/issues/39) | Vægt/højde fejl skærmbillede | V7 | Triage-først |
| [#32](https://github.com/NicolaiDolmer/CyclingZone/issues/32) | Fejl i speaks (rytter-evne) | V7 | Data |
| [#33](https://github.com/NicolaiDolmer/CyclingZone/issues/33) | Tillad salg under division-minimum | V8 | Design-spørgsmål |
| [#19](https://github.com/NicolaiDolmer/CyclingZone/issues/19) | Bud i lukket transfervindue | V8 | Design |
| [#17](https://github.com/NicolaiDolmer/CyclingZone/issues/17) | Lån: renter med det samme? | V8 | Design |
| [#12](https://github.com/NicolaiDolmer/CyclingZone/issues/12) | Farver rytteroversigt skal rettes | V8 | UI tweak |
| [#241](https://github.com/NicolaiDolmer/CyclingZone/issues/241) | Slice 07h Fase B finansrapport iteration | V7 | Post-launch |
| [#265](https://github.com/NicolaiDolmer/CyclingZone/issues/265) | 'Fjern autobud'-kryds tydeligere | V3 | UX-tweak |
| [#263](https://github.com/NicolaiDolmer/CyclingZone/issues/263) | 'Talentspejler' forældet/ikke udviklet | V8 | Investigation |
| [#268](https://github.com/NicolaiDolmer/CyclingZone/issues/268) | Backend getTeamMarketState bug (#250-pattern) | V7 | Refactor |
| [#271](https://github.com/NicolaiDolmer/CyclingZone/issues/271) | UX/IA brainstorm dashboard+menu | V2 | Splitting needed |
| [#286](https://github.com/NicolaiDolmer/CyclingZone/issues/286) | (Ikke i inventory — check) | — | — |
| [#289](https://github.com/NicolaiDolmer/CyclingZone/issues/289) | Quality-hardening epic meta | V7 | Meta — luk hvis sub-issues drives |

---

## 🚨 Konflikter med aktivt sprint (skal pauses)

**Aktiv slice (AI/Ops token-reduktion) — pause-anbefaling under sprint w1-w3:**

- [#355](https://github.com/NicolaiDolmer/CyclingZone/issues/355) Disconnect 7 ubrugte MCP-connectors — **kør som 20-min baggrund-task**, ikke fokus-arbejde
- [#356](https://github.com/NicolaiDolmer/CyclingZone/issues/356) Disable ubrugte plugin-skills — **samme**
- [#357](https://github.com/NicolaiDolmer/CyclingZone/issues/357) Verificér Phase 1-3 cold-start <8K — **én session uge 22 max**

**AI/automation epic (epic:ai-workflow) — pause til juni:**

- #75, #76, #77, #78, #73 (hook-automation), #154 (PatchNotes collision)
- Begrundelse: Sparer 0 retention. Bygger udelukkende dev-velocity. Sprint-tab > velocity-gevinst.

**Quality-hardening epic der ikke er bug-fixes:**

- [#289](https://github.com/NicolaiDolmer/CyclingZone/issues/289) Meta-tracking — kan opdateres ved sprint-slut, ikke aktiv driving
- [#288](https://github.com/NicolaiDolmer/CyclingZone/issues/288) E2E test foundation — Q3
- [#306](https://github.com/NicolaiDolmer/CyclingZone/issues/306) Instrumenter resterende events — juni
- [#293](https://github.com/NicolaiDolmer/CyclingZone/issues/293) CodeQL warnings — kan tages som filler-task uge 23

**Slice 09 + slice 08:**

- [#239](https://github.com/NicolaiDolmer/CyclingZone/issues/239) Sæson-transition er CRITICAL for retention-test → **må fastholdes uge 22**
- [#242](https://github.com/NicolaiDolmer/CyclingZone/issues/242) Race-import → kan vente til juni-juli; ikke retention-driver i sprint-periode

---

## 🗑️ Luk-kandidater (kræver bruger-veto før luk)

Per memory-regel `feedback_github_close_protocol`: bruger lukker selv. Disse markeres til veto-runde:

### Verificeret done (PR/slice komplet) _(historisk snapshot — claude:done label deprecated 2026-05-18)_

| # | Titel | Begrundelse for luk |
|---|---|---|
| [#315](https://github.com/NicolaiDolmer/CyclingZone/issues/315) | TeamNameLink-scaffold for #260 | PR #320 merged 2026-05-12, test-verified |
| [#82](https://github.com/NicolaiDolmer/CyclingZone/issues/82) | Slice 07d finance audit-log foundation | Slice 07 komplet pr. 2026-05-09 |
| [#86](https://github.com/NicolaiDolmer/CyclingZone/issues/86) | Slice 07h sæson finansrapport | Slice 07 komplet |
| [#137](https://github.com/NicolaiDolmer/CyclingZone/issues/137) | Event-logging baseline | Clarity er live; remaining work splittet til #306 |
| [#235](https://github.com/NicolaiDolmer/CyclingZone/issues/235) | Slice 07d Fase B audit-RPC | Slice komplet |
| [#52](https://github.com/NicolaiDolmer/CyclingZone/issues/52) | Microsoft Clarity samarbejde | Clarity er live; manuel workflow duelig |
| [#44](https://github.com/NicolaiDolmer/CyclingZone/issues/44) | Balance lavere end aktuelle bud | claude:done; bekræft #46/#251-relation før luk |
| [#284](https://github.com/NicolaiDolmer/CyclingZone/issues/284) | Board-tabel 0 rows i prod | Verificeret per FEATURE_STATUS: milestone-gated, ikke bug |

### Meta-issues der bør lukkes (superseded eller intent captured)

| # | Titel | Begrundelse |
|---|---|---|
| [#178](https://github.com/NicolaiDolmer/CyclingZone/issues/178) | Polish-sprint frem til open beta | Open beta startet 2026-05-08; superseded af sprint-validation |
| [#79](https://github.com/NicolaiDolmer/CyclingZone/issues/79) | Slice 07 Economy Overhaul parent | Alle 8 sub-slices 07a-h komplet (per memory `project_slice07_complete`) |

### Bør vente på bruger-input (luk + re-open når input kommer)

| # | Titel | Venter på |
|---|---|---|
| [#313](https://github.com/NicolaiDolmer/CyclingZone/issues/313) | Rytter-rygter feature | bobby's egen "binde knuder først" — Q3+ |
| [#311](https://github.com/NicolaiDolmer/CyclingZone/issues/311) | 'På Hold'-knap | Design-uklarhed vs ønskeliste |
| [#309](https://github.com/NicolaiDolmer/CyclingZone/issues/309) | Weekend-transfervinduer kl 10 | .sredna's timing-design |
| [#314](https://github.com/NicolaiDolmer/CyclingZone/issues/314) | Bestyrelse: multi-year tidlig opfyldelse | cybersimon's forslag |
| [#28](https://github.com/NicolaiDolmer/CyclingZone/issues/28) | Reset til Sæson 0 checklist | Beta-reset suite leveret — checklist redundant? Verificér |

### Triage-først kandidater (kan måske lukkes efter en hurtig check)

| # | Titel | Note |
|---|---|---|
| [#74](https://github.com/NicolaiDolmer/CyclingZone/issues/74) | Cross-PC migration close-out efter soak | Hvor lang soak-periode? Kan måske lukkes nu |
| [#41](https://github.com/NicolaiDolmer/CyclingZone/issues/41) / [#38](https://github.com/NicolaiDolmer/CyclingZone/issues/38) / [#39](https://github.com/NicolaiDolmer/CyclingZone/issues/39) | Skærmbillede-bugs | Triage kræves; kan være duplicerede |

**Sammenlagt luk-kandidat: 17 issues.** Hvis alle bekræftes → 150-17 = 133 åbne.

---

## 📋 Antagelser jeg har truffet (bruger kan korrigere)

1. **AI/Ops token-reduktion (aktiv slice) må ikke crowde sprintet** → epic:ai-workflow lavt-prioriteret under sprint
2. **Bruger lukker selv** → ingen auto-close. _(claude:done label deprecated 2026-05-18 — direct-close fra todo/in-progress er kanonisk.)_
3. **Slice 07 efterveer er lukke-kandidater** → #82, #86, #235, #79, #137 anbefales luk
4. **Post-sprint juni-juli er BETINGET Go-beslutning** → Stripe/ApS/MoR-issues markeret 🔒
5. **UCI/IP-migration er commercial-launch-blocker** → får 🟧 og deadlines pre-day-30
6. **Supporter-tier features (#27 gemte filtre, #26 war-room) er V5, ikke V2/V8** → relevant POST Go fordi de driver Supporter-konvertering (49 DKK/md)
7. **Mobile-bugs (#258, #259, #9, #225) er pre-Discord-launch P0** → uge 21 selv om priority:med
8. **#367 (Mobile UX-verify) er ikke en feature — den er en QA-gate** → T-1 deadline absolut
9. **#284 (board-tabeller 0 rows) er IKKE en bug** → FEATURE_STATUS bekræfter milestone-gated; flagget som luk-kandidat
10. **#46 + #224 (UI stale-state) har samme cache-rod** → bør fixes som ét stykke arbejde

---

## ✅ Action-items efter prioritering

1. **Bruger:** Veto luk-kandidat-listen (17 stk) — hvilke skal IKKE lukkes?
2. **Bruger:** Bekræft top 10 — er der noget vigtigere jeg overser?
3. **Bruger:** Beslut om luk-kandidater skal lukkes nu eller i én batch ved sprint-slut
4. **Næste session:** Hvis approve → batch close af verificeret-done-issues (8 stk) via `gh issue close N --reason completed --comment "..."`
5. **Næste session:** Sub-issue triage på #41/#38/#39/#36 (4 skærmbillede-bugs uden klar kontekst)
6. **Ad-hoc:** Når w1 lukker (24/5), opdatér denne fil med faktiske rollovers + nye issues fra Discord

---

**Stale-detection:** Hvis denne fil ikke er opdateret siden seneste fredag og sprintet kører, er den stale — opdatér ved næste session-start.
