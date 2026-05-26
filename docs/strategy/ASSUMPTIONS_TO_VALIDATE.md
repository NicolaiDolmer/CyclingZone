# Antagelser der mangler validation

> Etableret 2026-05-25.
> Hver antagelse har sandsynlighed-vurdering + foreslået validation-metode + hvornår valideringen ideelt sker.

## Forretningsmodel-antagelser

### A1: 4% paying conversion er realistisk for engaged cykel-niche
**Sandsynlighed:** Mellem. Velogames + Hattrick + GPRO antyder det er muligt, men ingen direkte CyclingZone-data endnu.
**Validation-metode:** Post-TdF cohort-analyse. Hvis 25+ founder-waitlist-signups konverterer til 5+ betalende, antagelse delvist bekræftet.
**Hvornår:** August 2026

### A2: 69 kr blended ARPPU er plausibel
**Sandsynlighed:** Mellem-høj. Tier-priser (49/89/149) er typiske for niche SaaS.
**Validation-metode:** Pricing-survey i Discord når 50+ medlemmer er nået; faktisk tier-mix når Alunta-payments kører.
**Hvornår:** Pre-TdF survey (~juni), post-TdF data (august)

### A3: 5.000 MAU er nåbar via TdF-acquisition + organisk
**Sandsynlighed:** Lav-mellem. Velogames-30k er sandsynligvis seasonal peak, ikke baseline. Reddit-niche kan være mindre end forventet.
**Validation-metode:** Track signup-rate under TdF (4-26 juli). Hvis +500 signups under TdF, antagelse styrket. Hvis +50, antagelse svækket.
**Hvornår:** Post-TdF (slut juli 2026)

### A4: EN-først acquisition fungerer bedre end DA-først
**Sandsynlighed:** Mellem. Det er en strategisk beslutning, ikke en testet antagelse.
**Validation-metode:** A/B-test landing page EN vs DA hvis tid; alternativt sammenlign signup-rate på Reddit (EN) vs dansk cykel-netværk (DA).
**Hvornår:** Pre-TdF eller TdF-vindue

### A5: Niche-ceiling for fuldtid er ≥ 14k DKK/mdr (~5k MAU)
**Sandsynlighed:** Ukendt. Velogames-founder har separat fuldtidsjob, hvilket antyder at niche-ceiling for fuldtid kan være lavere.
**Validation-metode:** Manus-research på Velogames revenue + comparable niche-games-business-economics.
**Hvornår:** Post-TdF eller når runway er < 15 uger

## Produkt-antagelser

### A6: 14-21 dages sæson er ikke for lang for retention
**Sandsynlighed:** Ukendt. Player_events kan måle dette.
**Validation-metode:** Analyse af session-frequency gennem sæson 1 (27/5-10/6). Spørg testere direkte under interviews.
**Hvornår:** Post-sæson-1 (juni)

### A6b: D7 retention ≥ 30% er nåbar post-TdF
**Sandsynlighed:** Lav baseret på open-beta-cohort 8-15 maj (5 brugere, D7 = 20% — under target). Cohort er dog for lille til hård konklusion + instrumentation hul (kun 2/5 har `session_started`).
**Validation-metode:** Gentag retention-audit på TdF-cohort med større N + presence-based fallback + Clarity cross-check (se [`retention-cohort-may-2026.md`](../research/retention-cohort-may-2026.md), refs [#670](https://github.com/NicolaiDolmer/CyclingZone/issues/670), [#674](https://github.com/NicolaiDolmer/CyclingZone/issues/674)).
**Hvornår:** Under og post-TdF (juli-august 2026)

### A7: Cycling-zones + watt-tal vil føles relevant for målgruppen
**Sandsynlighed:** Mellem-høj for hardcore-niche (Strava/Zwift-nørder). Mellem for casual-fantasy-spillere.
**Validation-metode:** A/B-test efter race engine V1: vis cycling-zones-detalje vs traditional-abilities-only; mål engagement.
**Hvornår:** Post-engine-V1 (juli-august)

### A8: Egen race engine kan generere statistisk plausible resultater inden 20. juni
**Sandsynlighed:** Afhænger af Manus' research + Claude Code implementation-tempo.
**Validation-metode:** Calibration-test 16-20/6: kør sæson 2 sandkasse, sammenlign top-20-ranking mod PCM-sæson-1.
**Hvornår:** 2026-06-16 til 2026-06-20

### A9: Fiktive ryttere bevarer spil-balance
**Sandsynlighed:** Høj hvis stats genereres via samme physiological model. Mellem hvis stats kun navne+nationaliteter ændres og PCM-stats beholdes.
**Validation-metode:** Sammenlign sæson-3-resultater (med fiktive ryttere) mod sæson-1-pattern.
**Hvornår:** Post-fiktive-ryttere-deployment (juli)

## Acquisition-antagelser

### A10: Build-in-public-tone konverterer på Reddit r/procyclingmanager
**Sandsynlighed:** Mellem. Subreddit har anti-promotion-rules; founder-build-in-public-tone reducerer risk.
**Validation-metode:** Reddit-post 2026-06-20+. Mål upvotes, comments, Discord-signups inden for 48 timer.
**Hvornår:** 2026-06-22 (48 timer efter post)

### A11: TdF-fans er konverterbare til CyclingZone-spillere
**Sandsynlighed:** Mellem. Velogames bekræfter fantasy-cykel-interesse under TdF, men det er race-by-race fantasy, ikke persistent manager.
**Validation-metode:** Signup-rate under TdF vs forventet baseline. Sammenlign med pre-TdF-baseline (juni).
**Hvornår:** Løbende under TdF (4-26 juli)

### A12: Discord = bedste community-platform (vs forum, Slack, Mighty Networks)
**Sandsynlighed:** Høj for gaming-niche. Discord er industristandard.
**Validation-metode:** Tester-interviews under TdF: spørg hvor de hænger ud, om Discord er friktion eller fordel.
**Hvornår:** Under TdF (juli)

## Payment-antagelser

### A13: Alunta dækker både DK og international Premium-purchase
**Sandsynlighed:** Høj for DK (deres core business). Ukendt for international.
**Validation-metode:** Spørg Alunta-support direkte før international launch. Test med non-DK kort i sandkasse.
**Hvornår:** Pre-TdF (juni) eller før første non-DK signup

### A14: 49 kr/md Premium-tier vil have lavere prismodstand end alternatives
**Sandsynlighed:** Høj. Lav nok til impulse-køb, høj nok til at signalere værdi.
**Validation-metode:** Pricing-survey i Discord. Faktisk konverteringsrate når Alunta-flow er live.
**Hvornår:** Pre-TdF survey, post-TdF data

## Hvad denne fil IKKE er

Ikke en checkliste der skal færdiggøres. Antagelser valideres LØBENDE som naturlige sideprodukter af det arbejde vi alligevel skal lave. Tag den frem ved beslutninger om prioritering for at sikre at vi ikke bygger 4 uger på en antagelse vi ikke har testet.
