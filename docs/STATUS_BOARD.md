# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

86 features i FEATURE_REGISTRY.yml: live 63 · beta 6 · dormant 3 · building 9 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6053 feat(training): Programs - pick rider or group first, then the program (#6035) (0d) — groen
- #6128 fix(market): annullér åbne tilbud atomisk ved holdskifte (#6115) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (117d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (117d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (116d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (115d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (107d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (82d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (79d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (77d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (73d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (71d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (71d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (70d)
- #3050 [feature] Venskabsløb / custom turneringer på tværs af divisioner (spiller-oprettede sim-… (69d)
- #3147 [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsonslut (66d)
- #3413 [balance] Udbrudsforsøg er gratis (ingen fatigue, ingen placeringsrisiko) — 2 spillere hæ… (59d)
- …og 40 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6128 fix(market): annullér åbne tilbud atomisk ved holdskifte (#6115) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (5d) — groen
- #6136 fix(watchdog): bound result metadata with SQL summaries (#6102) (0d) — groen
- #6153 fix(rankings): prevent refresh from blocking readers (#5692) (0d) — groen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (141d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (141d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (138d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (131d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (131d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (124d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (124d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (123d)
- #994 [ops] Harness-oprettede worktrees mangler node_modules + .env (auto-setup hook/script) (123d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (118d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (118d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (114d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (111d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (109d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (107d)
- …og 647 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4629 [design] Traeningsprogrammer: ugeplan med session pr. ugedag + 10-25 default-programmer (… (32d)
- #6000 [træning] Træningsgrupper: én beslutning for flere ryttere (ejer 1/10) (2d)
- #6006 [bug/brand] Train now (beta) træner kun 10 af 45 ryttere: autopick-hold behandles som om… (2d)
- #5124 [mobil] D-047-standarden til de fire haandrullede tabeller: Auktioner, Transferlisten, Da… (23d)
- #5685 [traening/mobil] Et-tryks dagvalg (Hvile/Restitution/Pas) paa rytterraekken paa telefonen… (9d)
- #6027 [træning] Train now giver ingen synlig respons: rapporten skjuler løbsdag 1-4 indtil dato… (2d)
- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (4d)
- #5933 [træning] Trætheds-prognose i rytterkortet: 'Træthed i aften: ca. X', opdateres live når… (5d)
- #5932 [træning] De 35 felter (7 ugedage × 5 løbsdage) åbnes for alle: legal frihed til at styre… (5d)
- #5620 [feature] Auto-hvile ved selvvalgt træthedsgrænse, retur til valgt træning næste dag (smu… (10d)
- #6061 [bug] Aftentræningen sætter samme ryttere i karantæne dag efter dag - 2-4 hold afregnes a… (2d)
- #4847 [træning] "Træn nu" tilbage uden bonus: tidsuafhængigt resultat, dagen afgøres i begge re… (28d)
- #4753 [bug/HOEJ] 4 puljer staar paa 25 hold - 13 AI-hold permanent utrimbare af doede transfer_… (30d)
- #3643 [ux] Træningssiden på mobil: rework til langt højere standard (ejer-mandat 12/8) (53d)
- #5860 [races] Entry-generator sweep dobbeltbooker igen i S4 - regression af #5693 (CYCLINGZONE-… (6d)
- …og 4 mere
