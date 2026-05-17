# Sprint Dashboard — Monetization Validation

> **Sprint:** Monetization Validation Sprint
> **Periode:** 2026-05-18 → 2026-06-17 (30 dage)
> **I dag:** 2026-05-15 (T-3 før sprint-start)
> **Sidste opdatering:** 2026-05-15 (samlet backlog-prioritering tilføjet — [`BACKLOG_PRIORITIZED.md`](BACKLOG_PRIORITIZED.md))
>
> **Formål:** Single-page status på hvor langt vi er. Opdateres ved session-start og når metrics ændrer sig. Detaljeret strategi → [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md). **Prioriteret backlog (alle 150 åbne issues) → [`BACKLOG_PRIORITIZED.md`](BACKLOG_PRIORITIZED.md).**

## 📊 Metrics at a glance

🟢 = Green / Go  •  🟡 = Yellow / Iterate  •  🔴 = Red / No-Go  •  ⏳ = Awaiting data  •  — = Ikke målbart endnu

### Sprint success metrics (Go/No-Go tærskler)

| Metric | Nu | Ugemål (w1) | Ugemål (w2) | Ugemål (w3) | Final (day 30) | Status |
|---|---:|---:|---:|---:|---:|---|
| Discord members | 0 | 15 | 30 | 40 | 50+ | 🔴 |
| Email subscribers (waitlist) | 0 | 0 | 5 | 15 | 25+ | 🔴 |
| Survey responses | 0 | 0 | 20 | 35 | 50+ | 🔴 |
| Fairness clarity (4-5/5) | — | — | — | 70% | 80%+ | ⏳ |
| Supporter willingness (49+ DKK) | — | — | — | 12% | 15%+ | ⏳ |
| Pro Analyst interest (89+ DKK) | — | — | — | 3% | 5%+ | ⏳ |
| Interviews completed | 0 | 2 | 4 | 6 | 8+ | 🔴 |
| Waitlist/survey ratio | — | — | — | 20% | 25%+ | ⏳ |
| Pay-to-win objections | — | — | — | 15% | <10% | ⏳ |

### Game-metrics (live spillerbase)

| Metric | Nu | Trend (7d) | Note |
|---|---:|---:|---|
| Total registered players | — | — | Træk fra Supabase: `select count(*) from auth.users` |
| Daily active players (DAU) | — | — | Definér "active": login eller race-action senest i dag |
| Weekly active players (WAU) | — | — | Login senest 7 dage |
| Monthly active players (MAU) | — | — | Login senest 30 dage |
| Returning testers (D7) | — | — | % af users der returner efter dag 7 |
| Paying users | 0 | 0 | Først relevant efter day 30 Go-beslutning |
| Avg session length | — | — | Fra analytics |

