# Sprint Dashboard — Monetization Validation

> **Sprint:** Monetization Validation Sprint
> **Periode:** 2026-05-18 → 2026-06-17 (30 dage)
> **I dag:** 2026-05-14 (T-4 før sprint-start)
> **Sidste opdatering:** 2026-05-14
>
> **Formål:** Single-page status på hvor langt vi er. Opdateres ved session-start og når metrics ændrer sig. Detaljeret strategi → [`BUSINESS_STRATEGY.md`](BUSINESS_STRATEGY.md).

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

> Codex-issue #7 (sprint-metrics dashboard i app) automatiserer disse tal når den er bygget.

## 📅 Uge-status (interaktive checkbox-tasks)

### Uge 1 (18-24 maj) — Foundation
**Manus-track:**
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
- [ ] **Søn 24:** Pitch deck v0 (én side)

**Founder Track:**
- [ ] **Man 18:** 30 min ApS vs enkeltmandsvirksomhed (virk.dk)
- [ ] **Tir 19:** 30 min MoR research (Paddle vs Lemon Squeezy vs Stripe+MOSS)
- [ ] **Ons 20:** 30 min InnoBooster eligibility (innovationsfonden.dk)
- [ ] **Tor 21:** 30 min DFI status (ring hvis hjemmeside er uklar)
- [ ] **Fre 22:** Book revisor-møde til uge 2

**Uge 1 exit-tærskler:** Discord 30+, survey 0 (live i uge 2), feedback contributors 5+.

### Uge 2 (25-31 maj) — Survey live + pricing
- [ ] Survey publiceret offentligt
- [ ] Price sensitivity poll
- [ ] 2-3 interviews
- [ ] Founder Supporter waitlist-spørgsmål i survey
- [ ] Pro Analyst feature poll
- [ ] Mid-survey review (dag 14)
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

| # | Status | Issue | Codex assigned |
|---|---|---|---|
| TBD | ⏳ | Landing page for Founder Supporter waitlist | — |
| TBD | ⏳ | Supabase tabel `founder_supporter_waitlist` + RLS | — |
| TBD | ⏳ | Waitlist-form + UTM source-tracking | — |
| TBD | ⏳ | Admin dashboard for waitlist intent-scoring | — |
| TBD | ⏳ | Survey-CTA-banner i app | — |
| TBD | ⏳ | PatchNotes-entry om fair freemium-eksperiment | — |
| TBD | ⏳ | Sprint-metrics dashboard i app | — |
| TBD | ⏳ | GDPR privatlivspolitik + samtykke-flow | — |

(Issue-numre indsættes når de er oprettet på GitHub.)

## 🏛️ Founder Track (samlet jura/finansiering/IP-checklist)

**Status:** Alle åbne pr. 2026-05-14.

| Område | Action | Deadline | Status |
|---|---|---|---|
| Jura | ApS vs enkeltmandsvirksomhed besluttet | Uge 5 | ⏳ |
| Jura | Revisor-møde afholdt | Uge 2 | ⏳ |
| Moms | MoR-provider valgt (Paddle/Lemon Squeezy/Stripe+MOSS) | Uge 4 | ⏳ |
| GDPR | Privatlivspolitik live | Uge 1 | ⏳ |
| GDPR | Samtykke-flow på waitlist | Uge 2-3 (Codex) | ⏳ |
| IP | Advokat-konsultation booket | Uge 2 | ⏳ |
| IP | Advokat-konsultation afholdt | Uge 3 | ⏳ |
| IP | Race-name licens-pris undersøgt (ASO/RCS/UCI) | Uge 3 | ⏳ |
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
