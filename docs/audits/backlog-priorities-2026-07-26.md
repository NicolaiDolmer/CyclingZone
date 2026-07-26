# Backlog-prioritering pr. 26/7 2026 (cutover-dagen)

> Genereret af fuld backlog-audit 26/7 (39-agent workflow: done-verify, glemt-done, dubletter, klassifikation af alle 517 åbne issues). **51 issues lukket samme dag** (evidensliste: [#627](https://github.com/NicolaiDolmer/CyclingZone/issues/627)). Åbne efter audit: **466**. Mål: ~200 via den bæredygtige vej — done-pipeline + "allerede løst"-verifikation + udførelse, IKKE masse-sletning (ejer-mandat 26/7: "Hvis det er vigtigt, så er det jo vigtigt").

Klassificeret: 465 åbne issues. Fordeling: foer_cutover_idag: 12 · under_cutover: 6 · efter_cutover_48t: 35 · s2_uge1: 49 · s2_loebende: 70 · ejer_beslutning: 49 · allerede_loest_tjek: 30 · kill_kandidat: 8 · efter_s2: 206

## Før cutover i dag (verificér — det meste er allerede leveret) (12)

- [#1799](https://github.com/NicolaiDolmer/CyclingZone/issues/1799) **P0** [holdudtagelse] [bug] Akademi-signering lægger rytter på senior-holdet i stedet for akademiet
  - Akademi-signering laegger rytter forkert (senior i stedet for akademi) — bug der paavirker holdudtagelse, boer rettes foer cutover/S2-start.
- [#2022](https://github.com/NicolaiDolmer/CyclingZone/issues/2022) **P0** [oekonomi] [bug] Nyt holds bestyrelse dannes ufuldstændigt: ukalibrerede mål + ingen DNA-valg (basis sætte
  - Nyt holds bestyrelse dannes ufuldstændigt (ukalibrerede mål, intet DNA-valg) — rammer ALLE nye S2-hold, fix før cutover.
- [#2361](https://github.com/NicolaiDolmer/CyclingZone/issues/2361) **P0** [saesonskifte] Sæsonritual: op/nedrykning verificeret+aktiv + sæson-recap + catch-up
  - Op/nedrykning skal verificeret virke KORREKT ved selve sæsonskiftet i aften — kernen i dagens cutover.
- [#2377](https://github.com/NicolaiDolmer/CyclingZone/issues/2377) **P0** [saesonskifte] 24-holds-invarianten: reparér 9 overskudshold + natlig invariant-guard (alle grupper = præcis 2
  - 24-holds-invarianten skal være ren FØR sæson 2 starter mandag; 9 overskudshold skal repareres ved cutover-vinduet.
- [#2407](https://github.com/NicolaiDolmer/CyclingZone/issues/2407) **P0** [saesonskifte] [bug/HØJ] AI-trim over-markerer → Division 4 B/C kollapser til ~4 hold (bryder 24-holds-invaria
  - AI-trim-bug kan kollapse Div4 B/C til 4 hold hvis den kører videre — skal låses/fixes FØR cutover for at undgå katastrofe.
- [#2742](https://github.com/NicolaiDolmer/CyclingZone/issues/2742) **P0** [saesonskifte] S1→S2 cutover: pre-generér S2 race_entries + hård guard mod strandede løb
  - Kritisk: uden pre-genererede S2-entries fejler første S2-etape 27/7; skal løses FØR cutover i aften.
- [#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851) **P0** [saesonskifte] Pyramide-komprimering S1→S2: global rank fylder D2 (48) + D3 (96), ingen motor-nedrykning i ski
  - Pyramide-komprimering er selve cutover-mekanikken for 140 hold — skal være klar/verificeret foer 19:30.
- [#2892](https://github.com/NicolaiDolmer/CyclingZone/issues/2892) **P0** [ops_infra] [ops] 26 af 27 Sentry cron-monitorer er disabled siden 16/7 — tavs job-doed opdages ikke
  - 26/27 cron-monitorer disabled siden 16/7 — uden dem opdages en fejlet cutover-kørsel ikke. Kræver ejer-handling i Sentry nu.
- [#3015](https://github.com/NicolaiDolmer/CyclingZone/issues/3015) **P0** [motor_balance] AI-holdenes ryttere restituerer aldrig — 3.372 ryttere sidder permanent paa traethed 100
  - AI-holds ryttere restituerer aldrig (træthed 100 for 3368/3372) — skævvrider hver eneste løbsresultat i S2.
- [#3016](https://github.com/NicolaiDolmer/CyclingZone/issues/3016) **P0** [ops_infra] [bug] Tre notifikationstyper mangler i notifications_type_check — scout-varsler, #2700-sæsonvar
  - 3 notifikationstyper mangler i DB-constraint — sæsonskifte-varsler og scout-rapporter fejler tavst NU.
- [#3018](https://github.com/NicolaiDolmer/CyclingZone/issues/3018) **P0** [saesonplanlaegning] [P0] Sæsonplanlæggeren viser den GAMLE divisions kalender for sæson 2 — forkert for 140 af 156 
  - Planner viser forkert divisions kalender for 140/156 hold — akut P0, cutover i aften, allerede fixed (PR#3023) — verificér live.
- [#2718](https://github.com/NicolaiDolmer/CyclingZone/issues/2718) **P1** [holdudtagelse] [ux/bug] Rytterprofil: 'Forlæng kontrakt' giver ingen feedback, bruger klikker 15x + rage-click
  - Rage-click-bug på 'Forlæng kontrakt' (Clarity-data) — direkte holdudtagelses-UX, bør fixes inden spillerne bruger det tungt i S2-opstart.

## Under/lige efter cutover i aften (6)

- [#2699](https://github.com/NicolaiDolmer/CyclingZone/issues/2699) **P0** [motor_balance] [balance/HØJ] Akademi-overflow-talenter på auktion er overpowered — stat-konvertér ned til ung-
  - Ejer flagger EKSPLICIT tidsfølsomt+destruktivt: overpowered akademi-talenter ruller til auktion NU, skal ses/godkendes af ejer straks.
- [#2846](https://github.com/NicolaiDolmer/CyclingZone/issues/2846) **P0** [saesonskifte] Post-cutover-verifikation 27/7: sponsor-rater, foerste payroll, varsel, season_ended, frigivels
  - Selve post-cutover-tjeklisten — køres lige efter transitionen i aften/i morgen.
- [#3009](https://github.com/NicolaiDolmer/CyclingZone/issues/3009) **P0** [oekonomi] [bug] moneySupply- og inflationScorecard printer HEADLINE FAIL og exiter 0 — økonomien dumper s
  - Balance-scorecards printer FAIL men exiter 0 — usynlig gate-fejl; skal fikses/verificeres omkring cutover for S2-tal.
- [#929](https://github.com/NicolaiDolmer/CyclingZone/issues/929) **P1** [ops_infra] security: enable HaveIBeenPwned leaked password protection i Supabase Auth
  - Sikkerheds-flag i Supabase Auth-dashboard, hurtig og kan slås til når som helst.
- [#2639](https://github.com/NicolaiDolmer/CyclingZone/issues/2639) **P1** [saesonskifte] [beslutning+reparation] Trim 7 overskuds-AI-hold i Division 4 (B+3, C/D/F/G+1) — audit-checket 
  - Prod-datafix: trim 7 overskuds-AI-hold i div4, ejer allerede sagt ja — bør køres omkring cutover mens tabeller alligevel røres.
- [#2743](https://github.com/NicolaiDolmer/CyclingZone/issues/2743) **P1** [saesonskifte] Race-motor: graceful håndtering af 2 samtidige active sæsoner (maybeSingle kaster)
  - Race-transition edge-case (2 samtidige active sæsoner) kan ramme netop under cutover-vinduet i aften.

## Mandag-tirsdag (S2-start-kritisk) (35)

- [#2164](https://github.com/NicolaiDolmer/CyclingZone/issues/2164) **P0** [saesonskifte] Aktivér nedrykning Division 3 → Division 4 (ingen nedrykning fra div 4)
- [#21](https://github.com/NicolaiDolmer/CyclingZone/issues/21) **P1** [saesonplanlaegning] [bug] Kommende løb-funktionen viser forkerte løb
- [#324](https://github.com/NicolaiDolmer/CyclingZone/issues/324) **P1** [ops_infra] [ops] Fase 0: gør AI/release baseline reel og verificerbar
- [#452](https://github.com/NicolaiDolmer/CyclingZone/issues/452) **P1** [saesonskifte] [feature] Tilmeld-knap til kommende sæson når manager ikke kan stille hold (sub-issue til #239)
- [#543](https://github.com/NicolaiDolmer/CyclingZone/issues/543) **P1** [saesonskifte] Feature: season_transition_paused admin-håndsving
- [#1596](https://github.com/NicolaiDolmer/CyclingZone/issues/1596) **P1** [saesonskifte] [forever] WS1 Fase 3 aktivering + beta-stress-test (forever-gate §6.1)
- [#1774](https://github.com/NicolaiDolmer/CyclingZone/issues/1774) **P1** [saesonplanlaegning] [bug] Antal etapedage stemmer ikke: forside vs. division vs. pulje (40 vs. 60 vs. 41)
- [#1784](https://github.com/NicolaiDolmer/CyclingZone/issues/1784) **P1** [ops_infra] Vercel Pro: sæt spend management / budget-loft op (forsikring før marketing-bølge)
- [#1819](https://github.com/NicolaiDolmer/CyclingZone/issues/1819) **P1** [oekonomi] Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup
- [#1847](https://github.com/NicolaiDolmer/CyclingZone/issues/1847) **P1** [ops_infra] [bug] Orphaned race_results (247 rækker, NULL rider_id) efter rytter-sletning
- [#1925](https://github.com/NicolaiDolmer/CyclingZone/issues/1925) **P1** [holdudtagelse] Follow-ups efter holdudtagelses-overhaul (#1924): help.json, trigger-verify, edge-cases, oprydn
- [#1974](https://github.com/NicolaiDolmer/CyclingZone/issues/1974) **P1** [motor_balance] [bug/balance] Træning: FLAD/SPRINT/ACCELERATION-færdigheder udvikles næsten ikke — ryttere ser 
- [#2177](https://github.com/NicolaiDolmer/CyclingZone/issues/2177) **P1** [saesonplanlaegning] [feature] Rute-rebalance: 0 enkeltstarter i sæsonen efter ruteprofil-opdatering — genindfør ITT
- [#2263](https://github.com/NicolaiDolmer/CyclingZone/issues/2263) **P1** [andet] [bug] Rytters stats/evner nulstillet? — spiller-rapport med screenshots (til ejer), undersøg da
- [#2270](https://github.com/NicolaiDolmer/CyclingZone/issues/2270) **P1** [ops_infra] [ci] Natlig game-day smoke-sim: fuld pipeline-test (kalender->startlister->etape->standings->pr
- [#2406](https://github.com/NicolaiDolmer/CyclingZone/issues/2406) **P1** [andet] [bug] Rytter-stats nulstillet uden forklaring (27→21 i flere evner)
- [#2521](https://github.com/NicolaiDolmer/CyclingZone/issues/2521) **P1** [saesonskifte] [bug/design] Bestyrelsestilfredshed låst på 50% i hele sæson 1 (baseline-fase) — ejer: må aldri
- [#2557](https://github.com/NicolaiDolmer/CyclingZone/issues/2557) **P1** [motor_balance] [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-win-rat
- [#2645](https://github.com/NicolaiDolmer/CyclingZone/issues/2645) **P1** [motor_balance] [bug/balance] Peak/loft-beskeder inkonsistente: 'approaching ceiling' ved 29/90+ — Del B peak-a
- [#2679](https://github.com/NicolaiDolmer/CyclingZone/issues/2679) **P1** [ops_infra] AI-audit 19/7: disable-bølge — 5 dødvægt/dublet-plugins (~6-7k tok/session)
- [#2681](https://github.com/NicolaiDolmer/CyclingZone/issues/2681) **P1** [ops_infra] AI-audit 19/7: memory-hygiejne — MEMORY.md 2 tok fra fail-gate + memory-dir +173% (consolidate 
- [#2682](https://github.com/NicolaiDolmer/CyclingZone/issues/2682) **P1** [ops_infra] AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL
- [#2689](https://github.com/NicolaiDolmer/CyclingZone/issues/2689) **P1** [ops_infra] AI-opsætnings-audit 19/7: prioriteringsoversigt (10 issues, ~7-11k tok/session at hente)
- [#2739](https://github.com/NicolaiDolmer/CyclingZone/issues/2739) **P1** [ops_infra] DISCORD_OPS_MENTION sat til rå ID → ops-alarmer pinger ikke ejeren (kun tekst)
- [#2776](https://github.com/NicolaiDolmer/CyclingZone/issues/2776) **P1** [andet] Fair-play-sag 22/7: multi-konto-funnel (1,97 mio. flyttet for 2 kr.) — sanktion gennemført, for
- [#2789](https://github.com/NicolaiDolmer/CyclingZone/issues/2789) **P1** [motor_balance] [balance] Sub-3 gap-model: 6 rute-huller fundet i adversarisk verifikation mod aegte S2-data
- [#2811](https://github.com/NicolaiDolmer/CyclingZone/issues/2811) **P1** [saesonskifte] [verify] Foerste koerte S2-etape: bevis Sub-2's passage-persistens + Sub-4's RESULT-flade (efte
- [#2830](https://github.com/NicolaiDolmer/CyclingZone/issues/2830) **P1** [ops_infra] security: 131 tabeller har samme brede write-grants som #2802 — systematisk audit + default-pri
- [#2916](https://github.com/NicolaiDolmer/CyclingZone/issues/2916) **P1** [saesonskifte] Managerens opsaetning baeres ikke over ved saesonskifte (5 ting, ingen faelles mekanik)
- [#2982](https://github.com/NicolaiDolmer/CyclingZone/issues/2982) **P1** [oekonomi] Tvangssalg: kreditering og rytter-disposition er ikke atomiske — crash midtvejs giver holdet pe
- [#3013](https://github.com/NicolaiDolmer/CyclingZone/issues/3013) **P1** [ops_infra] refresh_ranking_matviews() låser rangliste- og standings-siderne ude (REFRESH uden CONCURRENTLY
- [#2749](https://github.com/NicolaiDolmer/CyclingZone/issues/2749) **P2** [oekonomi] [Investigation] S1 prize-overbetaling: 40,7M udbetalt vs 35,98M payable
- [#2751](https://github.com/NicolaiDolmer/CyclingZone/issues/2751) **P2** [saesonskifte] Season-standings: NULL league_division_id (test/frosne konti) ekskluderes tavst fra op/nedrykni
- [#2836](https://github.com/NicolaiDolmer/CyclingZone/issues/2836) **P2** [saesonskifte] auctions: intet saelger-gulv-tjek ved finalisering — hold kan ende under 8-minimum ved overdrag
- [#2901](https://github.com/NicolaiDolmer/CyclingZone/issues/2901) **P2** [ops_infra] [security] REVOKE anon/authenticated-grants paa 47 RLS-laaste tabeller (EFTER cutover)

## Første uge af sæson 2 (49)

- [#33](https://github.com/NicolaiDolmer/CyclingZone/issues/33) **P1** [holdudtagelse] [feature] Tillad salg af rytter under division-minimum i transfer-vinduet
- [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) **P1** [ops_infra] [ops] Full SUPABASE_SERVICE_KEY rotation — generate new key + sync all surfaces
- [#1106](https://github.com/NicolaiDolmer/CyclingZone/issues/1106) **P1** [saesonplanlaegning] Multi-sæson visning: rangliste/historik/kalender på tværs af sæsoner (10+)
- [#1140](https://github.com/NicolaiDolmer/CyclingZone/issues/1140) **P1** [onboarding_retention] Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer)
- [#1569](https://github.com/NicolaiDolmer/CyclingZone/issues/1569) **P1** [onboarding_retention] Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan
- [#1734](https://github.com/NicolaiDolmer/CyclingZone/issues/1734) **P1** [saesonplanlaegning] Udvid løb-katalog så hver pulje får fulde 8 etapeløb
- [#1919](https://github.com/NicolaiDolmer/CyclingZone/issues/1919) **P1** [design_ui] [ux] Race-/strategi-/lineup-flader: 15-17% dead clicks — statisk tekst & overskrifter ser klikb
- [#1970](https://github.com/NicolaiDolmer/CyclingZone/issues/1970) **P1** [design_ui] [ux] Frisk Clarity 27-29/6: /team (208) + /teams/{id} (90, 12 rage) + /training (141) stadig hø
- [#2041](https://github.com/NicolaiDolmer/CyclingZone/issues/2041) **P1** [onboarding_retention] investigation(analytics): Returning users stadig ~0 efter #1797 identify()-fix — verificér i pr
- [#2042](https://github.com/NicolaiDolmer/CyclingZone/issues/2042) **P1** [onboarding_retention] feat(activation): Cold trafik rammer login-væg på dybe app-ruter (/riders, /races) → bounce — o
- [#2045](https://github.com/NicolaiDolmer/CyclingZone/issues/2045) **P1** [design_ui] In-app sprog-flicker: tekst skifter flere gange ved sprog-skift/load (dansk-klage)
- [#2084](https://github.com/NicolaiDolmer/CyclingZone/issues/2084) **P1** [onboarding_retention] [feature/email] Welcome-mail + D2/D7 onboarding-sekvens via Resend (noreply@cyclingzone.org)
- [#2180](https://github.com/NicolaiDolmer/CyclingZone/issues/2180) **P1** [holdudtagelse] [feature] "Mangler holdudtagelse"-påmindelse for løb der starter inden for 36t → indbakke + Dis
- [#2182](https://github.com/NicolaiDolmer/CyclingZone/issues/2182) **P1** [design_ui] [bug/ux] Dashboard-moduler skal vise spillerens EGEN division/gruppe (rangliste + seneste resul
- [#2257](https://github.com/NicolaiDolmer/CyclingZone/issues/2257) **P1** [oekonomi] [bug] Auktion vundet men annulleret; ex-akademiryttere fra lukket snyd-hold i mærkelig fri-agen
- [#2402](https://github.com/NicolaiDolmer/CyclingZone/issues/2402) **P1** [motor_balance] [bug] Ryttere restituerer ikke fatigue natten over (modsiger help-tekst)
- [#2405](https://github.com/NicolaiDolmer/CyclingZone/issues/2405) **P1** [motor_balance] [afklaring] Taktik tillader flere ryttere i samme rolle (fx breakaway hunter) — tilsigtet?
- [#2650](https://github.com/NicolaiDolmer/CyclingZone/issues/2650) **P1** [motor_balance] [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recovery ka
- [#2701](https://github.com/NicolaiDolmer/CyclingZone/issues/2701) **P1** [holdudtagelse] [feature/design] Auktion: køb tilladt hvis du har plads samlet set (senior ELLER akademi) — aut
- [#2731](https://github.com/NicolaiDolmer/CyclingZone/issues/2731) **P1** [motor_balance] Race-balance: maxRiderWinRate 0,67-0,75 vs mål 0,45 (én rytter dominerer felterne, 4+ dage rødt
- [#2797](https://github.com/NicolaiDolmer/CyclingZone/issues/2797) **P1** [holdudtagelse] [bug] Byttehandel omgår akademiets 8-plads-cap: akademi-rytter byttes ind på modpartens akademi
- [#2824](https://github.com/NicolaiDolmer/CyclingZone/issues/2824) **P1** [onboarding_retention] [fable] Synlighed udefra: login-vaeg, sprogstier og SEO er ét problem (efter 27/7)
- [#2842](https://github.com/NicolaiDolmer/CyclingZone/issues/2842) **P1** [ops_infra] Spillerfeedback kan hverken læses eller besvares — indsendelser lander i en blind tabel
- [#2877](https://github.com/NicolaiDolmer/CyclingZone/issues/2877) **P1** [motor_balance] Etape-berigelse tabes permanent når standings-recompute fejler — 19 etaper i 14 løb ramt
- [#2881](https://github.com/NicolaiDolmer/CyclingZone/issues/2881) **P1** [holdudtagelse] [bug/HØJ] Promovering fra akademiet nulstiller en eksisterende kontrakt (sæson 3 → sæson 2) og 
- [#2890](https://github.com/NicolaiDolmer/CyclingZone/issues/2890) **P1** [design_ui] [design] Evne-varmeskalaen er fejl-ankret: 96 % af ryttere på menneskehold render gråt
- [#2905](https://github.com/NicolaiDolmer/CyclingZone/issues/2905) **P1** [saesonplanlaegning] [UX] Season planner er ikke intuitiv nok — interaktionsmodellen skal gentænkes (ejer-krav, week
- [#2976](https://github.com/NicolaiDolmer/CyclingZone/issues/2976) **P1** [oekonomi] Tvangssalg (breach-streak ≥2) sender ingen notifikation — holdet mister sin dyreste rytter uden
- [#3007](https://github.com/NicolaiDolmer/CyclingZone/issues/3007) **P1** [onboarding_retention] [ux/onboarding] 61 hold har aldrig lagt et bud — trin 1 er det største aktiverings-hul, og trin
- [#3008](https://github.com/NicolaiDolmer/CyclingZone/issues/3008) **P1** [onboarding_retention] [bug/onboarding] OnboardingTour-tooltip lander forkert: skjult dublet-anker på /auctions deskto
- [#3012](https://github.com/NicolaiDolmer/CyclingZone/issues/3012) **P1** [andet] [ux/bug] Døde klik: 13 resterende tavse fejl + disabled-uden-forklaring (sweep fra #3005)
- [#3014](https://github.com/NicolaiDolmer/CyclingZone/issues/3014) **P1** [ops_infra] [perf/guard] URL-længde-fælden i .in(race_id, ...) — de ~10 resterende kaldesteder efter #2861
- [#99](https://github.com/NicolaiDolmer/CyclingZone/issues/99) **P2** [onboarding_retention] [feature] Tooltip/inline forklaring af rytter-værdi
- [#101](https://github.com/NicolaiDolmer/CyclingZone/issues/101) **P2** [onboarding_retention] [feature] Vis bestyrelsens konkrete effekter (sponsor m.m.) i UI
- [#708](https://github.com/NicolaiDolmer/CyclingZone/issues/708) **P2** [ops_infra] Supabase Data API explicit grants for new public tables
- [#720](https://github.com/NicolaiDolmer/CyclingZone/issues/720) **P2** [ops_infra] [security] Verificér disk-kryptering på PC3 (DolmerPC) før produktionsbrug
- [#725](https://github.com/NicolaiDolmer/CyclingZone/issues/725) **P2** [ops_infra] [security] Afklar én kanonisk secret-sti (runtime-injection vs export-til-.env) + doctor-WARN p
- [#1900](https://github.com/NicolaiDolmer/CyclingZone/issues/1900) **P2** [holdudtagelse] [ux] Cross-division standings-overblik: alle divisioner i én visning + filter til egen (#1835-s
- [#1928](https://github.com/NicolaiDolmer/CyclingZone/issues/1928) **P2** [holdudtagelse] [feature] Gør det tydeligt HVILKE ryttere der er holdets stjerne-/profilryttere
- [#2181](https://github.com/NicolaiDolmer/CyclingZone/issues/2181) **P2** [design_ui] [ux] Venstre-nav oprydning: dublet "Løb"/"Holdudtagelse", manglende "Holdstrategi"-link, holdna
- [#2669](https://github.com/NicolaiDolmer/CyclingZone/issues/2669) **P2** [oekonomi] [chore/balance] Migrér 7 offline-harnesses fra v3- til v4-værdimodellen (efterslæb fra #2594-cu
- [#2697](https://github.com/NicolaiDolmer/CyclingZone/issues/2697) **P2** [onboarding_retention] [feature] Talentspejder: enkelt-rytter-undersøgelse skal være markant hurtigere (ejer 18/7)
- [#2719](https://github.com/NicolaiDolmer/CyclingZone/issues/2719) **P2** [holdudtagelse] [ux] Auktion: auto-bid 'Save' dead-clicker + 'Bid+Auto-bid' rage-clicked paa /auctions (Clarity
- [#2720](https://github.com/NicolaiDolmer/CyclingZone/issues/2720) **P2** [holdudtagelse] [scouting] Rapport viser modstridende signaler: "Verdensklasse-emne" + "lav tillid" samtidig, o
- [#2756](https://github.com/NicolaiDolmer/CyclingZone/issues/2756) **P2** [design_ui] [ux] Kalender: '+N more' kan ikke foldes ud — fuld kalender for anden division/gruppe kan ikke 
- [#2761](https://github.com/NicolaiDolmer/CyclingZone/issues/2761) **P2** [onboarding_retention] [onboarding] In-app indbakke-besked med Discord-invite til alle managers (ny + backfill) (ejer 
- [#2826](https://github.com/NicolaiDolmer/CyclingZone/issues/2826) **P2** [onboarding_retention] [growth] 7 af 161 udfyldte hele tilmeldingen og kom aldrig ind — faldt paa e-mail-bekraeftelsen
- [#2893](https://github.com/NicolaiDolmer/CyclingZone/issues/2893) **P2** [ops_infra] [ops] Daglig sundhedsrapport paa projekt-ejet job_heartbeat — positiv puls i stedet for kun fej
- [#2723](https://github.com/NicolaiDolmer/CyclingZone/issues/2723) **P3** [design_ui] [ux] Renown ("anseelse") er kun synligt i bestyrelseslokalet — spillere kan ikke se rytterens r

## I løbet af sæson 2 (70)

- **ops_infra** (17): [#1464](https://github.com/NicolaiDolmer/CyclingZone/issues/1464)(P1) [#2460](https://github.com/NicolaiDolmer/CyclingZone/issues/2460)(P1) [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605) [#1461](https://github.com/NicolaiDolmer/CyclingZone/issues/1461) [#1462](https://github.com/NicolaiDolmer/CyclingZone/issues/1462) [#2086](https://github.com/NicolaiDolmer/CyclingZone/issues/2086) [#2101](https://github.com/NicolaiDolmer/CyclingZone/issues/2101) [#2423](https://github.com/NicolaiDolmer/CyclingZone/issues/2423) [#2511](https://github.com/NicolaiDolmer/CyclingZone/issues/2511) [#2572](https://github.com/NicolaiDolmer/CyclingZone/issues/2572) [#2671](https://github.com/NicolaiDolmer/CyclingZone/issues/2671) [#2677](https://github.com/NicolaiDolmer/CyclingZone/issues/2677) [#2812](https://github.com/NicolaiDolmer/CyclingZone/issues/2812) [#2858](https://github.com/NicolaiDolmer/CyclingZone/issues/2858) [#2990](https://github.com/NicolaiDolmer/CyclingZone/issues/2990) [#2997](https://github.com/NicolaiDolmer/CyclingZone/issues/2997) [#2219](https://github.com/NicolaiDolmer/CyclingZone/issues/2219)
- **motor_balance** (13): [#1378](https://github.com/NicolaiDolmer/CyclingZone/issues/1378) [#1379](https://github.com/NicolaiDolmer/CyclingZone/issues/1379) [#2014](https://github.com/NicolaiDolmer/CyclingZone/issues/2014) [#2260](https://github.com/NicolaiDolmer/CyclingZone/issues/2260) [#2337](https://github.com/NicolaiDolmer/CyclingZone/issues/2337) [#2457](https://github.com/NicolaiDolmer/CyclingZone/issues/2457) [#2525](https://github.com/NicolaiDolmer/CyclingZone/issues/2525) [#2574](https://github.com/NicolaiDolmer/CyclingZone/issues/2574) [#2698](https://github.com/NicolaiDolmer/CyclingZone/issues/2698) [#2722](https://github.com/NicolaiDolmer/CyclingZone/issues/2722) [#2783](https://github.com/NicolaiDolmer/CyclingZone/issues/2783) [#2785](https://github.com/NicolaiDolmer/CyclingZone/issues/2785) [#2818](https://github.com/NicolaiDolmer/CyclingZone/issues/2818)
- **onboarding_retention** (12): [#1136](https://github.com/NicolaiDolmer/CyclingZone/issues/1136)(P1) [#1137](https://github.com/NicolaiDolmer/CyclingZone/issues/1137)(P1) [#1369](https://github.com/NicolaiDolmer/CyclingZone/issues/1369) [#1775](https://github.com/NicolaiDolmer/CyclingZone/issues/1775) [#1833](https://github.com/NicolaiDolmer/CyclingZone/issues/1833) [#1896](https://github.com/NicolaiDolmer/CyclingZone/issues/1896) [#2089](https://github.com/NicolaiDolmer/CyclingZone/issues/2089) [#2153](https://github.com/NicolaiDolmer/CyclingZone/issues/2153) [#2441](https://github.com/NicolaiDolmer/CyclingZone/issues/2441) [#2700](https://github.com/NicolaiDolmer/CyclingZone/issues/2700) [#2886](https://github.com/NicolaiDolmer/CyclingZone/issues/2886) [#2819](https://github.com/NicolaiDolmer/CyclingZone/issues/2819)
- **design_ui** (8): [#1576](https://github.com/NicolaiDolmer/CyclingZone/issues/1576) [#1602](https://github.com/NicolaiDolmer/CyclingZone/issues/1602) [#1884](https://github.com/NicolaiDolmer/CyclingZone/issues/1884) [#2227](https://github.com/NicolaiDolmer/CyclingZone/issues/2227) [#2254](https://github.com/NicolaiDolmer/CyclingZone/issues/2254) [#2403](https://github.com/NicolaiDolmer/CyclingZone/issues/2403) [#2791](https://github.com/NicolaiDolmer/CyclingZone/issues/2791) [#1979](https://github.com/NicolaiDolmer/CyclingZone/issues/1979)
- **andet** (7): [#483](https://github.com/NicolaiDolmer/CyclingZone/issues/483) [#490](https://github.com/NicolaiDolmer/CyclingZone/issues/490) [#1141](https://github.com/NicolaiDolmer/CyclingZone/issues/1141) [#1301](https://github.com/NicolaiDolmer/CyclingZone/issues/1301) [#2792](https://github.com/NicolaiDolmer/CyclingZone/issues/2792) [#2795](https://github.com/NicolaiDolmer/CyclingZone/issues/2795) [#2863](https://github.com/NicolaiDolmer/CyclingZone/issues/2863)
- **oekonomi** (6): [#1677](https://github.com/NicolaiDolmer/CyclingZone/issues/1677) [#2176](https://github.com/NicolaiDolmer/CyclingZone/issues/2176) [#2226](https://github.com/NicolaiDolmer/CyclingZone/issues/2226) [#2261](https://github.com/NicolaiDolmer/CyclingZone/issues/2261) [#2400](https://github.com/NicolaiDolmer/CyclingZone/issues/2400) [#2793](https://github.com/NicolaiDolmer/CyclingZone/issues/2793)
- **saesonplanlaegning** (4): [#1189](https://github.com/NicolaiDolmer/CyclingZone/issues/1189) [#1240](https://github.com/NicolaiDolmer/CyclingZone/issues/1240) [#2772](https://github.com/NicolaiDolmer/CyclingZone/issues/2772) [#3010](https://github.com/NicolaiDolmer/CyclingZone/issues/3010)
- **holdudtagelse** (3): [#2399](https://github.com/NicolaiDolmer/CyclingZone/issues/2399) [#2030](https://github.com/NicolaiDolmer/CyclingZone/issues/2030) [#2721](https://github.com/NicolaiDolmer/CyclingZone/issues/2721)

## Kræver ejer-beslutning (batches til beslutningssessioner) (49)

- [#103](https://github.com/NicolaiDolmer/CyclingZone/issues/103) **P1** [saesonplanlaegning] [investigate] Multi-year mål — tidlig opfyldelse og genforhandling
  - Flerårsmål-mekanik skal låses før S2 rigtigt aktiverer den — kræver ejer-beslutning nu.
- [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) **P1** [andet] Beslutning foer 20/6: PCM-dump-xlsx med rigtige rytternavne ligger synligt i public repo
  - Juridisk/licens-risiko: PCM-dump med rigtige navne offentligt i repo — ejer skal vælge A/B.
- [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) **P1** [oekonomi] Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer
  - Stor oekonomi-redesign (anti-inflation, gold sinks) kraever ejer-designbeslutning foer bygning; relevant til S2-oekonomi-verify men selve epic'en er e
- [#1614](https://github.com/NicolaiDolmer/CyclingZone/issues/1614) **P1** [holdudtagelse] Squad-cap display ≠ håndhævelse: Panic Board viser D2 20/D3 10, men cap er 30 for alle
  - Squad-cap display vs. haandhaevelse-mismatch er direkte holdudtagelses-relevant lige foer/efter divisionsskifte; kraever A/B-ejerbeslutning.
- [#2588](https://github.com/NicolaiDolmer/CyclingZone/issues/2588) **P1** [andet] [ejer] Påmindelse: A/B-valg + merge PR #2587 (scouting) · klik-test /training (#2578)
  - Udestående ejer-handling: A/B-valg + merge PR #2587 (scouting) + klik-test /training — hurtig, bør ryddes snart.
- [#2798](https://github.com/NicolaiDolmer/CyclingZone/issues/2798) **P1** [motor_balance] [design/balance] Markedsværdien afslører skjult potentiale — v4-værdien er en invertérbar sidek
  - v4-værdimodel afslører skjult potentiale via markedsværdi — kræver designbeslutning om scouting-fog.
- [#2799](https://github.com/NicolaiDolmer/CyclingZone/issues/2799) **P1** [motor_balance] [balance/HØJ] Markedsværdier eksploderede i halen efter v4-cutoveren — 350k-rytter nu 22M; medi
  - Markedsværdier eksploderet i halen efter v4-cutover (350k→22M). Kræver ejervalg om remediering før S2-økonomi sætter sig.
- [#2813](https://github.com/NicolaiDolmer/CyclingZone/issues/2813) **P1** [andet] [monetization] CZ Pro kan købes uden handelsbetingelser, opsigelsessti eller oplyst fortrydelse
  - CZ Pro sælges uden handelsbetingelser/fortrydelsesret — juridisk risiko, kræver ejer-beslutning om vilkår.
- [#2815](https://github.com/NicolaiDolmer/CyclingZone/issues/2815) **P1** [oekonomi] [balance/ux] Nye hold kan maksimere gældsloftet minutter efter oprettelse — 888k købekraft dag 
  - Nye hold kan maksimere gældsloft minutter efter oprettelse (888k dag ét). Balance-beslutning krævet før flere nye S2-hold rammer det.
- [#2910](https://github.com/NicolaiDolmer/CyclingZone/issues/2910) **P1** [saesonskifte] Saesonskiftet nulstiller ikke traethed — feltet starter S2 paa 86,7 af 100
  - Træthed nulstilles ikke ved skifte (gns 86,7/100) — spildesign-beslutning om hviledag kræver ejer-valg + sim.
- [#230](https://github.com/NicolaiDolmer/CyclingZone/issues/230) **P2** [oekonomi] [feature] Auto-cancel egne proxy-bud når man bliver outbiddet over max-loft
  - Auto-cancel proxy-bud har 3 designvarianter der konflikter med proxy-mental-model — kræver valg.
- [#401](https://github.com/NicolaiDolmer/CyclingZone/issues/401) **P2** [ops_infra] Migration-drift: schema.sql spejler kan kollidere med auto-migrate (post #392 postmortem)
  - Migration-drift mellem schema.sql og auto-migrate — symptom hotfixet i #400, root cause kræver arkitekturvalg (A/B).
- [#450](https://github.com/NicolaiDolmer/CyclingZone/issues/450) **P2** [oekonomi] [feature] Minimumspris på egne ryttere — passive floor mod spam-bud (Vman-style)
  - Balance-feature (min-pris floor) kræver designbeslutning om synlighed/præcedens før build.
- [#819](https://github.com/NicolaiDolmer/CyclingZone/issues/819) **P2** [oekonomi] Bestyrelsesforhandling mangler konsekvens/cap (kun upside ved at forhandle ned)
  - Bestyrelsesforhandling-cap kræver design-valg; ikke S2-uge1-kritisk.
- [#1235](https://github.com/NicolaiDolmer/CyclingZone/issues/1235) **P2** [saesonplanlaegning] [feature] Board: forhandle mål OP (high risk, high reward)
  - Kræver ejer-design af op-forhandlings-mekanik + samspil med satisfaction-design.
- [#1237](https://github.com/NicolaiDolmer/CyclingZone/issues/1237) **P2** [oekonomi] [feature] Board-økonomi: vurdér saldo vs gæld, ikke kun antal lån
  - Balance-følsom økonomi-vurdering (saldo vs gæld) kræver ejer-beslutning om formel.
- [#1595](https://github.com/NicolaiDolmer/CyclingZone/issues/1595) **P2** [andet] [forever] WS2-backend — PCM-sletning: fjern resultat-pipeline, behold stat_* som derive-kilde (
  - PCM-sletnings-scope modsiger egen spec; kraever ejer-beslutning om Option B foer implementation.
- [#1875](https://github.com/NicolaiDolmer/CyclingZone/issues/1875) **P2** [ops_infra] Sæt Vercel preview-env (VITE_PREVIEW_MOCK + sentinel) — aktivér self-serve mock-previews
  - Kræver ejer-handling i Vercel dashboard (env-vars); AI kan ikke udføre selv.
- [#1899](https://github.com/NicolaiDolmer/CyclingZone/issues/1899) **P2** [saesonplanlaegning] [beslutning] Skal seasons.race_days_total bumpes/gøres per-division når 140-generatoren lander?
  - Beslutning om race_days_total-bump kræver arkitektur-vurdering, ikke klar til build.
- [#1914](https://github.com/NicolaiDolmer/CyclingZone/issues/1914) **P2** [onboarding_retention] [help] To design-intent-uoverensstemmelser fundet i help-audit: fokus-slots (3 vs unlimited) + 
  - Help-tekst modsiger kode (fokus-slots, divisions-antal) — kræver ejer-valg om design-intent.
- [#1996](https://github.com/NicolaiDolmer/CyclingZone/issues/1996) **P2** [ops_infra] Ryd op i efterladt transfervindue-kode (én sandhed: altid-åbent marked)
  - Transfervindue-oprydning er claude:blocked + needs-decision — kræver ejer-input før arbejde.
- [#2152](https://github.com/NicolaiDolmer/CyclingZone/issues/2152) **P2** [oekonomi] Deadline Day er de-facto død efter transfervindue-afskaffelse: afvikl eller genarkitektér
  - Deadline Day de-facto død - ejer skal vælge afvikl vs. genarkitektér.
- [#2170](https://github.com/NicolaiDolmer/CyclingZone/issues/2170) **P2** [saesonplanlaegning] design(calendar): Monuments er binding-fri (game_day 100000+) — genovervej? rytter kan køre mon
  - Monuments binding-fri vs. rigtige game_days - designvalg om GT-overlap-realisme.
- [#2223](https://github.com/NicolaiDolmer/CyclingZone/issues/2223) **P2** [onboarding_retention] Rework af indbakke-UI: handling vs. information, gruppering pr. type
  - Indbakke-rework kræver design-session med ejer FØR byg - ikke S2-kritisk.
- [#2262](https://github.com/NicolaiDolmer/CyclingZone/issues/2262) **P2** [motor_balance] [balance] Trænings-rekalibrering: 19-20-årige talenter føles "dødfødte" (~7-8 stigninger/sæson)
  - Ejer har allerede kommenteret at kalibreringen er tilsigtet; kræver eksplicit ejer-valg om afstand-til-loft-model.
- [#2443](https://github.com/NicolaiDolmer/CyclingZone/issues/2443) **P2** [design_ui] [feature/IA] Menu-rework: side-inventar + kategorisering der matcher de nye undersider
  - Menu-rework kræver ejer-godkendt sideinventar+kategorisering før build; ikke cutover-kritisk.
- [#2445](https://github.com/NicolaiDolmer/CyclingZone/issues/2445) **P2** [design_ui] [ux] Responsivt layout: sider udnytter ikke skærmen (sæsonplanlægger, økonomi, bestyrelse, dash
  - Responsivt layout (planlægger/økonomi/bestyrelse/dashboard) kræver forslag+ejer-godkendelse først.
- [#2452](https://github.com/NicolaiDolmer/CyclingZone/issues/2452) **P2** [oekonomi] [feature/design] Auktions-gebyr: gratis ved udbudspris ≤50% af værdi, gebyr over
  - Auktions-gebyr-model (>50% af værdi) kræver ejer-valg af gebyrkurve før design/kode.
- [#2454](https://github.com/NicolaiDolmer/CyclingZone/issues/2454) **P2** [andet] [design] Potentiale: skift skala fra 1-6 til 1-99 så den matcher resten af spillet
  - Potentiale 1-6→1-99 kræver ejer-valg A/B (afgør om #1138 scouting-usikkerhed består).
- [#2622](https://github.com/NicolaiDolmer/CyclingZone/issues/2622) **P2** [saesonplanlaegning] [needs-decision] Auto-entry-generator fylder hele sæsonen proaktivt (8.841 entries) — indsnævre
  - Auto-entry-generators horisont (hele sæson vs. nære løb) kræver produktbeslutning af ejer.
- [#2678](https://github.com/NicolaiDolmer/CyclingZone/issues/2678) **P2** [ops_infra] [decision] 4 materialized views (ranglister/standings) er åbne for anon via API — bekræft offen
  - Kræver ejer-bekræftelse pr. matview (offentlig OK eller luk) før noget kan gøres.
- [#2680](https://github.com/NicolaiDolmer/CyclingZone/issues/2680) **P2** [ops_infra] AI-audit 19/7: Cowork-connector-toggles i dev-kanal (Ahrefs/Clarity/Calendar/Drive + uauth-MCP'
  - Kræver ejer-klik i Cowork-connector-UI, kan ikke gøres af Claude.
- [#2752](https://github.com/NicolaiDolmer/CyclingZone/issues/2752) **P2** [saesonskifte] Sæson-recap / "årbog" + aktiv sæson-lukning (UI-slice, udskilt fra #2361)
  - Sæson-recap/årbog kræver UI-mockup-godkendelse FØR byg — ejer-beslutning, ikke akut.
- [#2757](https://github.com/NicolaiDolmer/CyclingZone/issues/2757) **P2** [motor_balance] [balance] Pointtrøje: sprintpoint på bakke-/bjergetaper vægter for højt — flad-etape-vinder mis
  - Pointtrøje-vægtning kræver balance-beslutning + dry-run mod S1 før ship.
- [#2759](https://github.com/NicolaiDolmer/CyclingZone/issues/2759) **P2** [andet] [growth] Start Facebook-annoncer + organisk TikTok-markedsføring (ejer 20/7)
  - Facebook-ads/TikTok kræver ejer-godkendt copy+budget før noget går live.
- [#2760](https://github.com/NicolaiDolmer/CyclingZone/issues/2760) **P2** [onboarding_retention] [growth] Reaktiverings-e-mails (win-back) til dormante brugere + GDPR-consent-audit FØRST (ejer
  - GDPR-consent skal afklares FØR win-back-mails sendes — ejer-beslutning.
- [#2840](https://github.com/NicolaiDolmer/CyclingZone/issues/2840) **P2** [oekonomi] Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte ryttere gr
  - Dagsbaseret løn er stor motor-ændring; ejer må vælge model foer build. Ikke cutover-kritisk.
- [#2853](https://github.com/NicolaiDolmer/CyclingZone/issues/2853) **P2** [onboarding_retention] Flip e-mail-retention-loopet live (tekst-godkendelse + 2 Railway-keys + off->dry_run->on)
  - Blokeret af ejer: tekst-godkendelse + 2 Railway-keys mangler foer flip.
- [#2856](https://github.com/NicolaiDolmer/CyclingZone/issues/2856) **P2** [oekonomi] [balance/data] #2694-opfølgning: historisk holdklassement-reparation (<3-finisher-hold) — ejer-
  - Destruktiv historisk point/prize-reparation kræver ejer-godkendt dry-run foer kørsel.
- [#2884](https://github.com/NicolaiDolmer/CyclingZone/issues/2884) **P2** [oekonomi] [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vinduet gø
  - Auktionsvarighed udfordrer tidligere Discord-konsensus (#1189) — kræver nyt ejer-valg med de nye WAU-tal.
- [#2885](https://github.com/NicolaiDolmer/CyclingZone/issues/2885) **P2** [oekonomi] [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan komme a
  - Sælg-til-AI kræver prisgulv-designbeslutning (exploit-risiko mod #1281/#2670) foer build.
- [#2944](https://github.com/NicolaiDolmer/CyclingZone/issues/2944) **P2** [motor_balance] [balance/design] Styrt er binære (crashed = intet resultat) og opleves for hyppige
  - Styrt er binære (DNF) og opleves for hyppige — balance-følsom design-beslutning kræver ejer-valg + sim før ændring.
- [#3020](https://github.com/NicolaiDolmer/CyclingZone/issues/3020) **P2** [oekonomi] Divisionsvælgeren i sponsorvalget svarer ikke på det spørgsmål spillerne stiller (ens loft på t
  - Sponsor-divisionsvælger svarer ikke på spillerens reelle spørgsmål — kræver designbeslutning om semantik.
- [#17](https://github.com/NicolaiDolmer/CyclingZone/issues/17) **P3** [oekonomi] [design] Lån — skal renter starte med det samme + skal gebyr betales kontant?
  - Design-spørgsmål om lånerenter/gebyr, ikke bug. Ingen cutover-relevans, afventer ejer-beslutning.
- [#976](https://github.com/NicolaiDolmer/CyclingZone/issues/976) **P3** [design_ui] UX/IA: fold Min Aktivitet ind i Indbakke + Transfers (mental model)
  - IA-omstrukturering kræver produktbeslutning før kode (needs-decision).
- [#1283](https://github.com/NicolaiDolmer/CyclingZone/issues/1283) **P3** [andet] ToV-session: definér founder-stemmen (ejer-ledet) — struktur fra AI, prosa fra Nicolai
  - Founder-stemme-session kræver ejerens egen prosa/deltagelse, ikke AI-arbejde.
- [#2688](https://github.com/NicolaiDolmer/CyclingZone/issues/2688) **P3** [ops_infra] AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer-valg)
  - Fire AI-workflow-håndtag, kræver ejer-valg om pilotering, ingen deadline.
- [#2887](https://github.com/NicolaiDolmer/CyclingZone/issues/2887) **P3** [motor_balance] [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den decline?
  - Sportsdirektør-træningsstat-effekt er en investigation/balance-spørgsmål der kræver ejer-retning.
- [#2946](https://github.com/NicolaiDolmer/CyclingZone/issues/2946) **P3** [holdudtagelse] [beslutning] Skal akademi-ryttere kunne sælges direkte? (i dag: promover først)
  - Design-spørgsmål: skal akademi-ryttere sælges direkte? Kræver ejer-valg, ikke tidskritisk.

## Sandsynligvis allerede løst — verificér og luk (bæredygtig nedbringelse) (30)

- [#2589](https://github.com/NicolaiDolmer/CyclingZone/issues/2589) **P0** [saesonskifte] [bug] Pending sponsor-valg fryser per-dag-rate med gammel 60-dages-divisor — aktiveres ukorrige
- [#1299](https://github.com/NicolaiDolmer/CyclingZone/issues/1299) **P1** [design_ui] Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch
- [#2075](https://github.com/NicolaiDolmer/CyclingZone/issues/2075) **P1** [saesonskifte] [task] Division 4 første-manager-beredskab FØR TdF: pre-fyld AI off-request, håndtér forpassere
- [#2161](https://github.com/NicolaiDolmer/CyclingZone/issues/2161) **P1** [onboarding_retention] feat(auth): Log ind / opret bruger / connect med Discord (OAuth via Supabase)
- [#2603](https://github.com/NicolaiDolmer/CyclingZone/issues/2603) **P1** [design_ui] [bug] Mobil-visning: layout-problem på skærm (ejer-screenshot 17/7)
- [#2745](https://github.com/NicolaiDolmer/CyclingZone/issues/2745) **P1** [saesonskifte] season_ended in-app notifikation emitteres aldrig (død hook)
- [#2754](https://github.com/NicolaiDolmer/CyclingZone/issues/2754) **P1** [andet] [HASTER i aften] Auktions-close 20/7 ~22:53: nerf-beslutning, bud-politik + YTH-academy-guard v
- [#2825](https://github.com/NicolaiDolmer/CyclingZone/issues/2825) **P1** [saesonskifte] [plan] Session-koe frem til saesonskiftet 27/7 — 8 sessions med klar-til-brug prompts
- [#2835](https://github.com/NicolaiDolmer/CyclingZone/issues/2835) **P1** [saesonskifte] retirement: pensionerede ryttere beholder team_id og optager truppladser for evigt (cutover-rel
- [#2883](https://github.com/NicolaiDolmer/CyclingZone/issues/2883) **P1** [saesonplanlaegning] [ux/HØJ] Sæsonplanlæggeren er ubrugelig for de mest aktive testere — kan ikke skifte 1→2 toppe,
- [#2889](https://github.com/NicolaiDolmer/CyclingZone/issues/2889) **P1** [onboarding_retention] [help] Hvornår starter og slutter sæsonen økonomisk? (løn, sponsorpenge) — ubesvaret spørgsmål 
- [#2894](https://github.com/NicolaiDolmer/CyclingZone/issues/2894) **P1** [oekonomi] [bug] starterSquadAllocator saetter aldrig loen — nye hold faar gratis trup (kilden bag #2746)
- [#2902](https://github.com/NicolaiDolmer/CyclingZone/issues/2902) **P1** [oekonomi] [investigation] 1.327 ryttere paa menneskehold har contract_end_season IS NULL — er det design 
- [#2925](https://github.com/NicolaiDolmer/CyclingZone/issues/2925) **P1** [onboarding_retention] "Saeson 2 — kom i gang"-kort: fire beslutninger venter mandag, spredt over fire sider uden guid
- [#1279](https://github.com/NicolaiDolmer/CyclingZone/issues/1279) **P2** [andet] GO/NO-GO-gate ~11/7: beslutningsissue med evidens-checkliste + user-interview-plan
- [#2076](https://github.com/NicolaiDolmer/CyclingZone/issues/2076) **P2** [ops_infra] [ops/ejer] Uptime-monitor på /health + cyclingzone.org + Sentry→Discord-alert (15 min opsætning
- [#2085](https://github.com/NicolaiDolmer/CyclingZone/issues/2085) **P2** [ops_infra] [ejer/email] Før TdF: verificér Resend-kvote (Pro?) + hæv Supabase Auth email-rate-limit (defau
- [#2165](https://github.com/NicolaiDolmer/CyclingZone/issues/2165) **P2** [design_ui] [bug] Layout fejl ved flytning af rytter til akademiet
- [#2675](https://github.com/NicolaiDolmer/CyclingZone/issues/2675) **P2** [oekonomi] [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-valg om
- [#2744](https://github.com/NicolaiDolmer/CyclingZone/issues/2744) **P2** [saesonskifte] Rytterkontrakt-udløb → fri-agent-marked ved sæsonskifte
- [#2748](https://github.com/NicolaiDolmer/CyclingZone/issues/2748) **P2** [saesonskifte] Pensionering: forvarsel + squad-minimum-check ved masse-retirement
- [#2770](https://github.com/NicolaiDolmer/CyclingZone/issues/2770) **P2** [motor_balance] [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder
- [#2888](https://github.com/NicolaiDolmer/CyclingZone/issues/2888) **P2** [design_ui] [ux] Holdsiden: fjern potentiale-teksten, vis rating som tal, og gør stats læsbare uden at scro
- [#2906](https://github.com/NicolaiDolmer/CyclingZone/issues/2906) **P2** [design_ui] [design] Mit Hold-løft: alle 15 evner synlige samtidig, rating-kolonne, lavere rækker
- [#264](https://github.com/NicolaiDolmer/CyclingZone/issues/264) **P3** [andet] [feature] Discord: dedikeret kanal til sæsonstart/slut + transfervindue-events
- [#671](https://github.com/NicolaiDolmer/CyclingZone/issues/671) **P3** [design_ui] Brand minimum: accent + font + wordmark (TdF-deadline subset af #481)
- [#672](https://github.com/NicolaiDolmer/CyclingZone/issues/672) **P3** [design_ui] Landing page polish + founder waitlist (TdF-ready)
- [#677](https://github.com/NicolaiDolmer/CyclingZone/issues/677) **P3** [andet] Fiktive ryttere V2: stats via ny ability-model (efter #676)
- [#680](https://github.com/NicolaiDolmer/CyclingZone/issues/680) **P3** [andet] EPIC: TdF 2026 Launch Sprint (hard deadline 2026-06-20)
- [#1304](https://github.com/NicolaiDolmer/CyclingZone/issues/1304) **P3** [andet] Ejer-huskeliste 11/6: GA4-deploy blokeret af Vercel-kvote + domæne/analytics-opfølgninger

## Kill-kandidater (LUKKES IKKE uden ejer-ja — jf. mandat 26/7) (8)

- [#738](https://github.com/NicolaiDolmer/CyclingZone/issues/738) **P3** [ops_infra] Decide whether to remove McAfee and confirm Defender protection
  - Lokal maskine-antivirus-valg, ingen relation til spillet/produktet.
- [#739](https://github.com/NicolaiDolmer/CyclingZone/issues/739) **P3** [ops_infra] Adopt a stable Node version strategy for Windows development
  - Node-version-strategi, rent ops-housekeeping uden hastværk.
- [#1679](https://github.com/NicolaiDolmer/CyclingZone/issues/1679) **P3** [andet] [feature] Se andre holds træning på deres ryttere
  - Se andre holds traening — lav vaerdi/indsats for 161 brugere, over-engineering ift. kerneloop.
- [#1905](https://github.com/NicolaiDolmer/CyclingZone/issues/1905) **P3** [andet] [feature] Lad spillere vælge hvornår deres auktion slutter
  - Balance-følsom auktions-tidsvalg-feature uden konkret behov endnu; over-scope for 161 brugere nu.
- [#2080](https://github.com/NicolaiDolmer/CyclingZone/issues/2080) **P3** [andet] [marketing] TdF-kampagne 48-timers beredskab: 3 post-drafts + creator-liste + UTM-konvention + 
  - TdF-marketingkampagne målrettet 4/7-vindue, allerede uger forpasset - død.
- [#2479](https://github.com/NicolaiDolmer/CyclingZone/issues/2479) **P3** [motor_balance] Research-spike: W'/Critical Power-fysiologimodel i dry-run-harnesset (fatigue v4-kandidat — shi
  - Research-spike (ship intet) om W'/CP-fysiologimodel; for tidligt/ambitiøst ift. nuværende skala.
- [#2480](https://github.com/NicolaiDolmer/CyclingZone/issues/2480) **P3** [ops_infra] Motor-ops: ML-assisteret kalibreringsforslag fra live drift (systemet foreslår, ejer beslutter)
  - ML-assisteret kalibreringsforslag er over-engineering til 161 brugere; drift-vagten (#2414) alene er nok.
- [#2991](https://github.com/NicolaiDolmer/CyclingZone/issues/2991) **P3** [holdudtagelse] season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og D1 er
  - Uopnåeligt achievement i 2+ sæsoner for alle — lavt spillerantal (161) gør fix lav værdi ift. indsats; evt. bare fjern/skjul.

## Efter sæson 2 (206)

- **ops_infra** (67): [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323) [#330](https://github.com/NicolaiDolmer/CyclingZone/issues/330) [#332](https://github.com/NicolaiDolmer/CyclingZone/issues/332) [#333](https://github.com/NicolaiDolmer/CyclingZone/issues/333) [#374](https://github.com/NicolaiDolmer/CyclingZone/issues/374) [#519](https://github.com/NicolaiDolmer/CyclingZone/issues/519) [#520](https://github.com/NicolaiDolmer/CyclingZone/issues/520) [#530](https://github.com/NicolaiDolmer/CyclingZone/issues/530) [#621](https://github.com/NicolaiDolmer/CyclingZone/issues/621) [#748](https://github.com/NicolaiDolmer/CyclingZone/issues/748) [#1182](https://github.com/NicolaiDolmer/CyclingZone/issues/1182) [#1270](https://github.com/NicolaiDolmer/CyclingZone/issues/1270) [#1373](https://github.com/NicolaiDolmer/CyclingZone/issues/1373) [#1374](https://github.com/NicolaiDolmer/CyclingZone/issues/1374) [#1528](https://github.com/NicolaiDolmer/CyclingZone/issues/1528) [#2095](https://github.com/NicolaiDolmer/CyclingZone/issues/2095) [#2096](https://github.com/NicolaiDolmer/CyclingZone/issues/2096) [#2635](https://github.com/NicolaiDolmer/CyclingZone/issues/2635) [#2685](https://github.com/NicolaiDolmer/CyclingZone/issues/2685) [#2687](https://github.com/NicolaiDolmer/CyclingZone/issues/2687) [#2738](https://github.com/NicolaiDolmer/CyclingZone/issues/2738) [#2758](https://github.com/NicolaiDolmer/CyclingZone/issues/2758) [#2779](https://github.com/NicolaiDolmer/CyclingZone/issues/2779) [#2800](https://github.com/NicolaiDolmer/CyclingZone/issues/2800) [#2817](https://github.com/NicolaiDolmer/CyclingZone/issues/2817) [#2871](https://github.com/NicolaiDolmer/CyclingZone/issues/2871) [#2897](https://github.com/NicolaiDolmer/CyclingZone/issues/2897) [#2900](https://github.com/NicolaiDolmer/CyclingZone/issues/2900) [#2922](https://github.com/NicolaiDolmer/CyclingZone/issues/2922) [#2923](https://github.com/NicolaiDolmer/CyclingZone/issues/2923) [#3022](https://github.com/NicolaiDolmer/CyclingZone/issues/3022) [#78](https://github.com/NicolaiDolmer/CyclingZone/issues/78) [#88](https://github.com/NicolaiDolmer/CyclingZone/issues/88) [#288](https://github.com/NicolaiDolmer/CyclingZone/issues/288) [#306](https://github.com/NicolaiDolmer/CyclingZone/issues/306) [#331](https://github.com/NicolaiDolmer/CyclingZone/issues/331) [#347](https://github.com/NicolaiDolmer/CyclingZone/issues/347) [#355](https://github.com/NicolaiDolmer/CyclingZone/issues/355) [#414](https://github.com/NicolaiDolmer/CyclingZone/issues/414) [#528](https://github.com/NicolaiDolmer/CyclingZone/issues/528) [#658](https://github.com/NicolaiDolmer/CyclingZone/issues/658) [#722](https://github.com/NicolaiDolmer/CyclingZone/issues/722) [#723](https://github.com/NicolaiDolmer/CyclingZone/issues/723) [#724](https://github.com/NicolaiDolmer/CyclingZone/issues/724) [#904](https://github.com/NicolaiDolmer/CyclingZone/issues/904) [#1199](https://github.com/NicolaiDolmer/CyclingZone/issues/1199) [#1290](https://github.com/NicolaiDolmer/CyclingZone/issues/1290) [#1375](https://github.com/NicolaiDolmer/CyclingZone/issues/1375) [#1450](https://github.com/NicolaiDolmer/CyclingZone/issues/1450) [#1466](https://github.com/NicolaiDolmer/CyclingZone/issues/1466) [#1473](https://github.com/NicolaiDolmer/CyclingZone/issues/1473) [#1857](https://github.com/NicolaiDolmer/CyclingZone/issues/1857) [#1879](https://github.com/NicolaiDolmer/CyclingZone/issues/1879) [#2188](https://github.com/NicolaiDolmer/CyclingZone/issues/2188) [#2233](https://github.com/NicolaiDolmer/CyclingZone/issues/2233) [#2259](https://github.com/NicolaiDolmer/CyclingZone/issues/2259) [#2409](https://github.com/NicolaiDolmer/CyclingZone/issues/2409) [#2683](https://github.com/NicolaiDolmer/CyclingZone/issues/2683) [#2684](https://github.com/NicolaiDolmer/CyclingZone/issues/2684) [#2686](https://github.com/NicolaiDolmer/CyclingZone/issues/2686) [#2765](https://github.com/NicolaiDolmer/CyclingZone/issues/2765) [#2823](https://github.com/NicolaiDolmer/CyclingZone/issues/2823) [#2828](https://github.com/NicolaiDolmer/CyclingZone/issues/2828) [#2847](https://github.com/NicolaiDolmer/CyclingZone/issues/2847) [#2857](https://github.com/NicolaiDolmer/CyclingZone/issues/2857) [#2960](https://github.com/NicolaiDolmer/CyclingZone/issues/2960) [#3024](https://github.com/NicolaiDolmer/CyclingZone/issues/3024)
- **andet** (52): [#844](https://github.com/NicolaiDolmer/CyclingZone/issues/844) [#931](https://github.com/NicolaiDolmer/CyclingZone/issues/931) [#932](https://github.com/NicolaiDolmer/CyclingZone/issues/932) [#939](https://github.com/NicolaiDolmer/CyclingZone/issues/939) [#954](https://github.com/NicolaiDolmer/CyclingZone/issues/954) [#959](https://github.com/NicolaiDolmer/CyclingZone/issues/959) [#1021](https://github.com/NicolaiDolmer/CyclingZone/issues/1021) [#1099](https://github.com/NicolaiDolmer/CyclingZone/issues/1099) [#2064](https://github.com/NicolaiDolmer/CyclingZone/issues/2064) [#2356](https://github.com/NicolaiDolmer/CyclingZone/issues/2356) [#2398](https://github.com/NicolaiDolmer/CyclingZone/issues/2398) [#2806](https://github.com/NicolaiDolmer/CyclingZone/issues/2806) [#2816](https://github.com/NicolaiDolmer/CyclingZone/issues/2816) [#2820](https://github.com/NicolaiDolmer/CyclingZone/issues/2820) [#2822](https://github.com/NicolaiDolmer/CyclingZone/issues/2822) [#27](https://github.com/NicolaiDolmer/CyclingZone/issues/27) [#91](https://github.com/NicolaiDolmer/CyclingZone/issues/91) [#165](https://github.com/NicolaiDolmer/CyclingZone/issues/165) [#227](https://github.com/NicolaiDolmer/CyclingZone/issues/227) [#266](https://github.com/NicolaiDolmer/CyclingZone/issues/266) [#415](https://github.com/NicolaiDolmer/CyclingZone/issues/415) [#435](https://github.com/NicolaiDolmer/CyclingZone/issues/435) [#492](https://github.com/NicolaiDolmer/CyclingZone/issues/492) [#930](https://github.com/NicolaiDolmer/CyclingZone/issues/930) [#933](https://github.com/NicolaiDolmer/CyclingZone/issues/933) [#934](https://github.com/NicolaiDolmer/CyclingZone/issues/934) [#935](https://github.com/NicolaiDolmer/CyclingZone/issues/935) [#936](https://github.com/NicolaiDolmer/CyclingZone/issues/936) [#1108](https://github.com/NicolaiDolmer/CyclingZone/issues/1108) [#1109](https://github.com/NicolaiDolmer/CyclingZone/issues/1109) [#1111](https://github.com/NicolaiDolmer/CyclingZone/issues/1111) [#1112](https://github.com/NicolaiDolmer/CyclingZone/issues/1112) [#1113](https://github.com/NicolaiDolmer/CyclingZone/issues/1113) [#1147](https://github.com/NicolaiDolmer/CyclingZone/issues/1147) [#1148](https://github.com/NicolaiDolmer/CyclingZone/issues/1148) [#1149](https://github.com/NicolaiDolmer/CyclingZone/issues/1149) [#1154](https://github.com/NicolaiDolmer/CyclingZone/issues/1154) [#1341](https://github.com/NicolaiDolmer/CyclingZone/issues/1341) [#1407](https://github.com/NicolaiDolmer/CyclingZone/issues/1407) [#1815](https://github.com/NicolaiDolmer/CyclingZone/issues/1815) [#1837](https://github.com/NicolaiDolmer/CyclingZone/issues/1837) [#1888](https://github.com/NicolaiDolmer/CyclingZone/issues/1888) [#1977](https://github.com/NicolaiDolmer/CyclingZone/issues/1977) [#1997](https://github.com/NicolaiDolmer/CyclingZone/issues/1997) [#2063](https://github.com/NicolaiDolmer/CyclingZone/issues/2063) [#2477](https://github.com/NicolaiDolmer/CyclingZone/issues/2477) [#2490](https://github.com/NicolaiDolmer/CyclingZone/issues/2490) [#2491](https://github.com/NicolaiDolmer/CyclingZone/issues/2491) [#2493](https://github.com/NicolaiDolmer/CyclingZone/issues/2493) [#2494](https://github.com/NicolaiDolmer/CyclingZone/issues/2494) [#2495](https://github.com/NicolaiDolmer/CyclingZone/issues/2495) [#2838](https://github.com/NicolaiDolmer/CyclingZone/issues/2838)
- **onboarding_retention** (20): [#62](https://github.com/NicolaiDolmer/CyclingZone/issues/62) [#409](https://github.com/NicolaiDolmer/CyclingZone/issues/409) [#413](https://github.com/NicolaiDolmer/CyclingZone/issues/413) [#938](https://github.com/NicolaiDolmer/CyclingZone/issues/938) [#956](https://github.com/NicolaiDolmer/CyclingZone/issues/956) [#957](https://github.com/NicolaiDolmer/CyclingZone/issues/957) [#961](https://github.com/NicolaiDolmer/CyclingZone/issues/961) [#1173](https://github.com/NicolaiDolmer/CyclingZone/issues/1173) [#1922](https://github.com/NicolaiDolmer/CyclingZone/issues/1922) [#2236](https://github.com/NicolaiDolmer/CyclingZone/issues/2236) [#419](https://github.com/NicolaiDolmer/CyclingZone/issues/419) [#424](https://github.com/NicolaiDolmer/CyclingZone/issues/424) [#425](https://github.com/NicolaiDolmer/CyclingZone/issues/425) [#426](https://github.com/NicolaiDolmer/CyclingZone/issues/426) [#427](https://github.com/NicolaiDolmer/CyclingZone/issues/427) [#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428) [#430](https://github.com/NicolaiDolmer/CyclingZone/issues/430) [#431](https://github.com/NicolaiDolmer/CyclingZone/issues/431) [#1981](https://github.com/NicolaiDolmer/CyclingZone/issues/1981) [#2209](https://github.com/NicolaiDolmer/CyclingZone/issues/2209)
- **design_ui** (19): [#1027](https://github.com/NicolaiDolmer/CyclingZone/issues/1027)(P1) [#479](https://github.com/NicolaiDolmer/CyclingZone/issues/479) [#955](https://github.com/NicolaiDolmer/CyclingZone/issues/955) [#1011](https://github.com/NicolaiDolmer/CyclingZone/issues/1011) [#1033](https://github.com/NicolaiDolmer/CyclingZone/issues/1033) [#2000](https://github.com/NicolaiDolmer/CyclingZone/issues/2000) [#2230](https://github.com/NicolaiDolmer/CyclingZone/issues/2230) [#2442](https://github.com/NicolaiDolmer/CyclingZone/issues/2442) [#2583](https://github.com/NicolaiDolmer/CyclingZone/issues/2583) [#2762](https://github.com/NicolaiDolmer/CyclingZone/issues/2762) [#50](https://github.com/NicolaiDolmer/CyclingZone/issues/50) [#481](https://github.com/NicolaiDolmer/CyclingZone/issues/481) [#2006](https://github.com/NicolaiDolmer/CyclingZone/issues/2006) [#2009](https://github.com/NicolaiDolmer/CyclingZone/issues/2009) [#2046](https://github.com/NicolaiDolmer/CyclingZone/issues/2046) [#2178](https://github.com/NicolaiDolmer/CyclingZone/issues/2178) [#2666](https://github.com/NicolaiDolmer/CyclingZone/issues/2666) [#2810](https://github.com/NicolaiDolmer/CyclingZone/issues/2810) [#2859](https://github.com/NicolaiDolmer/CyclingZone/issues/2859)
- **oekonomi** (17): [#908](https://github.com/NicolaiDolmer/CyclingZone/issues/908) [#986](https://github.com/NicolaiDolmer/CyclingZone/issues/986) [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310) [#1903](https://github.com/NicolaiDolmer/CyclingZone/issues/1903) [#2667](https://github.com/NicolaiDolmer/CyclingZone/issues/2667) [#2736](https://github.com/NicolaiDolmer/CyclingZone/issues/2736) [#26](https://github.com/NicolaiDolmer/CyclingZone/issues/26) [#941](https://github.com/NicolaiDolmer/CyclingZone/issues/941) [#1150](https://github.com/NicolaiDolmer/CyclingZone/issues/1150) [#1151](https://github.com/NicolaiDolmer/CyclingZone/issues/1151) [#1281](https://github.com/NicolaiDolmer/CyclingZone/issues/1281) [#1818](https://github.com/NicolaiDolmer/CyclingZone/issues/1818) [#2217](https://github.com/NicolaiDolmer/CyclingZone/issues/2217) [#2218](https://github.com/NicolaiDolmer/CyclingZone/issues/2218) [#2222](https://github.com/NicolaiDolmer/CyclingZone/issues/2222) [#2670](https://github.com/NicolaiDolmer/CyclingZone/issues/2670) [#2753](https://github.com/NicolaiDolmer/CyclingZone/issues/2753)
- **motor_balance** (17): [#1293](https://github.com/NicolaiDolmer/CyclingZone/issues/1293) [#1294](https://github.com/NicolaiDolmer/CyclingZone/issues/1294) [#2416](https://github.com/NicolaiDolmer/CyclingZone/issues/2416) [#2768](https://github.com/NicolaiDolmer/CyclingZone/issues/2768) [#1176](https://github.com/NicolaiDolmer/CyclingZone/issues/1176) [#1208](https://github.com/NicolaiDolmer/CyclingZone/issues/1208) [#1688](https://github.com/NicolaiDolmer/CyclingZone/issues/1688) [#2354](https://github.com/NicolaiDolmer/CyclingZone/issues/2354) [#2388](https://github.com/NicolaiDolmer/CyclingZone/issues/2388) [#2410](https://github.com/NicolaiDolmer/CyclingZone/issues/2410) [#2412](https://github.com/NicolaiDolmer/CyclingZone/issues/2412) [#2415](https://github.com/NicolaiDolmer/CyclingZone/issues/2415) [#2417](https://github.com/NicolaiDolmer/CyclingZone/issues/2417) [#2476](https://github.com/NicolaiDolmer/CyclingZone/issues/2476) [#2478](https://github.com/NicolaiDolmer/CyclingZone/issues/2478) [#2527](https://github.com/NicolaiDolmer/CyclingZone/issues/2527) [#2582](https://github.com/NicolaiDolmer/CyclingZone/issues/2582)
- **saesonplanlaegning** (9): [#2274](https://github.com/NicolaiDolmer/CyclingZone/issues/2274) [#2489](https://github.com/NicolaiDolmer/CyclingZone/issues/2489) [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492) [#2747](https://github.com/NicolaiDolmer/CyclingZone/issues/2747) [#94](https://github.com/NicolaiDolmer/CyclingZone/issues/94) [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) [#1239](https://github.com/NicolaiDolmer/CyclingZone/issues/1239) [#1712](https://github.com/NicolaiDolmer/CyclingZone/issues/1712) [#2604](https://github.com/NicolaiDolmer/CyclingZone/issues/2604)
- **holdudtagelse** (5): [#1110](https://github.com/NicolaiDolmer/CyclingZone/issues/1110) [#2487](https://github.com/NicolaiDolmer/CyclingZone/issues/2487) [#2488](https://github.com/NicolaiDolmer/CyclingZone/issues/2488) [#2794](https://github.com/NicolaiDolmer/CyclingZone/issues/2794) [#1177](https://github.com/NicolaiDolmer/CyclingZone/issues/1177)

## Sådan når vi ~200 (bæredygtigt, 7-14 dage)

1. **Done-pipeline holdes tom:** 21 tilbage med `claude:done` (7 cutover-gated → lukkes efter i aften; 5 ejer-spot-checks; 9 nye move-to-done). Ugentlig sweep lukker dem løbende.
2. **"Allerede løst"-verifikation:** 60+ kandidater ovenfor — én fokuseret session med spot-verify (samme metode som i dag) lukker realistisk 30-50.
3. **Ejer-beslutnings-batch:** 49 issues venter reelt kun på et A/B-valg fra dig. To beslutningssessioner à 30 min rydder hovedparten (beslut → byg eller luk).
4. **Udfør s2_uge1-sporet** i bølger som bølge 3+4 (14-30 PR/bølge er dokumenteret kapacitet).
5. **Kill-listen (8) + efter_s2-sanering** tages som separat ejer-session når cutover er overstået.