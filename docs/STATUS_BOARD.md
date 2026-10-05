# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

87 features i FEATURE_REGISTRY.yml: live 64 · beta 6 · dormant 3 · building 9 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6053 feat(training): Programs - pick rider or group first, then the program (#6035) (2d) — groen
- #6198 chore(5864): dry-run + ejer-gated haandhaevelse af udloebne kontrakter (0d) — groen
- #6196 fix(db): PostgREST-timeouts - batch-dedup i cron, LIMIT 1 i stall-vagten og to race_resul… (0d) — DIRTY
- #6220 chore(db): explicit grants template, audit and CI for new tables (0d) — groen
- #6222 perf(vercel): skip main builds without frontend input changes (0d) — groen
- #6225 fix(race-engine): Spar kraefter giver altid halv stoette under orders_gc_v3 (Refs #3460) (0d) — groen
- #6215 fix(finance): accurate sponsor calendar preview and prize range (0d) — groen
- #6224 fix(race-engine): farlig rytter i udbrud møder modreaktion og snor (orders_gc_v3) (0d) — groen
- #6217 ux(race-film): saml gentagne ens haendelser paa samme km (Refs #6137) (0d) — roed
- #6218 fix(reputation): sort displayed values and explain board star counts (0d) — groen
- #6223 fix(race-engine): faelles tidsmodel for stigning og nedkoersel (orders_gc_v3, #6199 #6200) (0d) — groen
- #6216 fix(race): egen tilstand for udbryder sat af fra udbruddet (Refs #6185) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (119d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (119d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (118d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (117d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (109d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (83d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (81d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (78d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (74d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (72d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (72d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (71d)
- #3050 [feature] Venskabsløb / custom turneringer på tværs af divisioner (spiller-oprettede sim-… (70d)
- #3147 [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsonslut (67d)
- #3413 [balance] Udbrudsforsøg er gratis (ingen fatigue, ingen placeringsrisiko) — 2 spillere hæ… (60d)
- …og 45 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (7d) — groen
- #6136 fix(watchdog): bound result metadata with SQL summaries (#6102) (1d) — groen
- #6170 test(loadtest): fail closed on staging data prerequisites (#5904) (0d) — groen

**Ikke-draft med roed tilstand:**

- #6217 ux(race-film): saml gentagne ens haendelser paa samme km (Refs #6137) (0d) — roed
- #6216 fix(race): egen tilstand for udbryder sat af fra udbruddet (Refs #6185) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (142d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (142d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (139d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (133d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (132d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (125d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (125d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (125d)
- #994 [ops] Harness-oprettede worktrees mangler node_modules + .env (auto-setup hook/script) (124d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (119d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (119d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (116d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (112d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (110d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (109d)
- …og 666 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4629 [design] Traeningsprogrammer: ugeplan med session pr. ugedag + 10-25 default-programmer (… (33d)
- #6000 [træning] Træningsgrupper: én beslutning for flere ryttere (ejer 1/10) (4d)
- #6006 [bug/brand] Train now (beta) træner kun 10 af 45 ryttere: autopick-hold behandles som om… (4d)
- #5124 [mobil] D-047-standarden til de fire haandrullede tabeller: Auktioner, Transferlisten, Da… (24d)
- #5685 [traening/mobil] Et-tryks dagvalg (Hvile/Restitution/Pas) paa rytterraekken paa telefonen… (11d)
- #6027 [træning] Train now giver ingen synlig respons: rapporten skjuler løbsdag 1-4 indtil dato… (3d)
- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (5d)
- #5933 [træning] Trætheds-prognose i rytterkortet: 'Træthed i aften: ca. X', opdateres live når… (6d)
- #5932 [træning] De 35 felter (7 ugedage × 5 løbsdage) åbnes for alle: legal frihed til at styre… (6d)
- #5620 [feature] Auto-hvile ved selvvalgt træthedsgrænse, retur til valgt træning næste dag (smu… (11d)
- #4847 [træning] "Træn nu" tilbage uden bonus: tidsuafhængigt resultat, dagen afgøres i begge re… (30d)
- #3643 [ux] Træningssiden på mobil: rework til langt højere standard (ejer-mandat 12/8) (55d)
- #5845 [docs] Ejer-direktiv 27/9: roadmappen opdateres torsdag 1/10 (7d)
- #6095 [bug] Gem af etapetaktik overskriver alle etapers intentioner: Giro-intentioner for 17 et… (3d)
- #4753 [bug/HOEJ] 4 puljer staar paa 25 hold - 13 AI-hold permanent utrimbare af doede transfer_… (31d)