> **Live siden 2026-05-17** ([#365](https://github.com/NicolaiDolmer/CyclingZone/issues/365)): admin kan trække DAU/WAU/MAU/D7/avg-session/top-features fra [`/admin/sprint-metrics`](https://cycling-zone.vercel.app/admin/sprint-metrics) — klik **⬇ CSV** og paste ind her.

## 📅 Uge-status (interaktive checkbox-tasks)

### Uge 1 (18-24 maj) — Foundation
**Manus-track:**
- [ ] **Søn 17 (T-1):** Mobile UX-verification af key pages (auctions/board/dashboard/finance/riders/seasons/team) FØR Discord-launch så ny trafik ikke bouncer på broken mobile. Brug eksisterende Playwright mobile-snapshots.
- [ ] **Man 18:** Discord launch post + poll #1 pinned
- [ ] **Man 18:** Pull beta-data baseline (DAU/WAU/D7-retention/session-længde/top-features)
- [ ] **Man 18:** Identificér top 10-15 mest aktive spillere
- [ ] **Tir 19:** Opret `#fair-premium-feedback` Discord-kanal
- [ ] **Tir 19:** DM 5 top-spillere med interview-invitation
- [ ] **Ons 20:** Premium feature poll (#3 i Manus' poll-sekvens)
- [ ] **Ons 20:** Start survey-draft i Tally (12 spørgsmål fra Manus)
- [ ] **Tor 21:** Færdiggør survey
- [ ] **Tor 21:** Objection poll (#5)
- [ ] **Tor 21:** Draft GDPR privatlivspolitik
- [ ] **Fre 22:** Inviter 5 testere til interview
- [ ] **Fre 22:** Community update i Discord ("hvad vi har lært")
- [ ] **Søn 24 maj 10-12:** Pitch deck v0 (én side) — til fremtidige DFI/InnoBooster/angel-samtaler
- [ ] **Søn 24 maj 14-18:** Recruitment research + 3 Reddit-post drafts ([#472](https://github.com/NicolaiDolmer/CyclingZone/issues/472)) — klar til paste man-tir 25-26 maj

**Founder Track:**
- [ ] **Man 18:** 30 min ApS vs enkeltmandsvirksomhed (virk.dk)
- [ ] **Tir 19:** 30 min MoR research (Paddle vs Lemon Squeezy vs Stripe+MOSS)
- [ ] **Ons 20:** 30 min InnoBooster eligibility (innovationsfonden.dk)
- [ ] **Tor 21:** 30 min DFI status (ring hvis hjemmeside er uklar)
- [ ] **Fre 22:** Book revisor-møde til uge 2

**Uge 1 exit-tærskler:** Discord 30+, survey 0 (live i uge 2), feedback contributors 5+.

### Uge 2 (25-31 maj) — Survey live + pricing + Reddit-aktion
- [ ] Survey publiceret offentligt
- [ ] Price sensitivity poll
- [ ] 2-3 interviews
- [ ] Founder Supporter waitlist-spørgsmål i survey
- [ ] Pro Analyst feature poll
- [ ] Mid-survey review (dag 14)
- [ ] **Man 25 / Tir 26 maj:** Post 3 Reddit-drafts live ([#472](https://github.com/NicolaiDolmer/CyclingZone/issues/472) — fremrykket fra uge 3 per founder-brainstorm 2026-05-17)
- [ ] **Uge 2:** DM 3-5 PCM YouTubere/streamere (fra [#472](https://github.com/NicolaiDolmer/CyclingZone/issues/472) liste)
- [ ] **Uge 2:** Cycling Zones mockup `/preview/skills` deployed til prod ([#473](https://github.com/NicolaiDolmer/CyclingZone/issues/473)) — bruges som "kommer snart"-asset i recruitment-posts
- [ ] **Founder Track:** Revisor-møde afholdt
- [ ] **Founder Track:** Skriv InnoBooster-ansøgning (hvis kvalificeret)

### Uge 3 (1-7 juni) — Waitlist GÅR LIVE + advokat
- [ ] Landing page deployed (kræver Codex-issue #1)
- [ ] Founder Supporter waitlist GÅR LIVE
- [ ] Social copy postet i relevante communities
- [ ] 2-3 flere interviews
- [ ] "Hvad vi har lært så langt" community-update
- [ ] **Founder Track:** Advokat-konsultation booket
- [ ] **Founder Track:** Advokat-konsultation afholdt (UCI/IP)
- [ ] **Founder Track:** Pris-research på race-name licens fra ASO/RCS/UCI

### Uge 4 + day 30 (8-17 juni) — Decision
- [ ] Final 2-3 interviews
- [ ] Final community poll: build now / later / not yet
- [ ] Decision memo skrevet
- [ ] **Go/Iterate/No-Go decision (day 30)**
- [ ] Beslutning kommunikeret til Discord
- [ ] **Hvis Go:** Stripe vs Paddle besluttet + ApS-stiftelse igangsat
- [ ] **Hvis Go:** Codex-issues for Stripe-integration oprettet
- [ ] **Hvis Iterate:** Næste 14-dages sprint defineret
- [ ] **Hvis No-Go:** Retention-sprint defineret

## 🔧 Tekniske opgaver (GitHub-issues)

> Auto-synk: `gh issue list --label sprint-validation --state open`
> **Pre-feature tech hygiene:** [#373](https://github.com/NicolaiDolmer/CyclingZone/issues/373) Vite/plugin-react dependency alignment køres efter #367 Mobile UX-verification og før nye sprint-feature issues. Formål: holde Vite 8 build-kæden ren før mere frontend-arbejde.

| # | Status | Issue | Codex assigned |
|---|---|---|---|
| [#359](https://github.com/NicolaiDolmer/CyclingZone/issues/359) | ⏳ | Supabase tabel `founder_supporter_waitlist` + RLS | — |
| [#360](https://github.com/NicolaiDolmer/CyclingZone/issues/360) | ⏳ | GDPR privatlivspolitik + samtykke-flow | — |
| [#361](https://github.com/NicolaiDolmer/CyclingZone/issues/361) | ⏳ | Landing page for Founder Supporter waitlist | — |
| [#362](https://github.com/NicolaiDolmer/CyclingZone/issues/362) | ⏳ | Waitlist-form + UTM source-tracking | — |
| [#363](https://github.com/NicolaiDolmer/CyclingZone/issues/363) | ⏳ | Admin dashboard for waitlist intent-scoring | — |
| [#364](https://github.com/NicolaiDolmer/CyclingZone/issues/364) | ⏳ | Survey-CTA-banner i app | — |
| [#365](https://github.com/NicolaiDolmer/CyclingZone/issues/365) | ✅ | Sprint-metrics dashboard i app | Claude |
| [#366](https://github.com/NicolaiDolmer/CyclingZone/issues/366) | ⏳ | PatchNotes-entry om fair freemium-eksperiment | — |
| [#367](https://github.com/NicolaiDolmer/CyclingZone/issues/367) | ⏳ | Mobile UX-verification af key pages før Discord-launch (T-1 søn 17 maj) | — |
| [#472](https://github.com/NicolaiDolmer/CyclingZone/issues/472) | ⏳ | Discord/Reddit recruitment research + post drafts (uge 2 fremrykket) | Bruger |
| [#473](https://github.com/NicolaiDolmer/CyclingZone/issues/473) | ⏳ | Cycling Zones skill system mockup `/preview/skills` ("kommer snart"-asset) | Codex |

(Filtrér i GitHub: [`label:sprint-validation`](https://github.com/NicolaiDolmer/CyclingZone/issues?q=is%3Aissue+is%3Aopen+label%3Asprint-validation))

## 🏛️ Founder Track (samlet jura/finansiering/IP-checklist)

**Status:** Alle åbne pr. 2026-05-14. **Eksterne møder (revisor/advokat) udskudt — bruger laver selv-research først** (jf. Decision log 2026-05-14). Deadlines herunder antyder ideel timing; faktisk booking sker når selv-research afdækker konkrete spørgsmål der kræver ekstern rådgivning.

| Område | Action | Deadline | Status |
|---|---|---|---|
| Jura | ApS vs enkeltmandsvirksomhed besluttet | Uge 5 | ⏳ |
| Jura | Revisor-møde afholdt | Uge 2 | ⏳ |
| Moms | MoR-provider valgt (Paddle/Lemon Squeezy/Stripe+MOSS) | Uge 4 | ⏳ |
| GDPR | Privatlivspolitik live | Uge 1 | ⏳ |
| GDPR | Samtykke-flow på waitlist | Uge 2-3 (Codex) | ⏳ |
| IP | Advokat-konsultation booket | Uge 2 | ⏳ |
| IP | Advokat-konsultation afholdt | Uge 3 | ⏳ |
| IP | Race-name licens-pris undersøgt — kontakt ASO (TdF/Vuelta/Paris-Roubaix/LBL/Paris-Nice), RCS Sport (Giro/Milano-Sanremo/Tirreno/Lombardia/Strade), Flanders Classics (Ronde/Omloop/E3/Gent-Wevelgem). Brug "kontakt"/"licensing"-formularer på deres websites; advokat kan rådgive om sprogtone. | Uge 3 | ⏳ |
| IP | Team/rider migration til fiktivt univers (planlagt komplet inden day 30) | Uge 4 | ⏳ |
| Finansiering | InnoBooster eligibility-tjek | Uge 1 | ⏳ |
| Finansiering | DFI's spilordning status verificeret | Uge 1 | ⏳ |
| Finansiering | Creative Europe MEDIA games-pulje vurderet | Uge 2 | ⏳ |
| Forbrugerret | Refund-policy formuleret EU-compliant | Uge 3 | ⏳ |

## 📝 Decision log (append-only)

| Dato | Beslutning | Begrundelse |
|---|---|---|
| 2026-05-14 | Tier-struktur: 49/89/149 + 490 årlig | Manus' 4 versioner samlet til én kanonisk; testes i survey |
| 2026-05-14 | UCI vej: behold ægte navne under sprint + advokat-blocker uge 3 + migration til fiktive teams/riders inden day 30 + research licens-pris for race-names | Pragmatisk balance: validation-momentum vs. juridisk risiko |
| 2026-05-14 | Sprint starter 2026-05-18 (mandag) | Ren ugestruktur |
| 2026-05-14 | Codex får tekniske implementerings-issues; bruger beholder strategi | Cross-PC AI-workflow |
| 2026-05-14 | Dashboard = SPRINT_DASHBOARD.md + GitHub Project board + Calendar events | 3 lag uden overlap |
| 2026-05-14 | **Selv-research-track før eksterne møder:** Bruger udskyder møder med revisor + advokat — laver først selv-research og inddrager andre ved konkret yderligere behov. Founder Track-rækker for "møde afholdt" forbliver i tabellen som senere milestones, men deadlines er nu "efter self-research". | Sparer fee + ejerskab af problem-formuleringen før ekstern rådgivning |
| 2026-05-14 | Revisor-book Fre 22 maj behold 10:00 30 min (ikke 13:00 per appendix) — repurpose til revisor self-research forberedelse | 13:00 kolliderer med eksisterende "Ugentlig reset"; 30 min mere realistisk end 15 |
| 2026-05-14 | `frontend-only` label oprettes IKKE — frontend-changes skal have user-verification (manuel UI-test). Kun `backend-only` + `docs-only` bypasser PR user-verification check. | Bevarer guard-rail mod blind merge af UI-ændringer |

## 🚨 Risk snapshot (top 3)

1. **UCI/cykelsport IP** 🔴 — Real race-names + UCI-scraper i kode. Mitigation: advokat uge 3 + team/rider migration inden day 30. **Detaljer:** [BUSINESS_STRATEGY.md §8](BUSINESS_STRATEGY.md#8-risiko-register).
2. **Retention ukendt** 🟡 — Hele revenue-modellen antager 40%+ weekly returning. Måles mandag uge 1.
3. **Organic-growth-antagelse** 🟡 — Sprintet har ingen paid acquisition fallback. Kanal-attribution i survey afslører om Discord/Reddit reelt leverer.

## 🗓️ Mit næste fokus (top 3)

1. **Genstart med:** `Læs docs/SPRINT_DASHBOARD.md` — så har jeg al kontekst om hvor vi er
2. **Næste session:** Opret 8 GitHub-issues + Google Calendar-events for sprintets opgaver
3. **Hver session-start:** Opdater "I dag", metrics-tabel, checkbox-status

---

**Hvordan du opdaterer dette dashboard:**
- **Metrics manuelt:** Træk fra Discord-admin, Supabase, Tally, og opdater "Nu"-kolonnen
- **Tasks:** Bare ret `[ ]` til `[x]`
- **Beslutninger:** Append til Decision log
- **Live game-metrics:** Når Codex-issue #7 er live, kan du klikke ind på `/admin/sprint-metrics` og se tallene direkte

---

## 📦 Appendix: Codex Issue Specs (til oprettelse næste session)

Disse specs bruges af næste Claude-session til at oprette GitHub-issues med `gh issue create --body-file`. Hver issue skal have label `sprint-validation` + `claude:todo` + relevant scope-label (`frontend-only`/`backend-only`/`docs-only`).

> **Reference på OneDrive:** Alle Manus-detaljer ligger i `C:\Users\emmas\OneDrive\CyclingZone-context\CyclingZone-Manus noter\`. Cite indhold direkte i issue-body (Codex har ikke adgang til OneDrive).

### Issue #1: Landing page for Founder Supporter waitlist
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`
- **Acceptance:** Ny route `/founder` (eller `/founder-supporter`) deployed til prod. Indeholder hero, fairness-promise, primary CTA "Join Founder Supporter waitlist", FAQ, sekundær CTA "Take 3-min survey". Mobile-first responsive.
- **Copy:** Kopiér 1:1 fra `Cycling Zone — Landing Page Copy and Founder Supporter Offer.md` (hero/subhead/CTA/FAQ/3 sociale versioner)
- **Dependencies:** Ingen
- **Skip:** Stripe-integration (kommer først efter day-30 Go-beslutning)
- **Estimat:** 1-2 dage

### Issue #2: Supabase tabel `founder_supporter_waitlist` + RLS
- **Labels:** `sprint-validation`, `claude:todo`, `backend-only`
- **Acceptance:** Migration `YYYY-MM-DD-founder-supporter-waitlist.sql` opretter tabel med felter: `id uuid pk`, `email text`, `discord_handle text`, `interest_level text`, `preferred_tier text`, `main_reason text`, `valued_benefits text[]`, `fairness_red_line text`, `follow_up_consent boolean`, `source text` (UTM/utm_source), `created_at timestamptz`, `intent_score int` (computed). RLS: anon kan INSERT, kun authenticated admin kan SELECT.
- **Schema-detalje:** Se `Cycling Zone — Founder Supporter Waitlist Setup.md` (9-felts form-spec)
- **Husk per memory:** `CREATE POLICY` skal wraps i `DROP POLICY IF EXISTS` (idempotent migration); multi-file migrations samme dag kræver lex-ordering
- **Dependencies:** Ingen
- **Estimat:** ½ dag

### Issue #3: Waitlist-form med Supabase-integration + UTM tracking
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`
- **Acceptance:** Form på `/founder` (issue #1) submitter til `founder_supporter_waitlist` (issue #2). UTM-params fra URL (`?utm_source=discord_launch`) gemmes i `source`-felt som hidden field. Success-confirmation efter submit. Validering på client + server.
- **Mulige source-værdier:** `discord_launch`, `survey`, `direct_dm`, `reddit_pcm`, `reddit_peloton`, `other` (Manus' spec)
- **Dependencies:** #1 + #2
- **Estimat:** 1 dag

### Issue #4: Admin dashboard for waitlist intent-scoring
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`
- **Acceptance:** Beskyttet admin-route der lister waitlist-signups med auto-beregnet intent-score (base 1-4 fra `interest_level` + bonusser for `discord_handle`, `valued_benefits ≥3`, `follow_up_consent=true`). Sortér efter score desc. Eksportér til CSV. Brug eksisterende admin-auth.
- **Scoring-regler:** Se `Cycling Zone — Founder Supporter Waitlist Setup.md` ("Manual scoring for go/no-go")
- **Dependencies:** #2
- **Estimat:** 1 dag

### Issue #5: Survey-CTA-banner i app
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`
- **Acceptance:** Dismissable banner i logged-in app (på dashboard eller globalt). Linker til Tally-survey-URL. Vis 1x per bruger (track i localStorage eller user_preferences-tabel). Dismiss = ingen visning igen.
- **Survey-URL:** Indsættes når Tally-form er live (uge 1 onsdag/torsdag); brug placeholder `SURVEY_URL` indtil
- **Dependencies:** Ingen
- **Estimat:** ½ dag

### Issue #6: PatchNotes-entry om fair freemium-eksperiment
- **Labels:** `sprint-validation`, `claude:todo`, `docs-only`
- **Acceptance:** Ny version-entry i `frontend/src/pages/PatchNotesPage.jsx` (bump til main+1). Brugerrettet sprog: forklar at vi tester en fair non-pay-to-win premium-model, link til Discord + survey, understreg at intet ændres for free-spillere.
- **Husk per memory:** Tjek main's øverste version før merge; bump til max+1 ved kollision
- **Dependencies:** Ingen
- **Estimat:** 15 min

### Issue #7: Sprint-metrics dashboard i app
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`, `backend-only`
- **Acceptance:** Admin-route `/admin/sprint-metrics` viser de 12 metrics fra Go/No-Go framework (Discord/survey/waitlist/interview tællere + DAU/WAU/MAU game-metrics). Som start: manuel input via form for "external" tællere (Discord, survey, interviews); auto-query for game-metrics fra Supabase. Senere iteration: full automation.
- **Metrics-spec:** Se `Metrics and Go/No-Go Framework.md` (13 tracking-felter)
- **Dependencies:** #2 (har brug for waitlist-tælling)
- **Estimat:** 1-2 dage

### Issue #8: GDPR privatlivspolitik + samtykke-flow
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`, `docs-only`
- **Acceptance:** Privatlivspolitik-side på `/privacy` med info om hvilke data der indsamles (email, discord_handle, survey-svar, optional follow-up consent), retention-periode, slette-procedure. Samtykke-checkbox på waitlist-form med link til policy. Footer-link til policy fra landing page.
- **Compliance-noter:** Dansk GDPR-praksis = ikke-pre-tjekket checkbox; EU 14-day refund GÆLDER IKKE for digitale services hvor bruger har samtykket til straks-levering (skal formuleres præcist)
- **Dependencies:** #3
- **Estimat:** 1 dag

### Issue #9: Mobile UX-verification af key pages før Discord-launch
- **Labels:** `sprint-validation`, `claude:todo`, `frontend-only`
- **Acceptance:** Mobile Playwright-snapshots passerer for `/`, `/dashboard`, `/auctions`, `/board`, `/riders`, `/team`, `/finance`, `/seasons` på iPhone-størrelse. Eventuelle regression-fix. Rapport i issue-body med screenshots eller link til snapshot-output.
- **Tidskritisk:** Skal være klar søndag 2026-05-17 så ny trafik fra Discord-launch mandag ikke møder broken mobile UX
- **Reference:** `mobile_access_notes.md` (Manus)
- **Dependencies:** Ingen
- **Estimat:** ½-1 dag

---

### Google Calendar events der skal oprettes næste session

| Event | Dato | Type | Note |
|---|---|---|---|
| **Sprint Day 1 — Discord launch** | Man 18 maj 2026 | All-day | Inkl. data baseline + identify top 10-15 |
| **Sprint Day 2** | Tir 19 maj 2026 | All-day | Discord channel + interview-DMs |
| **Sprint Day 3** | Ons 20 maj 2026 | All-day | Feature poll + survey-draft |
| **Sprint Day 4** | Tor 21 maj 2026 | All-day | Survey live-prep + objection poll + GDPR |
| **Sprint Day 5** | Fre 22 maj 2026 | All-day | Interview-invites + community update |
| **Sprint weekend** | Lør-søn 23-24 maj | Block | 2-3 interviews + pitch deck v0 |
| **ApS research** | Man 18 maj 14:00 | 30 min | virk.dk |
| **MoR research** | Tir 19 maj 14:00 | 30 min | Paddle/Lemon Squeezy vs Stripe+MOSS |
| **InnoBooster research** | Ons 20 maj 14:00 | 30 min | innovationsfonden.dk |
| **DFI research** | Tor 21 maj 14:00 | 30 min | Ring DFI hvis hjemmeside er uklar |
| **Book revisor til uge 2** | Fre 22 maj 13:00 | 15 min | Ring/email |
| **Mobile UX-verification** | Søn 17 maj | 1-2 timer | Pre-launch sanity check |
| **Advokat-research (find IP/sports-jurist)** | Uge 2 (man 25 maj) | 30 min | Cykel-relateret IP-erfaring |
| **Advokat-konsultation** | Uge 3 | 1 time | Booket separat; 5-15k DKK |
