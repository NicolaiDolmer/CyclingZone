# CyclingZone — Business Strategy (kanonisk)

> **Status:** Validation phase. Sprint start 2026-05-18.
> **Sidste opdatering:** 2026-05-14
> **Mål:** Gøre CyclingZone til hovedindtægt (14k → 25k → 35k DKK/md gross).
>
> Denne fil er **single source of truth** for forretningsstrategi. Manus-detaljer (landing page copy, survey-spørgsmål, interview-scripts) ligger i `~\OneDrive\CyclingZone-context\CyclingZone-Manus noter\`. Denne fil dokumenterer kun de **valideret + besluttede** dele af strategien.

## 1. Executive summary

CyclingZone skal valideres som **fair freemium (non-pay-to-win)** før Stripe-integration bygges. De næste 30 dage (2026-05-18 til 2026-06-17) er en **monetization validation sprint** med tre formål:

1. Måle om engagerede beta-spillere forstår og accepterer fair-premium-løftet
2. Måle willingness-to-pay via en non-binding Founder Supporter-waitlist
3. Beslutte Go/Iterate/No-Go på faktisk Stripe-implementation efter 30 dage

**Første forretnings-milestone:** ~200 betalende brugere ved 69 DKK ARPPU = ~14.000 DKK/md gross. Det kræver ikke massevækst — det kræver høj retention i en lille kvalificeret niche.

## 2. Tier-struktur (kanonisk)

Manus' dokumenter indeholdt 4 forskellige versioner. Følgende er **besluttet 2026-05-14**:

| Tier | Pris | Målgruppe | Værdi |
|---|---|---|---|
| **Free Manager** | 0 DKK | Nye/casual spillere | Fuld konkurrencemæssig adgang, intet skåret væk |
| **Supporter** | 49 DKK/md eller 490 DKK/år | Engagerede spillere | Badge, profiltemaer, Discord-rolle, gemte filtre, udvidet historik |
| **Pro Analyst** | 89 DKK/md | Hardcore managers | Analytics, rytter-sammenligning, scouting-dashboards, transfer-watchlists, eksport |
| **Patron** | 149 DKK/md | Superfans / tidlige troende | Founder-badge, kosmetik, dev Q&A, roadmap-stemmer på non-balance topics, kreditering |

**Årligt = 10 måneder (2 mdr. gratis).** Founder Supporter er **ikke en separat tier** — det er en waitlist-status. Først 100 waitlist-signups får permanent "Founder"-kosmetik når betaling åbner.

**Survey skal teste:** 29/49/69 DKK for Supporter, 49/89/119 DKK for Pro Analyst. Patron tier valideres separat senere.

## 3. Non-pay-to-win politik (ufravigelig)

| Må sælges | Må IKKE sælges |
|---|---|
| Supporter-badge | Hurtigere træning |
| Profiltemaer/kosmetik | Bedre løbsudfald |
| Discord-rolle | Større transferbudget |
| Gemte dashboards | Bedre scout-odds |
| Udvidet historik | Eksklusive ranked løb for paying |
| Analytics & rytter-sammenligning | Paid currency der ændrer balance |
| Dataeksport | "Power features" |
| Roadmap-stemmer (non-balance) | Stemmer der ændrer balance/økonomi |

**Brand-løfte (synligt overalt):** *"CyclingZone will stay fair. Premium can unlock identity, convenience, analytics and ways to support development. It will not unlock better race results, faster training, stronger riders, transfer advantages, improved scouting odds or hidden power."*

## 4. Required users — målsætning

Tal fra Manus' freemium-model (matematik verificeret 2026-05-14). **"Realistic early niche"-scenarie = 4% conversion, 69 DKK blended ARPPU:**

| Revenue-mål | Paying users | MAU | Hvad det betyder praktisk |
|---:|---:|---:|---|
| 14.000 DKK/md | ~203 | ~5.073 | Income-replacement (kan leve af det). |
| 25.000 DKK/md | ~363 | ~9.058 | Stabil early full-time. |
| 35.000 DKK/md | ~508 | ~12.682 | Stærk uafhængig forretning. |

**ALLE TAL ER GROSS** (før moms 25%, payment fee ~3%, hosting, regnskab, skat). Realistisk netto ≈ 50-65% af gross. **14k DKK gross = ~7-9k DKK netto i hånden ved enkeltmandsvirksomhed.**

⚠️ **Fact-check krav:** Manus' antagelse om 4% paying-conversion er ikke empirisk underbygget for niche browser-MMO. Lavere tal (2-3%) er sandsynligvis mere realistisk. Justér model når egne survey-data er tilgængelige.

## 5. 30-dages validation sprint

**Sprint dates:** 2026-05-18 til 2026-06-17. **Detailed day-by-day plan:** se `~\OneDrive\CyclingZone-context\CyclingZone-Manus noter\Cycling Zone 30-Day Monetization Validation Plan.md` for Manus' grund-plan; tilpasninger:

### Manus-plan + danske tilføjelser

| Uge | Manus-fokus | Tilføjet "Founder Track" |
|---|---|---|
| 1 | Discord launch + first polls + survey draft | Dansk jura research (ApS/moms/GDPR) |
| 2 | Survey publicering + price sensitivity + landing page | Dansk finansiering-kortlægning (InnoBooster, DFI?, MEDIA) |
| 3 | Founder Supporter waitlist live + interviews | **Booket advokat-konsultation om UCI/IP** |
| 4 | Decision: Go/Iterate/No-Go | Hvis Go → Stripe vs Paddle-beslutning + ApS-stiftelse |

## 6. Go/No-Go decision framework (efter 30 dage)

| Metric | Green (Go) | Yellow (Iterate) | Red (No-Go) |
|---|---:|---:|---:|
| Discord-medlemmer | 50+ | 25-49 | <25 |
| Meaningful weekly contributors | 15+ | 7-14 | <7 |
| Survey-svar | 50+ | 20-49 | <20 |
| Fairness clarity (4-5/5) | 80%+ | 60-79% | <60% |
| Supporter willingness (49+ DKK) | 15%+ | 7-14% | <7% |
| Founder waitlist signups | 25+ | 10-24 | <10 |
| Waitlist/survey ratio | 25%+ | 10-24% | <10% |
| Interviews gennemført | 8+ | 4-7 | <4 |
| Weekly returning testers | 40%+ | 20-39% | <20% |
| Pay-to-win objections | <10% | 10-25% | >25% |

**Decision-regel:** Go kræver Green på ≥7/10 metrics. Yellow betyder iterate-sprint på den svageste dimension. Red betyder pause monetization, retention-sprint i stedet.

## 7. Kanaler & målgrupper (prioriteret)

| Prioritet | Målgruppe | Kanal | Approach |
|---|---|---|---|
| 1 | Eksisterende beta-testere (~20 spillere) | Discord (ny dedikeret server) | Interviews, founding-member rolle |
| 2 | Cycling manager-spillere | r/procyclingmanager, PCM-fora | Feedback, ikke promotion |
| 3 | Fantasy cycling-spillere | r/peloton fantasy-tråde | "Beyond fantasy"-positioning |
| 4 | Pro cycling superfans | r/peloton, cykel-Discords | Data-/taktik-vinkel |
| 5 | Browser sportsmanager-veteraner | Hattrick/GPRO-lignende communities | Fair, dyb, non-P2W |
| 6 | Dansk/nordisk netværk | Personlige kontakter, cykelklubber | Test-wedge, ikke hovedmarked |

**Discord setup:** Engelsk, founding-beta-struktur med onboarding-kanal, changelog, dev update, bug-board, feature voting, `#fair-premium-feedback`.

