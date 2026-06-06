# TdF 2026 Launch Plan

> **Etableret:** 2026-05-25
> **Hård deadline:** 2026-06-20 — fuldt fungerende beta klar EN+DA
> **Acquisition-vindue:** 2026-07-04 til 2026-07-26 (Tour de France 2026)
> **Ejer:** Nicolai (founder, fuldtid fra 2026-06-01)

## Hovedmål

TdF 2026 = første ekstern acquisition-test for CyclingZone. Beta skal være ærlig nok til at sende folk ind i.

> **Opdatering 6. juni 2026 — relaunch-pivot (epic [#1105](https://github.com/NicolaiDolmer/CyclingZone/issues/1105)):** 20/6 er en **HARD RELAUNCH til en frisk, juridisk uafhængig sæson 1** (fiktive ryttere + eget værdisystem + egen race-afvikling, al PCM/UCI væk). Alle — gamle testere + nye spillere — starter lige; beta-testere får et permanent founder-badge. Race-afvikling kører en **light egen motor** (#1102) + PCM-fallback til launch; den fulde kalibrerede engine (#1021) modnes post-launch. Dette afløser den tidligere "sæson 1+2 PCM → engine sæson 3-4"-faseplan og opdaterer succeskriterierne nedenfor.

## Spor parallelt indtil 2026-06-20

Fire spor kører samtidig, alle skal være færdige til 2026-06-20.

### Spor A — Sæson 1 sandkasse (PCM, midlertidig)

| Dato | Milestone | Owner |
|---|---|---|
| 2026-05-26 | `dyn_cyclist` Excel-sync (hold-ID 10→14 + rytter-transitions) | Claude Code |
| 2026-05-27 til 2026-05-29 | Sæson 1 starter (onsdag-fredag) | Nicolai |
| 2026-05-30 til 2026-06-10 | Race-results-pipeline (Excel → website, midlertidig) | Claude Code |
| 2026-06-10 til 2026-06-12 | Sæson 1 slutter, sandkasse evalueret | Nicolai |

### Spor B — Race engine + ability system (egen)

| Dato | Milestone | Owner |
|---|---|---|
| 2026-05-26 til 2026-06-02 | Research + arkitektur-doc (cycling zones, watt-profiler, VO2max, FTP) | Manus |
| 2026-06-02 til 2026-06-16 | MVP-implementation der kan bygges videre | Claude Code |
| 2026-06-16 til 2026-06-20 | Calibration mod PCM-data, sanity-test | Claude Code + Nicolai |

### Spor C — Fiktive ryttere

| Dato | Milestone | Owner |
|---|---|---|
| 2026-06-02 til 2026-06-09 | Fiktive navne + nationaliteter (faker + cykel-konsistens) | Claude Code |
| 2026-06-09 til 2026-06-16 | Stats rebuild via ny ability-model | Claude Code |
| 2026-06-16 til 2026-06-20 | Migration + verifikation | Claude Code |

### Spor D — Polish (EN-translation, brand, UI/UX, landing page, Discord)

| Dato | Milestone | Owner |
|---|---|---|
| 2026-05-26 til 2026-06-09 | EN-translation closeout (#666 + remaining #483-børn) | Claude Code |
| 2026-05-26 til 2026-06-09 | UI/UX-audit (first-week-experience, critical flows) | Nicolai + Claude Code |
| 2026-06-01 til 2026-06-15 | Brand minimum (accent + font + wordmark, outsource logo) | Nicolai + ekstern designer |
| 2026-06-09 til 2026-06-16 | Landing page polish (hero, fairness-løfte, founder-waitlist) | Claude Code |
| 2026-06-09 til 2026-06-20 | Discord-struktur (welcome-flow, kanal-organisering, roles) | Nicolai |

## Discord/community-timeline

| Dato | Fase | Mål |
|---|---|---|
| Nu til 2026-06-10 | Lukket dev-fokus | 13 medlemmer holdes, intet ekstern push |
| 2026-06-10 til 2026-06-20 | Intern bølge | 20-30 medlemmer fra dansk cykel-netværk + de 7 manglende testere |
| 2026-06-20 til 2026-07-04 | Pre-TdF ekstern push | 50+ medlemmer, founder-waitlist live, Reddit r/procyclingmanager build-in-public-post |
| 2026-07-04 til 2026-07-26 | TdF live | Daglig race-discussion, eksternt acquisition-momentum |

## Succeskriterier 2026-06-20

Beta er "fuldt fungerende" når (relaunch-model, opdateret 6/6):
- [ ] **Hard relaunch til frisk, uafhængig sæson 1** kørt (#1103) — alle starter lige
- [ ] Egen race-afvikling live: light-motor (#1102) + PCM-fallback bag flag; fuld engine (#1021) modnes post-launch
- [ ] Fiktive ryttere live (#669/#677), ingen PCM-data eller rigtige navne eksponeret player-facing
- [ ] Eget værdisystem live (`base_value`, ikke uci_points) (#1101)
- [ ] Beta-testere har permanent founder-badge (#1103)
- [ ] EN+DA-translation: kritiske flows uden DA-leaks i EN-mode (#678)
- [ ] Landing page med fairness-løfte, founder-waitlist, euro/pr-dag-priser (#672/#1104) + domæne (#352)
- [ ] Roadmap-voting live (#954)
- [ ] Discord-struktur klar (welcome-flow + organiserede kanaler) (#679)
- [ ] Brand-minimum: accent-farve + font + wordmark konsistent på website (#671)

## Succeskriterier 2026-07-26 (TdF-slut)

- [ ] Discord 50+ medlemmer
- [ ] Founder-waitlist 25+ signups
- [ ] 8+ user interviews gennemført
- [ ] Retention D7 ≥ 30% (eller dokumenteret hvorfor ikke)
- [ ] Alunta payment-flow testet med min. 1 reel transaktion
- [ ] Manus' "Go/Iterate/No-Go"-decision tages august med ekstern-data

## Risici

| Risiko | Sandsynlighed | Impact | Mitigation |
|---|---|---|---|
| Engine V1 ikke statistisk plausibel inden 2026-06-20 | Med | Høj | Calibration-buffer 16-20/6, fallback til PCM-import bevares til engine er stabil |
| Discord-vækst kommer ikke når ekstern push starter 20/6 | Med | Med | Reddit-post hard-tested mod subreddit-rules; founder build-in-public-tone reduserer downvote-risk |
| EN-translation har flere skjulte leaks end #666 antyder | Lav-Med | Med | i18n-check-CI guards mod nye leaks, manual walk-through inden 20/6 |
| Sæson 1-data inkonsistent ved import af `dyn_cyclist` | Lav | Høj | Excel-eksempel-test 26/5 før produktion-sync |
| Alunta self-service-flow ikke international-venlig | Lav-Med | Med | Verificeres med Alunta-support før international launch |

## Post-TdF beslutninger (parkerede)

- Skal Alunta forblive primær eller skal vi tilføje Stripe direkte for international?
- Skal Premium-tier features bygges før Pro Analyst eller omvendt?
- Skal vi køre en formel monetization-validation-sprint august-september eller bygge baseret på spontant TdF-feedback?
- Server-arkitektur ved 100+ samtidige spillere
- Race engine V2 (team-tactics, taktiske valg under løb)
