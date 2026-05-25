# CyclingZone Business Model

> **Etableret:** 2026-05-25 (strategi-session)
> **Snapshot-dato:** 2026-05-25
> **Næste review:** post-TdF (august 2026) når monetization-validation-data eksisterer
> **Ejer:** Nicolai Dolmer Mikkelsen (founder)

## Mission

Bygge et fair, browser-first cykel-manager-MMO der kan understøtte fuldtidsdrift fra Nicolai med 14k-25k DKK/mdr brutto som første milestone, 35k DKK/mdr som stærk uafhængig forretning. Niche-international, EN-først, DA-sekundær.

## Fairness-løfte (brand-løfte)

> "The game must be fair for everyone. You cannot pay for better riders, faster training, or better results."

Premium gives identitet, analyse-værktøjer, comfort, community-status. Premium giver aldrig konkurrence-fordele.

## Tier-struktur (player-facing navne låst)

| Tier | Pris/md | Målgruppe | Premium-værdi |
|---|---:|---|---|
| Free Manager | 0 kr | New + casual | Fuld konkurrence-adgang til kerne-spillet |
| Premium | 49 kr | Engaged | Supporter-badge, profil-temaer, gemte filtre, udvidet historik, Discord-rolle |
| Pro Analyst | 89 kr | Hardcore managers | Avanceret analyse, rytter-sammenligning, scouting-dashboards, eksport |
| Patron | 149 kr | Superfans + early believers | Founder-badge, dev Q&A, roadmap-stemmer på non-balance-emner, Hall of Fame |

Founder = early-adopter-status for første 100 waitlist-signups, ikke separat betalt tier.

## Revenue-mål (decision-model, ikke forecast)

| Mål/md (brutto) | Realistisk early-niche scenario | Betalende brugere | MAU |
|---:|---|---:|---:|
| 14.000 kr | 4% conversion @ 69 kr ARPPU | ~203 | ~5.073 |
| 25.000 kr | Samme | ~363 | ~9.058 |
| 35.000 kr | Samme | ~508 | ~12.682 |

## Payment-stack

Alunta (DK-baseret subscription-management, free tier op til 10 kunder + 10K MRR).
- Stripe under hætten for kort, MobilePay og Betalingsservice integreret
- e-conomic-integration for auto-bogføring
- Self-service portal eliminerer behov for in-app subscription UI v1

## Strategiske beslutninger (truffet, ikke åbne)

- **Egen race-engine** — afskaffer PCM senest 2026-06-20 (IP-risiko + TdF-marketing)
- **Fiktive ryttere** — implementeres senest 2026-06-20 (samme rationale)
- **Generiske race-navne** — ASO ejer "Tour de France"-trademark
- **EN-først, DA-sekundær** — international vækst, ikke kun dansk niche
- **Tone of voice** — founder-led build-in-public, "jeg" ikke "vi" (per docs/TONE_OF_VOICE.md)
- **Payment-provider** — Alunta (DK + international via Stripe-passthrough)

## Niche-ceiling-hypotese

Velogames ~30.000 spillere globalt (sandsynligvis TdF-peak, ikke baseline MAU). Det er konkurrence-data der antyder vores realistic ceiling, ikke vores mål. Skal valideres post-TdF.

## Acquisition-strategi (overordnet)

| Periode | Strategi |
|---|---|
| Nu — 2026-06-10 | Lukket dev-fokus, kun eksisterende testere |
| 2026-06-10 — 2026-06-20 | Lille intern bølge: dansk cykel-netværk + manglende 7 testere |
| 2026-06-20 — 2026-07-04 | Pre-TdF ekstern push: Reddit r/procyclingmanager (build-in-public), dansk cykelnetværk, founder waitlist live |
| 2026-07-04 — 2026-07-26 | TdF-acquisition: cykel-fora, fantasy-adjacent, Velogames-naboområde |
| 2026-08+ | Post-TdF validation-decision: Alunta-payment live for Founder Supporter hvis signaler ok |

## Validation-port for fuldtid

Manus' 30-dages validation-sprint (17. juni decision) er udskudt. Ny port:
- **Post-TdF (august 2026):** evaluér Discord-vækst, retention, paying-conversion. Beslut om fuldtid skal fortsætte eller plan B aktiveres.

## Plan B (ikke aktiv)

Hvis post-TdF data viser at niche er for lille til 14k DKK/mdr inden runway slutter (oktober 2026):
- Skift fra full-time til part-time
- Refokuser på retention + community før monetization
- Genoverveje EN-først hvis DK-niche viser sig stærkere

Dette dokument opdateres ved hvert strategi-skifte. Mindre opdateringer kan ske inline; større pivots dokumenteres som ADR i docs/decisions/.