## 8. Risiko-register

### 🔴 UCI / cykelsport IP (kritisk inden commercial launch)

**Status (verificeret 2026-05-14):** CyclingZone bruger reelle UCI-løbsnavne (Tour de France, Giro d'Italia, Vuelta, Monuments, alle WorldTour-løb i `scripts/race_pool_seed.csv`). UCI-scraper aktiv (`scripts/uci_scraper.py`). UCI-points integration i DB-migrations. Rytter-database er sandsynligvis fiktiv/bruger-genereret (ingen hardcodede stjerne-navne fundet i frontend).

**Risiko-niveau pr. element:**
- Løbsnavne (TdF, Giro, Vuelta osv.): **Medium-høj** — ASO/RCS ejer trademarks. Kommerciel brug uden licens = potentiel cease-and-desist.
- UCI-ranglister som data: **Lav-medium** — faktuel sport-stat, men UCI-brand-association kræver licens.
- Rytter-navne: **Ikke aktiv** (ingen hardcoded).

**Beslutning (2026-05-14, suppleret samme dag):**
1. **Hold + ryttere migreres til fiktivt univers inden day 30** (2026-06-17). Det fjerner den største juridiske eksponering (rytter-/team-trademarks).
2. **Race-names beholder vi som ægte** — men undersøger pris for officiel licens (ASO for TdF, RCS for Giro/Lombardia, Flanders Classics, ASO igen for Vuelta osv.). Pris-research er sprint-task i uge 3.
3. **Under sprintet (18 maj - 17 juni):** Behold alt som det er. Founder Supporter er "støtte projektet", ikke "betal for licenseret indhold" — Velogames-præcedens.
4. **Advokat-konsultation uge 3** validerer både rytter-/team-migration-strategien OG race-name licens-vejen før Stripe åbner. Forventet pris: 5.000-15.000 DKK.
5. **Hvis race-name licens er for dyr/ikke tilgængelig for solo-projekt:** fallback til delvis fiktive løbsnavne (fx "Tour of France", "Italian Grand Tour").

**Rationale:** Rytter- og team-trademarks er den højeste risiko (UAE Team Emirates, Visma-Lease a Bike osv. er aktive trademarks med revisions-budgetter til IP-håndhævelse). Løbs-arrangører er færre i antal og typisk villige til at licensere til entusiast-projekter — det er værd at undersøge før man skifter væk. Migration væk fra ægte ryttere/hold sker uanset svaret om race-licens.

### 🟡 Dansk juridisk struktur (blocker for første betaling)

- **ApS vs enkeltmandsvirksomhed:** Skal besluttes før Stripe-aktivering. ApS kræver 40.000 DKK kapital + revisor-pligt >8M omsætning. Enkeltmandsvirksomhed = ubegrænset personlig hæftelse. For online-spil med betalinger → ApS sikrest.
- **Virksomhedsordningen:** Hvis enkeltmandsvirksomhed, mulighed for at udskyde skat på overskud.

### 🟡 Moms / EU-VAT (blocker for første betaling)

- **MOSS/OSS-registrering** kræves når digital service sælges til EU-forbrugere (moms efter købers land).
- **Merchant of Record (MoR) anbefales:** Paddle eller Lemon Squeezy håndterer moms i alle lande for ~5% fee. **Stripe gør det IKKE** — du skal selv håndtere MOSS.
- **For solo-projekt = MoR næsten altid det rigtige valg.**

### 🟡 GDPR (blocker for første waitlist-signup)

- Waitlist + survey indsamler email + Discord-handle → kræver:
  - Privatlivspolitik (synlig på landing page)
  - Samtykke-tekst (checkbox eller pre-tjekket per dansk praksis)
  - Data Processing Agreement med Supabase (allerede til rådighed på Supabase dashboard)
  - Mulighed for sletning + udlevering

### 🟢 Cookies / ePrivacy

- Eksisterende cookie-flow på login (per `mobile_access_notes.md`). Bør verificeres compliant med dansk Cookiebekendtgørelse, men er ikke blocker.

### 🟡 Forbrugerret ved digitale abonnementer

- Manus' "14-day refund policy" på landing page er IKKE compliant med EU consumer-rights for digital services hvor bruger har accepteret straks-levering. Skal omformuleres. Dansk forbrugeraftaleloven har specifikke krav til samtykke ved straks-leverede digitale services.

## 9. Dansk finansiering (research-opgave uge 1)

Manus dækkede ikke dansk finansieringslandskab. Følgende skal verificeres af brugeren (ikke AI-research):

| Kilde | Type | Status 2026-05 | Action |
|---|---|---|---|
| **InnoBooster** (Innovationsfonden) | Tilskud 50-500k DKK | Eksisterer, konkurrencepræget | Undersøg om cykelspil kan kvalificere som "vækstprojekt med teknologisk/forretningsmæssig nyhedsværdi" |
| **DFI's spilordning** | Tilskud | **Uafklaret** — historisk skiftende (CPH Game Hub, DPIN). Verificér aktiv status. | Tjek dfi.dk eller ring DFI direkte |
| **Creative Europe MEDIA** | EU-tilskud til games | Eksisterer, typisk større produktioner | Sandsynligvis ikke realistisk på nuværende stadie |
| **Vækstfonden** | Lån + investeringer | Eksisterer | Mere relevant efter MVP-stadie/proof of revenue |
| **Erhvervsfremme regional** (V&E) | Sparring + mindre tilskud | Eksisterer | Lavere indsats, hurtigere svar |
| **DanBAN** (business angels) | Equity-investering | Eksisterer | For tidligt; revisitér ved 100+ paying users |

## 10. Beslutninger truffet (audit-log)

| Dato | Beslutning | Beslutter |
|---|---|---|
| 2026-05-14 | Tier-struktur 49/89/149 + 490 årlig på Supporter. Founder Supporter = waitlist-status, ikke separat tier. | Bruger |
| 2026-05-14 | UCI vej (suppleret): Behold ægte navne under sprint + team/rider migration til fiktivt univers inden day 30 + race-name licens-pris undersøges parallelt + advokat-blokker uge 3 | Bruger |
| 2026-05-14 | 30-dages sprint starter 2026-05-18 (mandag) | Bruger |
| 2026-05-14 | Codex får tekniske implementerings-issues; bruger beholder strategi | Bruger |
| 2026-05-14 | Forretningsstrategi i `docs/BUSINESS_STRATEGY.md` (denne fil) + Manus-detaljer i OneDrive | Bruger |
| 2026-05-14 | Dashboard-arkitektur: `docs/SPRINT_DASHBOARD.md` (status) + GitHub Project board (tekniske issues) + Google Calendar (tid-blokket arbejde) | Bruger |

## 11. Åbne beslutninger (skal afklares)

| Beslutning | Deadline | Note |
|---|---|---|
| ApS vs enkeltmandsvirksomhed | Før første betaling (~uge 5) | Tal med revisor; ApS sandsynligvis rigtig |
| Stripe vs Paddle vs Lemon Squeezy | Uge 3-4 | Paddle/Lemon = MoR (anbefalet for solo) |
| Race-name licens-pris (ASO/RCS/UCI) — er det realistisk for solo-projekt? | Uge 3 | Bruger undersøger ved at kontakte arrangørerne; advokat kan rådgive |
| Fiktive løbsnavne (fallback hvis licens-pris er for høj) | Uge 4, efter pris-research | Afhænger af licens-svar |
| Team/rider migration: hvordan håndteres eksisterende spilleres data? Auto-rename eller ny sæson? | Uge 3-4 | Teknisk beslutning + spillere-kommunikation |
| Paid acquisition fallback (hvis organisk fejler) | Uge 4 | Afhænger af kanal-attribution fra survey |

## 12. Pegere til Manus-materiale (OneDrive)

Fuld detalje ligger i `~\OneDrive\CyclingZone-context\CyclingZone-Manus noter\`:

| Behov | Fil |
|---|---|
| Discord launch-tekst (klar til paste) | `Cycling Zone — Discord Launch Messages for Today.md` |
| Survey-spørgsmål (12 stk., klar til Tally/Forms) | `Cycling Zone — Survey Setup for Today.md` |
| Interview-script (7 sektioner) | `Cycling Zone — Discord, Survey and Interview Materials.md` |
| Landing page copy (hero, FAQ, social) | `Cycling Zone — Landing Page Copy and Founder Supporter Offer.md` |
| Waitlist form-felter + Supabase-schema | `Cycling Zone — Founder Supporter Waitlist Setup.md` |
| Markedsresearch + konkurrenter (fact-check krav!) | `Cycling Zone_ Wide Research af marked, interesse og konkurrenter.md` |
| Revenue-model + scenarier | `Cycling Zone Freemium Revenue Model.md` |
| Day-by-day sprint plan | `Cycling Zone 30-Day Monetization Validation Plan.md` |
| Konkurrent-data (CSV/JSON) | `cycling_zone_competitor_teardown.csv/json` |

## 13. Fact-check register (FØR pitch til investorer/fonde)

Manus producerede strategi på mobil med second-hand sources. Inden CyclingZone-tal bruges i en pitch til Innovationsfonden, DFI, angels eller PR, **skal følgende verificeres mod primær-kilder**:

- [ ] UCI-survey "22.364 fans / 134 lande" (Manus' UCI-URL gav 404 — kun andenhåndsbrug via Cyclingnews)
- [ ] Velogames "~30.000 Tour-spillere" (kun ét Cycling Weekly-portræt, ikke Velogames selv)
- [ ] Cycling Simulator "620 active managers" (live counter, kan svinge)
- [ ] Grand View "fantasy sports USD 24,8 mia → 56,4 mia, 15.2% CAGR" (inkluderer DFS/gambling — IKKE direkte sammenlignelig med manager-sim)
- [ ] r/procyclingmanager + r/peloton medlemstal (tjek live)
- [ ] PCM 25 Steam-review-tal (live data, ændrer sig)

---

**Næste opdatering:** Efter sprint-uge 1 (2026-05-25). Faktiske survey-tal og waitlist-signups erstatter Manus' antagelser.
