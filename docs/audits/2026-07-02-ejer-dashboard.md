# Ejer-dashboard 2026-07-02 — Forretningsplan + fuld backlog-audit

> Strategi-session 2/7 (Claude Code): fuld audit af 339 åbne issues (38-agent workflow, 12 prod-prober), Discord-sweep begge servere, plan-sammensmeltning. Dette dokument er planens SSOT indtil næste re-plan; issues er execution-sandheden.

## Nøgletal (2/7)

| Metrik | Værdi |
|---|---|
| Brugere | **96** (+9 sidste døgn, +57 på 7 dage, 63 aktive/uge) |
| Discord | 127 (Cycling Career) / 41 (ny Cycling Zone-server) |
| NPS | +50 (n=6 — for lille endnu; virker og samler ind) |
| Backlog | 339 åbne → 10 lukket i dag, 16 nye (#2070-#2086), 42 kill-kandidater afventer godkendelse |

## P0-incident (30/6-2/7) — spillet stod reelt stille

Division 4-aktiveringen (263→455 løb) fik `updateStandings` til at fejle på hvert etape-run → rangliste frosset 30/6, 13 løb ufinaliserede, **1,43M CZ$ præmier tilbageholdt**, 0 resultater siden 1/7 17:04 UTC. Rod-årsag reproduceret og fixet i **PR #2087** (afventer ejer-merge) — derefter heler systemet sig selv (recovery + auto-prize + standings-rederivation). Fuld analyse: #2071 + postmortem `.claude/learnings/2026-07-02-updatestandings-url-limit-p0.md`. GC-beregningsfejlen spillerne fandt i Vuelta Burgalesa er en SEPARAT arkitektur-bug (#2072, deadline før 14/7).

## Leveret i dag (2/7)

- **PR #2069 merged:** signup-fix (resend-knap + auto-hold-oprettelse efter confirm) — konverterings-kritisk før TdF.
- **PR #1909 merged:** CZ Pro Slice 1 (Alunta checkout + entitlement + Founder-badge + /pro). Go-live gated på ejerens Alunta-opsætning (#1903-tråden).
- **PR #2087 klar:** P0-hotfix (5 koordinerede fixes), 2498/2498 backend-tests, afventer merge.
- 16 nye issues fra prod-prober (#2070-#2086) · 10 verificerede lukninger · 5 label-korrektioner · Discord-sweep filet.

## Tidsfaset plan (sammensmeltet med docs/PLAN.md, BUSINESS_STRATEGY.md, TDF_2026_LAUNCH_PLAN.md)

### I DAG / I MORGEN (2-3/7) — stop blødningen, åbn vinduet
1. **Merge #2087** (ejer-klik) → prod-verifikation af selv-heling (13 løb completed, præmier udbetalt, rangliste frisk) → incident-besked til spillerne (Discord + patch note).
2. **Ejer-kvarter (6 klik-opgaver):** #2076 uptime+Sentry→Discord · #2085 Resend-kvote + Supabase mail-rate-limit · #1784 Vercel spend-cap · #929 leaked-password-toggle · `railway login` · Alunta-plan + tokens i Infisical (CZ Pro go-live-gate).
3. **#2080 TdF-kampagnepakke** (Claude drafter, ejer godkender): 3 posts + creator-liste + UTM-plan — POSTES 4/7.
4. **#2079 attribution-fix + prod-verify** — kampagnen må ikke måles blindt.
5. Småting: #2070 "Du fører", #2078 otp_expired-fix.

### 3 DAGE (til 5/7) — TdF-åbningen
- #2075 division 4-beredskab (pre-fyld AI off-request, forpasserede løbsdage, concurrency) — 8 pladser tilbage i div 3!
- #2074 La Corsa-startfelt · #2073 is_u25-backfill · #1799 akademi-signering · #2045 sprogskift-blink · #1775 AI-holdnavne · #672-rest (landing).
- CZ Pro test_mode-køb verificeret → åbn salget (beslutning 3 nedenfor).

### 7 DAGE (til 9/7) — troværdighed + retention
- **#2072 GC-akkumulering + #2081 samlet stilling undervejs** (bygges sammen; SKAL være live før Giro della Penisola 14/7).
- #1856 scheduler-overlap · #2029 GT-etape-mix (5 ITT) · #1995 holdskifte-i-løb (option c) + #2086 sletnings-guard.
- #2077 stall-watchdog + ops-kanal · #413 EN auth-mails · #1461 DMARC · #2084 welcome-mail (D0).
- Discord-migration: FRYS til efter 27/7 (kampagne-invite-links må ikke dø midt i TdF).

### 14 DAGE (til 16/7)
- Resultat-hub design-session (#959 V2-rest — "alt for uoverskueligt at finde resultater").
- #2082 trænings-harness-fix → scorecard → **ejer-beslutning om nerf** (16-19-årige vokser 34 pt/uge; voksne 23+ er nær-døde, jf. #1974 — målrettet, ikke flad nedskalering).
- Rytterprofil #2000: færdiggør fanerne på draft-PR #2037 (Udvikling → Resultater → Historik → Interesse).
- #135 retention-scorecard + churn-overblik (nye brugere pr. dag/uge/måned-flade til admin).
- 11/7: GO/NO-GO (#1279) på betalt marketing baseret på attribution + D7.
- #1299 OG-etapekort + #1173 referral-loop hvis kampagnen trækker.

### 1 MÅNED (juli ud)
- Monetisering LIVE: CZ Pro-salg åbent, første betalinger; fair-freemium-kommunikation (aldrig P2W).
- Trænings-nerf shippet (efter harness + ejer-go) · akademi-rest (#932: #2032 m.fl.) · rytterprofil-capstone (hero).
- Discord-migration udføres (webhooks flyttes, gamle lukkes) · admin-flader dimensioneret til 250-1.000 managers.
- Mobil-quick-wins (#479) · PUBLIC_ROADMAP + roadmap-side refreshet (stale pre-launch-tekst).

### 3 MÅNEDER (jul-sep)
- Race-dybde: fysiologi #1021 (form/træthed afgør løb — største world-class-gap) + KOM/bonussekunder-design (fra #2072-analysen).
- E-mail-sekvenser D2/D7 + winback · SEO-eksekvering (#1301, #1406/#1407) · betalt annoncering skaleres efter data (Reddit/Meta først, Google Search på "cycling manager game").
- Sprog-survey til spillerne → beslutning om 3. sprog · U23/junior-løb (#958) · op/nedrykning #1152 ved sæsonskifte.

### RESTEN AF 2026
- Skalering (#323): cron ud af webserver (#330) ved >100 managers, loadtest (#331), Supabase Pro.
- Pro Analyst-tier hvis CZ Pro konverterer · flere sprog efter survey · PWA/mobil-polish.
- Cybersikkerhed: #691 key-rotation, #563 secret-decommission, security-review-runde.
- Forretning: ApS/MoR-beslutning (Paddle/Lemon vs Alunta-skala), bogføring (Dinero), budget, momsregistrering ved omsætning.
- Visuel identitet: egne holdtrøjer/logoer/rytter-visuals (fiktivt univers-løft).

### 2027 (retning)
- **Mobil: PWA → evt. Capacitor-wrapper.** Ingen native rewrite, ingen Unity/Godot/Unreal — async browser-manager er præcis hvad React+Node-stacken er langtidssikret til; race-motoren i Node er det RIGTIGE valg (determinisme, server-autoritet, testbarhed). Spilengines er til realtids-3D — forkert værktøj her.
- International vækst: creator-program, community-ligaer, 2-3 sprog, sæson-loop som års-rytme.
- Mål: 200+ betalende ≈ 14k DKK/md gross (BUSINESS_STRATEGY §4) som første forretningsmilepæl.

## Faste AI-rutiner (forslag — bekræft)
- **Mandag:** "Ugens plan"-post (Discord #announcements) + metrics-review (signups/D7/NPS/attribution).
- **Onsdag:** community-update + patch notes broadcastet.
- **Fredag:** Feature Friday — én poleret forbedring shippet + annonceret.
- **Dagligt (eksisterende):** housekeeping-routine #627 · drift-monitor. **Nyt:** stall-watchdog #2077.
- **Værdi-opdatering i spillet:** kører allerede via riderValueRefresh ved evne-ændringer (#1364-verificeret) — ingen ny rutine nødvendig, men punktet bekræftes i metrics-review.

## Ejer-beslutninger (afgjort 2/7 — opdateret samme dag)
1. **#2087 merged** af ejer 09:56Z; selv-heling verificeret komplet (1,69M CZ$ udbetalt, rangliste frisk, afvikling kører).
2. **Kill-liste godkendt og eksekveret** (40 kills + 13 dubletter lukket; cirkulært par #1774/#1975 rettet). **Undtaget: #671 + #680** — kigges sammen med ejeren.
3. **CZ Pro/Alunta: ejeren ser på det SENEST 6/7** (plan + tokens + test_mode); go-live-beslutning samme dag.
4. **Marketing-budget:** organisk fokus NU; ejer klar til betalt snart — primært **Meta + Reddit + lidt Google Ads**. Ramme: **~10.000 DKK i juli** (hvis kampagnen viser fortsat trafik), **2026 i alt maks 50.000 DKK (evt. 25.000)**. Betalt aktiveres kun mens attribution (#2079) beviser effekt.
5. **VMan-kontakt: beslutning 6/7.**
6. **Discord-migration: afgøres senest 6/7** (frys indtil da).
7. **Annoncer på hjemmesiden: NEJ** (bekræftet).
8. **Trænings-nerf-mål:** afventer ejerens bekræftelse af "peak 27-28 + 35-50 % gap-lukning/sæson" (forklaring givet 2/7). Tidsplan #2082: harness 5/7 → scorecard-review 6/7 → ship 7-9/7.

## Nye ejer-deadlines (2/7)
- **#2072 GC-akkumulering + #2081 GC undervejs: I DAG (2/7).**
- **#2000 rytterside-rework (PR #2037-fanerne): senest 3/7** (capstone/hero undtaget — afventer wireframe).
- **NPS-admin-flade: #2089** (nyt issue).
- **Patch notes:** Claude holder rytmen løbende + leverer EN-notat til Discord-patch-notes-kanalen ved hver ny version (bot kan poste direkte; ingen webhook nødvendig).

---
*Bilag herunder: fuld horisont-klassifikation af alle 339 issues (genereret af audit-workflowen).*

## Bilag A — Horisont-klassifikation (alle 339 issues)

## idag
- #672 [marketing-growth,b3] Landing page-polish + waitlist til TdF-push. Akkvisitionskritisk med TdF om 2 dage — afklar hvad der reelt mangler.
- #1114 [marketing-growth,b3] TdF-marketing (organisk + betalt) — vinduet åbner 4/7. Årets største acquisition-chance; skal eksekveres NU.
- #1903 [monetisering,b3] CZ Pro Slice 1 (billing rails) — mål nr. 1. Ligger som PR #1909 klar til ejer-merge; merge og test i dag.
- #2068 [bug-kritisk,b3] Bekræftelsesmails fejler + hold skal genindtastes — taber nye signups før TdF; PR #2069 klar, mangler merge + Resend-SMTP.
- #1886 [bug,b1] Squad-cap ikke håndhævet ved bud (trup 32/30) + falsk 'til salg'. Har claude:done — verificér i prod og luk.
- #1983 [bug,b1] Overlap-fejl navngav ikke rytter/løb ved gem af udtagelse — har claude:done-label: verificér i prod og luk.
- #1984 [ux-polish,b1] Overlap-status læsbar + genbrug af rytter i ikke-overlappende samme-dags-løb — claude:done: verificér og luk.
- #2001 [rider-profile,b1] Populér ability_progress/ability_caps (var null i prod) — claude:done-label: verificér backfill og luk.
- #2007 [rider-profile,b1] Rytter-handlinger på profilen (epic-slice 3) — claude:done-label: verificér i prod og luk.
- #2028 [bug,b1] Kaptajn skiftede tavst efter Team Strategy-redigering (pre-race kritisk); har claude:done-label — verificér og luk.
- #918 [rider-profile,b0] Udviklings-fane viste kun IRL UCI-point. Har claude:done-label — arbejdet ser leveret ud, luk issuet.
- #1102 [race-engine,b0] Light race-motor (V2) er bygget, live i prod og claude:done — luk issuet.
- #1140 [onboarding-email,b0] Onboarding samlet til ét flow — claude:done, leveret før TdF. Luk issuet.
- #1141 [analytics-data,b0] Board-instrumentering er claude:done. Luk; brug dataene i en evt. board-forenkling.
- #1175 [infra-ops,b0] Flip cyclingzone.org til primary. Memory siger .org ER live siden 11/6 og .vercel.app redirecter — verificér tjekliste + luk.
- #1278 [andet,b0] Spillerkommunikation om 20/6-resettet. claude:done-label og relaunch er gennemført — verificér og luk.
- #1791 [academy,b0] Ungdoms-rytter-rework (svag start → rejse mod loft) — har claude:done-label. Luk efter hurtig verifikation.
- #1800 [bug,b0] Fyrede ryttere hang i startopstilling (6/8-fejl) — har claude:done-label. Luk efter verifikation.
- #1831 [bug,b0] Alder vises 17 vs 18 for samme akademirytter — har claude:done-label. Luk efter verifikation.
- #1835 [results-ui,b0] Divisions-overblik (alle divisioner + kun egen) — har claude:done-label. Luk efter verifikation.
- #1925 [bug,b0] Follow-ups efter holdudtagelses-overhaul (help, trigger-verify, edge-cases). Har claude:done — tjek rest og luk.
- #1926 [infra-ops,b0] 4 orphaned endpoints gjorde audit-CI rød på hver PR. Har claude:done — verificér gaten er grøn og luk.

## 3d
- #959 [results-ui,b3] Etape-resultater pr. etape inkl. GC undervejs — rammer kendt brændpunkt 'kan ikke se samlet stilling'. TdF-kritisk, kun frontend.
- #1569 [onboarding-email,b3] Onboarding-audit handlingsplan: landing-CTA + signup-seam P0'er. Direkte TdF-kritisk for at nye spillere ikke tabes.
- #479 [marketing-growth,b2] Mobile Lighthouse 78 paa waitlist; font/bundle-quick-wins gavner al mobil-landing. Tag quick-wins foer TdF-trafik.
- #621 [infra-ops,b2] Sentry-hardening: Discord-alert på prod-fejl + user-context. Alerting mod silent failures — gør før TdF-bølgen.
- #679 [marketing-growth,b2] Discord-kanaler + welcome-bot til TdF-tilstrømningen. Vigtigt nu; afstem med den planlagte servermigration.
- #929 [security,b2] Slå leaked-password-beskyttelse til i Supabase (dashboard-klik). 5-min ejer-handling — gør det før TdF-signup-bølgen.
- #1279 [marketing-growth,b2] GO/NO-GO-gate ~11/7 for fuld TdF-marketing (retention-kriterier + interviewplan). Skal forberedes FØR Tour-kohorten lander.
- #1299 [marketing-growth,b2] Dynamiske OG-delebilleder (etaperesultat) til Discord/X. Viral vækst-mekanik — bør nå TdF-vinduet 4/7.
- #1407 [analytics-data,b2] GA4-indstillinger (SPA-tracking, key events) + GSC/Ahrefs-opsætning. GA4-delen bør sidde FØR TdF-trafikbølgen 4/7.
- #1583 [analytics-data,b2] Funnel-events + signup_attribution. claude:done — verificér events/attribution firer FØR TdF-bølgen, ellers måles den blindt.
- #1784 [infra-ops,b2] Vercel budget-loft FØR TdF-trafikspike — 15 min ejer-handling i dashboard. Billig forsikring mod løbsk regning.
- #1799 [bug,b2] Rytter signet fra 'Frie Ungdomsryttere' lander på seniorholdet — aktiv bug der korrumperer akademi-rosters nu.
- #2045 [i18n,b2] Tekst blinker/skifter flere gange ved sprogskift — gentaget dansk spiller-klage; fix bugoplevelsen før TdF-tilgangen.

## 7d
- #1856 [race-engine,b3] Scheduler tillader overlappende etapeløb i samme division → dobbeltbooking/tynde felter. Kerne-race-bug, fix nu.
- #413 [i18n,b2] i18n fase 4: EN auth-mails er vigtigst — internationale TdF-signups risikerer danske mails. PatchNotes/Privacy kan vente.
- #1173 [marketing-growth,b2] Referral-loop (del spillet, få belønning) planlagt tændt under Touren. TdF-vinduet åbner 4/7 — byg nu hvis det skal nå det.
- #1276 [security,b2] PCM-xlsx med 8.699 rigtige rytternavne (tredjeparts-IP) ligger synligt i public repo. Deadline 20/6 overskredet; afgør A/B før TdF-trafik.
- #1461 [onboarding-email,b2] DMARC p=none→quarantine→reject. Deliverability/spoofing-beskyttelse af signup-mails omkring TdF; kræver ejer-test først.
- #1775 [ux-polish,b2] AI-hold hedder 'AI 1/2/3' — dårligt førstehåndsindtryk for nye TdF-brugere. Navnegenerator er lille, synlig gevinst.
- #1819 [race-engine,b2] Sanity efter præmie ÷20: bekræft løb færdige+udbetalt — relevant nu hvor præmiepenge melder fast (Discord 1/7).
- #1974 [training,b2] Træningsbug: FLAD/SPRINT/ACC udvikles næsten ikke — rammer kernemotor + testertillid nu; fix før trænings-rework.
- #2022 [bug,b2] Nye holds bestyrelse får uopnåelige mål + intet DNA-valg; backfill kørt, men dannelses-stien skal fikses før TdF-tilgang.
- #2029 [race-engine,b2] Grand Tour genereret med 5 enkeltstarter; urealistisk etape-mix skader troværdigheden netop når cykelfans kommer til.
- #1364 [academy,b1] Rytterværdi skal stige når evner udvikles (akademi-enabler). claude:done — verificér i prod og luk.
- #1596 [race-engine,b1] Aktivering af etape-for-etape-afvikling — ser allerede live ud efter forever-relaunch 22/6. Verificér §6.1 og luk.
- #1734 [race-engine,b1] Katalog-udvidelse så alle puljer får 8 etapeløb — ligner leveret i division 4-commit ('katalog-udvidelse'). Verificér+luk.
- #1917 [infra-ops,b1] Audit-bot: migration (drop stale backup-tabeller) committet men ikke applied i prod. Hurtig apply/afklaring.
- #2059 [infra-ops,b1] Stale win32 patch-notes-snapshot fejler lokal Playwright hver session; 10-min refresh der fjerner dev-friktion.
- #1304 [analytics-data,b0,KILL] Huskeliste 11/6; hovedpunktet (GA4 live) er løst og claude:done. Resten er små ejer-tjek duplikeret i #1407 — luk.

## 14d
- #374 [infra-ops,b2] PITR-status + psql-tools så restore-drill kan køres. Verificeret backup er fundamentet for autonomi + tryg TdF-bølge.
- #1688 [race-engine,b2] Pyramide-follow-ups: 24-cap i raceRunner + div4-squad-limits er reelle før TdF-tilstrømning; AI-fyld ser leveret ud.
- #1774 [bug,b2] Etapedage-tal uens (40/60/41) på forside vs division vs pulje — synlig forvirring. Gentest efter katalog-udvidelsen.
- #1847 [bug,b2] 247 resultatrækker mistede rytter-kobling efter sletning; præmie/point uattribueret. Datareparation + slet-politik.
- #1894 [training,b2] 44% af ryttere fejltrænes på blind vo2max-default. Billig type→fokus-mapping stopper stille fejludvikling nu.
- #1919 [ux-polish,b2] 15-17% dead clicks på /races: labels/overskrifter ligner links. Vigtigste flade for nye TdF-brugere — fix snart.
- #1928 [ux-polish,b2] Flere spillere kan ikke se HVEM deres stjerneryttere er. Tilbagevendende forvirring — badge på rytter-rækkerne.
- #1936 [training,b2] Testere tror træning fejler fordi 'ét tick pr. dag' er usynligt. Vis tick-status + 'gælder fra i morgen'-besked.
- #1993 [race-engine,b2] team_name-snapshot mangler på resultater → præmier kan fordampe lydløst; tæt på præmie-brændpunkt + palmares-fundament.
- #1995 [race-engine,b2] Salg midt i etapeløb splitter point/præmie-attribution — ejer-besluttet fix (udskudt fuldførelse), rammer live data.
- #2042 [marketing-growth,b2] Login-væg på delte deep-links giver bounce; option B (kontekst-login) er shippet i #2050, option A (offentlig preview) rest.
- #99 [ux-polish,b1] Tooltip der forklarer rytter-'værdi'-formlen. Tilbagevendende spørgsmål; billig klarhed før TdF-tilstrømning.
- #677 [race-engine,b1] Rytterstats via fysio-model efter race engine V1; motor v2 + fiktive ryttere er live — verificér om leveret og luk.
- #941 [monetisering,b1] Founder-opgave: vælg regnskabsprogram (Dinero/Billy). Skal times med CZ Pro-betalinger — relevant når pengene ruller.
- #1182 [infra-ops,b1] Ubrugt Railway Postgres+Redis fakturerer hver måned uden funktion. 30-min verificér+slet = løbende besparelse.
- #1677 [andet,b1] Spiller-ønsket kerne-mekanik: fyr/opsig rytter. #1800 omtaler 'fyrede ryttere' — fyring findes muligvis allerede; verificér.
- #1875 [infra-ops,b1] Engangs ejer-handling: 2 Vercel preview-env-vars → klikbare mock-previews på alle UI-PR'er. Billigt, løfter test-flow.
- #1914 [ux-polish,b1] Help modsiger kode: '3 fokus-slots' (reelt unlimited) + div-tabel med 3 (div 4 er nu live). Kort beslutning + copy.
- #1941 [bug,b1] Auktions-grace er 0 i prod (kolonne mangler); help lover 60 min. Én ALTER + verify — billigt og afklaret fix.
- #1970 [ux-polish,b1] Clarity viser stadig dead/rage-clicks på /team, /teams/{id}, /training trods fixes — verificér om #1794/#1796 virker.
- #1975 [i18n,b1] Kalender-side uoversat til DA + forkert '60 racedays' — synlig misinformation, billigt fix mens nye brugere kommer til.
- #1996 [andet,b1] Ryd død transfervindue-kode der kan vise 'vindue lukket'-løgn til spillere — forudsætning for #1995-fixet.
- #2030 [ux-polish,b1] Race-kalenderen hopper ikke selv til næste racedag; lille QoL som ejeren lovede spillerne på Discord.
- #2032 [academy,b1] Én ung rytter kan ikke sættes på akademiet; reel spiller-blokering men lav evidens — reproducér først.
- #2063 [epic,b1] Tracking-overblik over QoL-småopgaver; Wave 2 (6 stk) er klar — nyttigt styringsissue, ikke selvstændigt arbejde.

## 1md
- #97 [andet,b2] Nødlåns-gældsspiral cross-season: beslutning om hårdt gældsloft. Live-evidens findes; rammer aktive managers.
- #135 [analytics-data,b2] Retention-scorecard (WAU, D7/D30, motor-brug). Rammer mål 4 (churn-tracking) direkte — start med minimal version.
- #1922 [training,b2] Det store træningsfokus-rework (ægte trade-offs). Ejer-planlagt 'derefter' — design efter bugfri drift + TdF.
- #1938 [training,b2] Ungdomsryttere vokser +4 pr. session — inflaterer dagligt. Kalibrér ned, evt. foldet ind i trænings-reworket.
- #2000 [epic,b2] EPIC: rytter-side-rework (1-99-evner, rating, handlinger) — ejerens erklærede capstone, men efter bugfrihed+TdF+penge.
- #21 [bug,b1] Vag bug fra 1/5: 'kommende løb' viser forkerte løb. Verificér om den stadig findes efter kalender-rework, ellers luk.
- #88 [infra-ops,b1] Branch protection + auto-merge på main. Billig forsikring mod broken prod med 50+ managers; næste ops-runde.
- #109 [bug,b1] Nogle ryttere under 25 mangler U25-stempel (kategoriserings-/databug). Mindre databug; fix i bug-runde.
- #228 [ux-polish,b1] Auktionsside: bedre kolonner + ønskeliste-ikon + 'Mine auktioner'-fane. Mindsker overvældelse for nye managers.
- #261 [ux-polish,b1] Tal-input ved siden af sliders i rytterfiltre (mobil-præcision). Reel irritation for 2+ managers; billigt fix.
- #306 [analytics-data,b1] Instrumentér ~10 manglende analytics-events (transfers, lån, sæson). Støtter retention/churn-tracking (mål 4).
- #324 [infra-ops,b1] driftMonitor squad-bug betyder brud aldrig fanges (silent failure, mål 4). Værdier forældede efter Division 4 — opdatér scope.
- #332 [infra-ops,b1] Incident playbook + backup-drill + cost-model. Manus (droppet) som ejer — re-scope; backup/playbook-delen har reel værdi.
- #349 [infra-ops,b1] Opgradér gitleaks-action før Node 20 fjernes fra runners 16/9. Lille fix med hård deadline — tag den inden en måned.
- #401 [infra-ops,b1] Migrations-drift schema.sql vs auto-migrate rammer igen ved næste ikke-idempotente migration. Kræver ejer-valg (anbefaling: B).
- #419 [marketing-growth,b1] Carl-bot + Dyno auto-mod (bruger-handling via OAuth). Gør det på den NYE server ifm. migrationen, ikke den gamle.
- #427 [marketing-growth,b1] Discord-CTA i UI + onboarding-mails. Dashboard-nudge findes allerede delvist; resten giver mest mening efter server-migration.
- #431 [marketing-growth,b1] Foerste founder-AMA paa Discord. Godt community/marketing-traek der kan ride paa TdF-momentum, men kraever ejer-tid.
- #435 [andet,b1] Privacy/cookie-copy naevner ikke Vercel Analytics/Speed Insights. Reel compliance-drift, lille copy-fix.
- #452 [andet,b1] Tilmeld-knap til naeste saeson hvis man ikke kan stille hold. Retention-vigtig ved saesonskifte, del af #239.
- #481 [marketing-growth,b1] Brand identity-overhaul (logo + designmanual). Ejer-prioriteret growth-projekt, multi-session; efter TdF-ugerne.
- #483 [i18n,b1] i18n-epic Fase 3.5: 6 af 10 authenticated sider mangler EN. Vigtig for international vaekst, men rest er mid/low-prio.
- #490 [i18n,b1] i18n af ActivityPage (markeds-flade, 6 tabs). Mid-prio del af #483; EN-oplevelse for nye internationale brugere.
- #493 [i18n,b1] i18n af RacesPage (loebskatalog). Player-facing for nye EN-brugere, men mid-prio i #483.
- #527 [security,b1] Stram 6 always-true RLS-policies til service_role-scope. Reel hardening foer betaling/vaekst; WARN-niveau, ikke akut.
- #543 [admin,b1] Admin-toggle til at pause saeson-transition (i dag kun manuel SQL). Billig sikkerheds-ergonomi foer naeste skifte.
- #605 [ai-ops,b1] AI-ops master-issue: token-slankning af agent-setup. Sparer dagligt, men stoette-kategori — ikke spillet selv.
- #691 [security,b1] Fuld rotation af Supabase service-key (ejer-klik + agent-sync af alle flader). God hygiejne før betalinger, ikke akut.
- #720 [security,b1] Verificér disk-kryptering på firma-laptop med prod-secrets — 10 min manuel ejer-handling, reel lækagerisiko.
- #738 [security,b1] Beslut McAfee vs Defender på dev-maskinen; realtime-beskyttelse rapporteret uklar. 15 min ejer-beslutning.
- #748 [security,b1] Rotér lækket Discord-bot-token + env-injection. Reel sikkerhedsrest fra maj, men intern bot — ikke spiller-vendt.
- #904 [infra-ops,b1] Migrér preview/dev til Supabase publishable key (luk legacy band-aid). Bør ske før Supabase tvinger det — ikke akut.
- #931 [training,b1] Trænings-epic (nøglerytterplaner). Ejerens mål 5 'træning-rework' — vigtig, men efter bugfri+TdF+monetisering.
- #932 [academy,b1] Akademi-epic (intake/promotion/ungdomsauktion). Mål 5 'akademi-forbedringer' — kommer efter de brændende ting.
- #961 [ux-polish,b1] Kontekstuel hjælp/FAQ-link pr. område (banner→ikon). Godt for TdF-nybegyndere, men ikke blokerende.
- #985 [bug,b1] Udlejning: mangler max-grænser + bug hvor lejetilbud-notifikation lander i egen indbakke. Reel spillerfeedback.
- #1011 [ux-polish,b1] Attribut-farver svære at læse i dark mode (flere spillere klager). Koordinér med rytterprofil-capstone #2000.
- #1017 [infra-ops,b1] Ejer kan ikke logge ind på Vercel-previews → blokerer UI-verify før merge. Dev-friktion, ikke spillervendt.
- #1027 [ux-polish,b1] UI-overhaul: Track A (whitespace) er live; top-header + nav/IA-restructure udestår og kræver planlægningssession.
- #1106 [results-ui,b1] Sæson-vælger på rangliste/historik/kalender. Fold ind i resultat-hub-reworket; bør stå klar før sæson 1 slutter.
- #1136 [epic,b1] Paraply-epic for progression/træning/ungdom (kerne-fantasi). Styrer trænings-reworket — planlæg efter bugfrit+TdF.
- #1137 [training,b1] Passiv udvikling/aldring/retirement (L0). Dele (retirement) ser live ud — verificér reel rest-scope før arbejde.
- #1283 [marketing-growth,b1] Ejer-ledet session der definerer founder-stemmen til marketing/Discord. Nyttig for TdF-kommunikation men kræver Nicolais tid.
- #1301 [marketing-growth,b1] SEO-epic: per-route titler, JSON-LD, indekserbar landing. Langsigtet vækst-loop — slices efter TdF-vinduet.
- #1310 [andet,b1] Markeds-pakke: AI-bud, system-auktioner, uopfordrede bud. Forlængelses-UI skal dog klar før sæson 1-slut.
- #1369 [analytics-data,b1] Meta-epic for CRO/retention-loop (North Star, funnel). Rammen for mål 4 — selve arbejdet ligger i konkrete issues.
- #1462 [security,b1] CSP fra report-only til enforcing (XSS-beskyttelse). Kan brække appen — test alle flows, flip IKKE midt i TdF-vinduet.
- #1464 [infra-ops,b1] CI-test der fanger enum-inserts uden DB-constraint (P0-klassen fra #1463). Billig guard mod relaunch-crashes.
- #1576 [ux-polish,b1] AI-slop-oprydning (305 fund, 6 work packages). Førstehåndsindtryk (WP3) gerne snart; resten er løbende polish.
- #1602 [ux-polish,b1] Epic: luk mobil-huller (touch-targets, delt tabel-komponent). Akutte huller allerede lukket; resten er konsolidering.
- #1614 [bug,b1] Panic Board viser cap 20/10 men alle må have 30 — lille display-fix efter ejer-valg A. Reel men ikke brændende.
- #1665 [i18n,b1] 76 danske fejltekster i api.js; 19 rammer spillere (bud/transfer). Værdi for engelske TdF-brugere, men kan vente.
- #1778 [ux-polish,b1] Sponsor-deadlines uklare (udløb/valgvindue/konsekvens). Reel UX-mangel fra spiller, men ikke brændende.
- #1807 [infra-ops,b1] Delt getAuthedUser()+lint-guard mod null-deref-crash ved udløbet session. God forebyggelse, ikke akut.
- #1812 [infra-ops,b1] frontend-smoke er advisory → røde tests driver uset. Billig fix: auto-PR-kommentar ved fejl (option A).
- #1815 [race-engine,b1] Discord-besked per etape (i dag kun finale) — godt for engagement, men kræver design af idempotens/volumen først.
- #1818 [andet,b1] Gen-kør økonomi-scorecards med fuld 12-trup (hale-løn kun antaget billig). Balance-verifikation, kan vente lidt.
- #1833 [rider-profile,b1] Tooltips der forklarer power-intervaller/evner — fold ind i rytterprofil-capstone #2000 frem for separat slice.
- #1888 [marketing-growth,b1] Bot poster patch notes automatisk i Discord. Fint community-løft; hører sammen med Discord-migrationen, ikke akut.
- #1895 [training,b1] Ugentlig træningsplan (daglig bonus kræver stadig klik). God retention-UX, men koordinér med trænings-reworket.
- #1896 [training,b1] Vis at man misser +25%-bonus når assistenten træner. Synliggør skjult straf; naturlig følgesvend til #1894/#1895.
- #1900 [results-ui,b1] Standings på tværs af alle divisioner + eget-filter (ejer valgte 'begge'). Hører til resultat-hub-arbejdet.
- #1929 [academy,b1] Toggle til at vise akademiryttere på My Team. Lille QoL der hører til akademi-forbedringerne senere.
- #1930 [results-ui,b1] Sortér afsluttede løb nyeste først. Trivielt quick-win, men foldes naturligt ind i resultat-hub-reworket.
- #1953 [ux-polish,b1] Kalender: enkeltstart (ITT) ligner flad sprintetape — reel tester-friktion, men visuel polish der kan vente.
- #1976 [ux-polish,b1] Vis etape-distance (km) på ruteprofiler — nyttig strategi-info testerne savner, men ren feature-polish.
- #1979 [ux-polish,b1] Omdøb 'udbrud'-profilnavnet der lyder som garanteret udfald — lille copy-fix, ejer allerede enig i ændringen.
- #1987 [marketing-growth,b1] Bot perf/SEO-inbox: bundle 105% af budget + lang='da' vs EN-copy — rullende inbox, ingen røde findings.
- #1994 [andet,b1] Fjern ubrugt udlånsfunktion (0 aftaler i prod) — reducerer bugflade og halvforkert attribution, men ingen hast.
- #2002 [rider-profile,b1] Ensret evne-rækkefølge + P/M/T mod abilities.js-SSOT overalt — follow-up til epic-slice 1, ingen PCM-rester.
- #2006 [rider-profile,b1] Overall 1-99-rating (epic-slice 2) — balance-følsom, kræver sim + scorecard før ship; del af rytter-epic'en.
- #2008 [rider-profile,b1] Udviklings/trænings-fane (epic-slice 4) — fjerner PCM-rest; bør koordineres med det planlagte trænings-rework.
- #2014 [rider-profile,b1] 'Utypet/udvikler sig'-tilstand for ryttere uden speciale — ejer-prioriteret klassifikator-fix der føder rating+træning.
- #2033 [ux-polish,b1] Bakke- og etapeløbsrytter-farver næsten ens (farveblind-uvenligt); vent på rytterprofil-redesign #2000.
- #2041 [analytics-data,b1] Clarity viser ~0 returning users trods identify-fix; afklar bug vs. cold-traffic-mix — forudsætning for retention-mål.
- #2060 [infra-ops,b1] Bundle-budget rammes ved hver feature (PatchNotesPage ~206KB i main-chunk); trim/code-split for ægte headroom.
- #355 [ai-ops,b0] Disconnect 7 ubrugte MCP-connectors (~2,5k tok). 5-min bruger-handling; Clarity/Calendar/computer-use ses stadig aktive.
- #662 [ai-ops,b0] Weekly housekeeping-routine sætter forkerte labels hver mandag — lille prompt-fix, lav men reel irritation.
- #1899 [race-engine,b0] Beslutning om race_days_total (60→140/per-division) når kalender-rework lander. Vent på #1856-merge, så afgør.
- #1972 [infra-ops,b0] Drop ~40 backup-tabeller fra juni-resets — kun advisor-støj/API-surface; ejer-gated destruktiv op, ikke spillervendt.
- #2017 [infra-ops,b0] CodeQL støjer med 3 falske XSS-alerts fra docs-mockups; lille paths-ignore-fix, Wave 2-klar men ikke brændende.
- #2018 [infra-ops,b0] Sentry-filter mod Vercel-toolbar-støj; holder alert-strømmen ren (mål 4), men lille og kan vente.

## 3md
- #33 [andet,b1] Tillad midlertidigt salg under division-minimum i transfervinduet. Reel gameplay-friktion, men ikke akut.
- #62 [epic,b1] Epic: Today/Manager Inbox (hvad skete/kræver handling). Stærk retention-retning men stort — efter monetisering.
- #91 [results-ui,b1] Live-ticker under løb (a la Deadline Day). God stemning, men hører ind under nyt resultat-hub — byg den dér.
- #101 [ux-polish,b1] Vis boardets konkrete effekter (fx sponsor +X%) i UI. God forståelighed, ikke akut.
- #260 [ux-polish,b1] Gør holdnavne klikbare overalt i UI (link til holdside). Billig konsistens-gevinst; tag i UX-runde.
- #288 [infra-ops,b1] 3 Playwright interaction-tests (rytterudvikling, bud, admin-config). Godt regressionsværn, men ikke brændende.
- #347 [infra-ops,b1] Deploy-verify fejler falsk på docs-only commits (manglende Railway-status). Reel CI-støj, men ikke brændende.
- #409 [i18n,b1] i18n-epic EN-default. Kernen er live i prod (EN-first er politik); kun fase 4/5 udestår — opdatér eller luk epicen.
- #415 [epic,b1] Discord-epic/tracker; fase 1+2 done på gammel server. Migration til ny server (mål 5) ændrer scope — opdatér epicen dér.
- #424 [marketing-growth,b1] Verify-bot der linker Discord til spilkonto. God community-foundation, men efter monetisering + Discord-migration.
- #428 [marketing-growth,b1] Ugentlig Discord-content-kalender (templates). God for community-retention, men manuel drift; kan vente til efter TdF.
- #450 [andet,b1] Spiller-oenske: minimumspris/floor paa egne ryttere mod spam-bud. Reel markeds-QoL, men ikke braendende.
- #491 [i18n,b1] i18n af ManagerProfilePage (andres profiler, ~285 linjer). Lavfrekvent side; kan vente.
- #492 [i18n,b1] i18n af ProfilePage (settings). Lavfrekvent side; kan vente.
- #519 [infra-ops,b1] Adfaerdsbevarende split af 6.100-linjers api.js i domain-routers. God gaelds-nedbringelse, ikke akut.
- #520 [infra-ops,b1] Split AdminPage/RacesPage + stram frontend-direct-writes. Maintainability + sikkerhed, men stort; efter brandene.
- #708 [infra-ops,b1] Supabase-breaking change 30/10: nye public-tabeller kræver eksplicitte grants. Fastlæg migrationsstandard inden.
- #797 [ux-polish,b1] Mobil-layout for brede rytter-tabeller (kort-visning mm.). Reel UX-værdi, men kræver designbeslutning — kan vente.
- #819 [andet,b1] Bestyrelsesforhandling har kun upside — mangler cap/risiko. Balance-fix; hører under bestyrelses-epic #955.
- #923 [rider-profile,b1] Filtrér/sortér rytterresultater (PCS-stil). God spiller-feedback, men hører ind i rytterprofil-rework #2000/#959.
- #938 [ux-polish,b1] Global søgning på tværs af ryttere/hold/løb/managers. God QoL for nye brugere, men ikke brændende.
- #954 [epic,b1] Transparens-hub: changelog/patch notes/roadmap + voting. God retention/community-værdi, men ikke brændende nu.
- #955 [epic,b1] Bestyrelses-UI-rework (5/3/1-års-plan som faner) — samler 8 board-issues. Reel spiller-friktion, men kan vente.
- #986 [ux-polish,b1] Rework af økonomisiden (faner, korrekt prognose, lånefane). God spillerfeedback, men stor og kan vente.
- #1010 [results-ui,b1] Ønske: højdeprofiler for kommende løb i sæsonoverblik. Kræver profildata/import; hører til resultat-hub-sporet.
- #1021 [race-engine,b1] Fuld kalibreret simulator (demand-vectors, Monte Carlo). Modning af live V2-motor — re-scope, faseplan er forældet.
- #1108 [andet,b1] Manager vælger egen nationalitet (flag) — lille identitetsfeature, fint efter de brændende ting.
- #1138 [training,b1] Scouting med skjult potentiale/stjerne-ranges (L1). Godt retention-lag, men efter L0/trænings-rework.
- #1176 [race-engine,b1] Motor-dybde: løbsform, startlister, styrt. Race engine er topsøjle, men dette er post-bugfix realisme-lag.
- #1178 [andet,b1] Fyre/frigive rytter til free agency. Reelt hul i roster-styring for managers, men ikke TdF/monetiserings-kritisk.
- #1189 [andet,b1] Tester-konsensus om auktionstider/transfervindue (natlukning, min-tid). Godt beslutningsgrundlag til senere tuning.
- #1199 [ai-ops,b1] Natlig cron der overvåger data-drift (priser, population) mod prod. God alerting-idé, men gates skal være enforcing først.
- #1235 [andet,b1] Forhandl bestyrelsesmål OP (high risk/high reward). Ejer-ønske fra Discord; venter på #1187-B satisfaction-design.
- #1237 [andet,b1] Board-økonomi skal se saldo vs gæld, ikke kun antal lån. Verificeret mangel; balance-følsom, hører i board-sporet.
- #1240 [ux-polish,b1] Tilbageknap + fjern/erstat mål i board-forhandlings-wizard. Reel UX-friktion ved sæsonstart, men ikke brændende.
- #1281 [andet,b1] base_value glider mod faktisk handelspris ved auktion/transfer. Lovet i #1101 men aldrig bygget; balance-tuning senere.
- #1293 [race-engine,b1] Berig population (brosten/puncheur/tt) + endelige gate-bånd. Balance-polish med ejer-beslutning — kan vente.
- #1294 [race-engine,b1] Admin-testværktøj: flere seed-udfald i race-preview + preview på afviklede løb. Nyttig kalibrering, ikke brændende.
- #1373 [infra-ops,b1] Delt query-cache + optimistic UI (TanStack). Stor perf-refactor med correctness-risiko — post-TdF, rute for rute.
- #1374 [infra-ops,b1] Targeted Realtime-invalidering i stedet for loadAll-refetch (62 steder). Sandsynlig første skaleringsflaskehals — senere.
- #1378 [race-engine,b1] Kalibrér de 9 ryttertyper (z-scores/guards) mod launch-populationen. Balance-finpuds — scripts i repo tyder på igangsat arbejde.
- #1379 [race-engine,b1] Genbesøg evne-v2 + aktivér watt-power-kurven i motoren. Stort balance-arbejde — hører til trænings-/progression-rework.
- #1441 [epic,b1] Økonomi-epic: anti-inflation, gold sinks, ægte sponsorer. Vigtig design-session, men efter bugfrit+TdF+CZ Pro.
- #1543 [academy,b1] Ægte talentspejder-feature afløser interim scout-knap. Kræver ejer-design-beslutninger — hører til akademi-sporet senere.
- #1837 [andet,b1] Ønske: sæt autobud/max-bud direkte fra rytterprofil ved auktionsstart. Fin QoL, men langt fra målene — backlog.
- #1857 [race-engine,b1] Snapshot form/træthed/abilities pr. løb så omkørsler kan re-simuleres 1:1. God robusthed, ikke brændende.
- #1884 [ux-polish,b1] UI-polish: fold jæger-dropdown ind i HunterExplainer på race-detalje. Lav risiko, lav værdi lige nu.
- #1997 [rider-profile,b1] Verdensklasse palmares/historik-vision (rytter+hold) — stor design+build-flade; kræver #1993-fundament først.
- #2009 [rider-profile,b1] FM-agtig hover-miniprofil overalt (epic-slice 5) — flot genbrugskomponent, men sen slice i epic'en.
- #2010 [rider-profile,b1] Historik/resultat/interesse-faner (epic-slice 6) — afhænger af #1993-snapshot + #1997-vision; sen slice.
- #2034 [race-engine,b1] Roller pr. etape + taktik-skift undervejs; stort ejer-ønske der kræver sim-omlægning — efter bugfix/monetiserings-bølgen.
- #2064 [andet,b1] Design af løbende ny-rytter-tilgang til spillet (ejer-ønske); balance-følsomt designarbejde, hører til efter TdF/monetisering.
- #50 [admin,b0] Opdel 1900-linjers AdminPage i sub-sider. Letter kun Nicolais eget arbejde; tag den ved lejlighed.
- #58 [ux-polish,b0] Omgruppér transfersidens 6 faner til 3 handlings-modes. UX-forbedring uden akut smerte.
- #103 [andet,b0] Design-spørgsmål: flerårige board-mål ved tidlig opfyldelse. Afventer spiller-forslag; afklar før mekanik låses.
- #226 [ux-polish,b0] Sticky rytternavn-kolonne på auktionssiden (PC) ved horisontal scroll. Lille UX-fix, ingen hast.
- #227 [ux-polish,b0] Filter på nuværende bud (fx under 100K) på auktionssiden. Nice-to-have scanning-hjælp.
- #230 [ux-polish,b0] Proxy-bud efter overbud: auto-cancel eller bedre UI? Kræver produktvalg; variant C (one-click slet) er billig.
- #256 [ux-polish,b0] Auktionshistorik: vis antal bud + antal forskellige bydende hold pr. rytter. Nice-to-have statistik.
- #264 [marketing-growth,b0] Discord-kanal til sæson-events. Kanal findes muligvis allerede + server-migration forestående — lav ifm. migration.
- #353 [analytics-data,b0] Aktivér Vercel Speed Insights + verificér consent-gate begge veje. Nice-to-have perf-telemetri.
- #414 [i18n,b0] i18n fase 5: lint-guard + glossary + docs. CI har allerede i18n-key-check; resten er ren polish.
- #442 [security,b0] Dismiss 64 stale CodeQL rate-limit-alerts + 3 script-alerts. Alert-stoej-oprydning; nem men ikke vigtig nu.
- #528 [security,b0] Klassificér 6 tabeller med RLS uden policies (INFO-niveau). Ren dokumentation af default-deny; lav vaerdi.
- #530 [security,b0] CI-check for manglende rate-limit paa nye routes + workflow-template. Forebyggende tooling, ikke akut.
- #658 [ai-ops,b0] Windows-cron for token-hygiejne-check så budget-drift fanges automatisk. Reel ops-værdi, men ren støtte.
- #725 [security,b0] Beslut én kanonisk secret-sti (runtime-injection vs .env på disk) + doctor-WARN. Sikkerhedshygiejne, ikke akut.
- #976 [ux-polish,b0] IA-beslutning: fold Min Aktivitet ind i Indbakke/Transfers. Kræver produktbeslutning; kan vente.
- #1033 [ux-polish,b0] Dead-clicks: inerte tabel-headers ligner sorterbare på /races, /auctions, /standings. Lille konsistens-fix.
- #1208 [andet,b0] Board-stjernescore bruger frossen uci_points-kolonne (mættet skala). Balance-følsom refactor, lav spillersynlighed.
- #1270 [ai-ops,b0] Dev-hooks: pre-push-tests, dep-sync-vagt, sessionskollisionsvarsel. Sparer Claude-tid, blokerer ikke mål 1-4.
- #1290 [ai-ops,b0] Oprydning efter Codex-udfasning (docs, labels, cache). Ren hygiejne; dele er formentlig allerede sket ad hoc.
- #1341 [ai-ops,b0] Doc-oprydning efter Manus/Codex-exit + Claude kanal/model-matrix. Ren AI-ops-hygiejne, blokerer intet produktmål.
- #1375 [epic,b0] Paraply-tracker for perf-spec'en (fase 0-3). Intet selvstændigt arbejde — lever så længe børnene (#1373/#1374/#331) lever.
- #1450 [infra-ops,b0] Infisical→Vercel secret-sync. Ops-hygiejne med prod-deploy-risiko ved fejlmapping — tag i et roligt vindue.
- #1466 [infra-ops,b0] Ét script til rehearsal-branch provisioning+teardown. Ren DX-bekvemmelighed til sjældne rehearsals — lav prioritet.
- #1473 [infra-ops,b0] Forebyg at E2E-fixtures lander i prod (selve oprydningen gjort 18/6). Lille guard/beslutning tilbage — kan vente.
- #1528 [ai-ops,b0] Selvkørende natlig burndown-loop (auto-natbølge, ejer merger). Stort AI-ops-projekt — værdi, men efter produktmålene.
- #1595 [andet,b0] Fjern kun PCM-import-pipeline, behold stat_* som derive-kilde (Option B; spec'en er forkert). Efter WS1 er bevist.
- #1668 [ai-ops,b0] Ugentlig worktree-cleanup mangler orphan-sweep (84 dirs hober op). Lille ops-fix, blokerer intet spillervendt.
- #1712 [race-engine,b0] 140 etaper/5 pr. dag-rekalibrering — bevidst parkeret og balance-tung. Vent til økonomi/beta er stabil.
- #1865 [ai-ops,b0] Genmål harness-token-snapshot (stale siden 29/5). Ren AI-ops-hygiejne, blokerer intet spillermål.
- #1879 [ai-ops,b0] Docs-oprydning: fjern Codex/Manus fra live ops-docs + konsolidér AI_OPS-docs. Støtte, ikke spillervendt.
- #1942 [i18n,b0] Død FAQ-nøgle i help.json der aldrig renderes — triviel lav-risiko oprydning uden spillerværdi nu.
- #2047 [ux-polish,b0] Landing-perf polish (critical CSS m.m.) efter LCP allerede er grøn (2,1s); lav rest-værdi, ren polish.

## 2026
- #844 [andet,b1] Lande-tabel + nationsstyrke (fødselsrate/talent/omdømme). Stor world-building-feature, ikke i nuværende mål.
- #939 [race-engine,b1] Vejr+vind som race-faktor. Bør bygges som sub-scope i race-engine-designet, ikke isoleret — kan vente.
- #1146 [epic,b1] Design-spec for delt løbskalender v2 (fatigue, kvalifikation, assistent). Stor vision-epic, post-monetisering.
- #1147 [epic,b1] Offentligt verdens-feed (resultater, transfers, rivaliseringer). God retention-idé, men vision-epic efter mål 1-4.
- #1149 [epic,b1] Klubfaciliteter-epic (akademi, træning, scouting, medical). Akademi-delen kommer før via DEREFTER-listen; resten 2026.
- #1150 [epic,b1] Design af flerårige kontrakter, rider demands og lån. Reel dybde men lagdelt vision-arbejde efter monetisering.
- #1151 [epic,b1] Menneskedrevet transfermarked med AI-likviditet. Kræver større spillerbase; hører til skaleringsfasen.
- #1154 [epic,b1] Rytter-personlighed og klubrelation (ambition, loyalitet). Vision-epic; retention-værdi men efter kernemålene.
- #1239 [andet,b1] Board-DNA v2: sportslige fokus-typer, nationalitet, egen avl. Stort design-issue oven på flere andre epics.
- #17 [andet,b0] Design-valg om lånerenter/gebyr fra april. Ingen spillere blokeret; afklar sammen med senere økonomi-arbejde.
- #78 [ai-ops,b0] Ugentlig auto-kørsel af memory-konsolidering. Ren AI-ops-hygiejne, blokerer intet af mål 1-4.
- #266 [andet,b0] Mester-trøjer (VM/EM/nationale) som flavor-feature. Fin retention-idé, men langt efter monetisering og bugfixes.
- #323 [epic,b0] Skaleringsepic mod 5-10k brugere. Eksplicit post-monetisering per ejerens prioritering — parkér til efter CZ Pro.
- #330 [infra-ops,b0] Cron ud af webserver + job-locking. Først relevant ved flere backend-instanser — post-monetiserings-skalering.
- #331 [infra-ops,b0] Loadtest + DB-baseline. Afhænger af #333/#334; skaleringsepic = post-monetisering. Codex-ejerskab er forældet.
- #333 [infra-ops,b0] Realtime WebSockets i stedet for 60s-polling. Først nødvendigt ved 2000+ samtidige — post-monetisering.
- #425 [marketing-growth,b0] Auto-tildel Top-50-rolle hver søndag. Afhænger af verify-bot (#424) — samme sene horisont.
- #426 [marketing-growth,b0] /mit-hold slash-command i Discord. Afhænger af verify-bot; kommandonavne bør i øvrigt være EN-first. Langt ude.
- #430 [marketing-growth,b0] Rekruttér 2 Discord-mods ved 50+ aktive medlemmer. Taerskel ikke naaet; ren paamindelse uden kode. Sen 2026.
- #499 [ai-ops,b0] Tracking-traad for auto-ugerapporter (time-tracking). Automation leveret maj; kun container, intet nyt arbejde.
- #542 [infra-ops,b0] Refactor transfer_windows.status til lifecycle_phase enum. Design-cleanup; bug-klassen er allerede blokeret af constraint.
- #722 [ai-ops,b0] Non-interaktivt Discord-MCP-setup på frisk PC — DX-komfort ved PC-onboarding, ingen spillerværdi.
- #723 [security,b0] Installér gitleaks via bootstrap så pre-commit secret-scan bruger robust primær-sti — lille DX/sikkerhedsforbedring.
- #724 [infra-ops,b0] Ét verify-setup-script med samlet grøn/gul/rød-verdikt for 'PC klar' — DX-konsolidering, kan vente.
- #739 [infra-ops,b0] Pin/dokumentér Node-version (Volta/.nvmrc) for forudsigelighed på tværs af PC'er — ingen hast.
- #908 [admin,b0] Ratio-editor i præmie-admin (pointtrøje = X% af etapesejr). Additiv admin-polish — langt fra nuværende mål.
- #956 [epic,b0] Deadline-hub med optakt/rygter året rundt. Post-launch epic, afhænger af popularitetsdata (#957).
- #957 [epic,b0] Trending-ryttere (mest besøgte 24t/7d). Kræver besøgs-logging som fundament først — post-launch.
- #1099 [epic,b0] Epic: optjent rytter-omdømme (resultater → popularity). Stor mekanik, hører til efter monetisering.
- #1110 [andet,b0] Board-mål baseret på ryttertyper ('skaf en sprinter'). Kræver ryttertype-fundament; ikke presserende.
- #1111 [ux-polish,b0] Rigtige navne til bestyrelsesmedlemmer (immersion). Lille, men langt nede i køen.
- #1112 [andet,b0] Manager-omdømme som del af delt renown-motor. Afventer #1099 + Økonomi 2.0-design.
- #1125 [admin,b0] Admin-QoL: kopiér forrige sæsons kalender som skabelon. Sparer opsætningstid, ikke spillervendt.
- #1177 [race-engine,b0] Vejkaptajner, mentorer og erfaring. Dybde oven på personligheds-epic #1154 som selv er 2026 — følger den.
- #1667 [admin,b0] Fjern forældet edition_year-editor i admin + døde i18n-keys. Ren intern oprydning uden spiller-effekt.
- #1679 [training,b0] Se andre holds træningsvalg (read-only). Nice-to-have — fold ind i det kommende træning-rework i stedet.
- #1905 [andet,b0] Spillervalgt auktions-varighed. Balance-følsomt design, eksplicit backlog/post-launch fra ejeren selv.
- #1977 [andet,b0] Sælger-kommentar på rytter til salg — hyggelig idé, men fri-tekst kræver moderation/XSS-værn; langt nede i køen.
- #1980 [andet,b0] Nedryknings-faldskærm + dyrere oprykning — bevidst evidens-gated til første sæsonskifte med ægte nedrykkere.
- #1981 [andet,b0] Billigere udviklingsveje for nye klubber — evidens-gated på retention/funnel-data der ikke findes endnu; vent.
- #2046 [i18n,b0] Per-sprog landing-prerender via edge middleware; glimtet er accepteret nu — først relevant ved betydelig DA-trafik.

## 2027
- #1148 [epic,b1] Verdenshistorik + klubmuseum (rekorder, legender). Kræver flere sæsoners data først; længst ude af vision-epics.
- #26 [andet,b0] Transfer-war-room (shortlist+sammenlign+budget-forecast). Fin idé men stort byggeri uden akut behov.
- #27 [ux-polish,b0] Gemte scoutingfiltre pr. manager. Ren nice-to-have oven på filter-state-fix; venter til UX-runde.
- #94 [andet,b0] Managerens egen cross-season-historik. Kræver 3+ afsluttede sæsoners data; trigger ikke nået endnu.
- #165 [ux-polish,b0] Samlet board-tilfredsheds-progressbar. Kosmetik; fold ind i evt. board-UI-overhaul sammen med #101.
- #930 [epic,b0] Vision-epic: stab/ansatte (sportsdirektører, læger, kokke). Post-launch, intet design — langt ude i fremtiden.
- #933 [epic,b0] Vision-epic: holdejerskab + sponsorøkonomi. Post-launch brain-dump uden fastlagt scope.
- #934 [epic,b0] Vision-epic: landshold + VM/EM/nationale mesterskaber. Post-launch, afhænger af lande-system #844 + race-engine.
- #935 [epic,b0] Vision-epic: sociale features (follow + rytterbilleder). Post-launch; billed-pipeline/rettigheder uafklaret.
- #936 [epic,b0] Vision-epic: 3D-visualisering af etaper. Kæmpe teknisk/asset-tung opgave — 2027-territorium.
- #958 [academy,b0] Junior/U23-hold + egne kalendere. Eksplicit gated bag akademi-validering #932 — 'Later/Unscheduled'.
- #1109 [andet,b0] Manager-evner a la Football Manager (forhandling/scouting). Stor design-feature, langt efter monetisering.
- #1113 [andet,b0] Fans som økonomi-/moral-mekanik. Spændende vision, men langt efter monetisering.

## kill
- #673 [monetisering,b1,KILL] Alunta-betalingsflow fra juni-planen — overhalet af CZ Pro (PR #1909). Luk; genbrug evt. founder-badge-idéen.
- #87 [ai-ops,b0,KILL] GitHub Projects-board. Label-state-maskine + NOW.md dækker behovet; et board bliver ikke vedligeholdt — luk.
- #198 [andet,b0,KILL] DX-oprydning i auktionskode (magic numbers, stale kommentarer). Trivielt — tag i forbifarten, luk som issue.
- #241 [andet,b0,KILL] Formaliseret manager-spotcheck af sæson-finansrapport fra maj. Overhalet af løbende Discord-feedback — luk.
- #311 [ux-polish,b0,KILL] 'På Hold'-knap = uklar dublet af ønskelisten; ingen afklaring siden maj. Luk — rytterprofil-capstone #2000 dækker fladen.
- #346 [ai-ops,b0,KILL] Stale bot-genereret agent-doctor-snapshot fra 29/5; warnings trackes i egne issues. Luk som forældet.
- #388 [ai-ops,b0,KILL] Skill-portefølje pr. slice for ~500-1500 tok besparelse. Over-engineering ift. gevinst og vedligehold — luk.
- #389 [andet,b0,KILL] Audit af 30+ Manus-noter i OneDrive (Manus droppet). Strategien ligger i BUSINESS_STRATEGY.md — luk som forældet housekeeping.
- #429 [marketing-growth,b0,KILL] Auto-bot til Manager of the Week. Over-engineering foer traditionen overhovedet koerer manuelt. Luk.
- #451 [ux-polish,b0,KILL] Skal alle auktioner pinges i Discord? Reporter loeste det selv med mute; design-note, ikke et issue. Luk.
- #464 [infra-ops,b0,KILL] Monitorér Actions-minutter efter privatisering (maj) — vinduet er passeret uden loft-smerte. Tjek én gang og luk.
- #523 [infra-ops,b0,KILL] Playwright-browser-setup paa anden PC efter audit-fejl i maj. Sandsynligvis forældet/loest; verificér og luk.
- #563 [security,b0,KILL] Beslutning om OneDrive-secret-decommission; deadline 1/6 passeret og Infisical er i drift. Verificér rest og luk.
- #609 [ai-ops,b0,KILL] Investigation: Bash-tool fejler paa PS-syntax. Harness-guidance daekker nu klassen; luk medmindre det stadig bider.
- #615 [infra-ops,b0,KILL] Teoretisk cron-race i auktionsfinalisering; finance er idempotent. Tag issuets egen option C: acceptér + luk til #330.
- #622 [ai-ops,b0,KILL] Evaluering af Claude Code Routines; housekeeping-routine kører allerede live. Luk meta-trackeren, behold konkrete fixes.
- #624 [ai-ops,b0,KILL] Cloud-routine som post-deploy-verifier — behovet dækkes billigere af simpel alerting (#621). Luk som over-engineering.
- #629 [ai-ops,b0,KILL] Evaluering af Anthropic Memory Stores/Dreaming til cloud-agenter — AI-ops-spekulation uden spillerværdi. Luk klyngen.
- #630 [ai-ops,b0,KILL] Memory Store som context-backend for routines — spekulativ og afhænger af #622-adoption. Luk med #629-klyngen.
- #631 [ai-ops,b0,KILL] Ugentligt 'Dreaming'-job over routine-transcripts — spekulativ AI-ops uden spillerværdi. Luk.
- #632 [ai-ops,b0,KILL] Pilot: cloud memory store til Discord-bridge-state — overhales af planlagt Discord-servermigration. Luk.
- #633 [ai-ops,b0,KILL] Investigation af lokal-cloud memory-sync — eksplicit langtids, ingen akut værdi. Luk.
- #637 [ai-ops,b0,KILL] 5-min oprydning af stale scheduled tasks på EmmaPC (fra maj) — sandsynligt forældet. Luk eller tag ved lejlighed.
- #671 [marketing-growth,b0,KILL] Brand-minimum (accentfarve + font + wordmark) er markeret claude:done — luk issuet.
- #680 [epic,b0,KILL] TdF-launch-sprint-epic med deadline 20/6 (passeret). Luk epic'en; kør resterende (#672/#679) som enkeltissues.
- #734 [ai-ops,b0,KILL] Cowork-playbook-doc — overlapper kanal-matrix-reworket i #1341. Luk som duplikat/overhalet.
- #735 [ai-ops,b0,KILL] Manuel sync af claude.ai/Cowork-projektinstruktioner efter PR #732 (maj) — sandsynligt stale. Luk.
- #794 [rider-profile,b0,KILL] Fuld rework af rytter-historik-siden — overhalet af rytterprofil-capstone #2000 (design i gang). Luk som dublet.
- #873 [ai-ops,b0,KILL] Hardening af Codex-doctor-script. Codex blev droppet 14/6 — Codex-specifik tooling er forældet, luk.
- #886 [ai-ops,b0,KILL] Sentry write-token til auto-resolve. Over-engineering; manuel resolve er sjælden og lav friktion (issuet siger det selv).
- #944 [andet,b0,KILL] Forretningsplan-doc. Overhalet af docs/BUSINESS_STRATEGY.md + ny CZ Pro-model (gamle tier-navne er stale). Luk.
- #977 [ux-polish,b0,KILL] Spekulativ konsolidering af bannere i 'Næste træk'. Intet akut problem — luk, genbesøg ved dashboard-rework.
- #988 [ux-polish,b0,KILL] Pointudviklings-graf ser grim ud. Dækkes naturligt af resultat-hub/snapshot-rework — luk som selvstændigt issue.
- #1132 [ux-polish,b0,KILL] 2-min ejer-eyeball af board-wizard-fix der har været live og lokalt verificeret siden 7/6 — luk, minimal risiko.
- #1144 [ai-ops,b0,KILL] Codex-æra harness-gate-epic for relaunch 20/6. Relaunch gennemført; disciplinen lever i simulér-før-ship + #1199. Luk.
- #1284 [ai-ops,b0,KILL] MEMORY.md-trim fra 11/6 (2.041 tok). Overhalet: re-trimmet 25/6 og budget-gate kører ved close-out. Luk.
- #1406 [marketing-growth,b0,KILL] Morningscore-trial var tidsboks der udløb ~29/6 — vinduet er passeret. Luk; evt. genopret hvis værktøjet købes.
- #1608 [epic,b0,KILL] Divisions-skalerings-epic — tier/pulje-pyramiden shippede ved forever-relaunch; resten lever i #1688. Luk som overhalet.
- #1616 [andet,b0,KILL] Meta-agenda for 20/6-beslutninger — flere punkter allerede afgjort (præmie ÷20, pyramide). Luk; rest lever i egne issues.
- #1788 [infra-ops,b0,KILL] Discord 429 fra delt Railway-IP — benign, Sentry re-alerter selv ved eskalering. Issue tilføjer intet; luk.
- #1944 [infra-ops,b0,KILL] Bun-evaluering — issuet konkluderer selv 'ikke nu' og foreslår won't-do. Luk; genåbn hvis install-fart bliver smerte.
- #2061 [andet,b0,KILL] Patch-note for kontekst-login — v6.40 (PR #2062) inkluderede iflg. #2063 allerede #2042-noten; luk som done.

## Bilag B — Dublet-par (fra audit; high=lukket i dag, medium/low=afventer godkendelse)

keep #1997 / close #794 [medium] Rework af RiderStatsPage (faner: Resultat/Sæson/Bud) dækkes af verdensklasse-historik #1997 + Slice 6 (#2010) under epic #2000.
keep #1996 / close #542 [medium] Transfervinduet er afskaffet (altid-åbent marked); lifecycle_phase-refactor af transfer_windows er mod når #1996 fjerner koden.
keep #1903 / close #673 [medium] Samme arbejde: Alunta-betaling + Founder-tier. #1903 (CZ Pro Slice 1) har nyere besluttet model, spec og plan.
keep #1602 / close #797 [medium] Mobil-visning af brede rytter-tabeller dækkes af epicens delte ResponsiveTable/DataTable + kolonne-prioritering + sticky kolonne.
keep #415 / close #679 [medium] TdF-subset af Discord-epicen; epicens status-audit viser welcome/roller/kanaler stort set leveret, deadline 20/6 er passeret.
keep #1369 / close #135 [medium] Næsten identisk North Star og metrik-loop (retention + de fire produktmotorer); #1369 er nyere og dækker hele funnel.
keep #26 / close #311 [medium] 'På Hold'-watchlist = shortlist-komponenten i transfer-war-room (#26): gem ryttere man overvejer, uden ønskeliste-forpligtelse.
keep #955 / close #165 [low] Overall-tilfredsheds-bar hører ind i board-UI-rework-epicen; #165 foreslår selv grupperingen. Tilføj som punkt i epicens checkliste.
keep #955 / close #101 [low] Vis bestyrelsens konkrete effekter er naturlig del af samme board-rework; bør ind som punkt i epicens checkliste før luk.
keep #1341 / close #389 [low] Manus-noter-audit (OneDrive → docs/research/) er naturlig del af Manus-udfasningen i #1341; fold scope ind dér.
keep #442 / close #2017 [low] Begge er CodeQL-alert-hygiejne (dismiss falske positiver); fold docs/**-ekskluderingen ind i #442's housekeeping-pas.
keep #986 / close #241 [low] Spotcheck/iteration på sæson-finansrapporten (fra maj, Slice 07h) foldes naturligt ind i økonomiside-reworken — samme flade.
keep #1441 / close #97 [low] Hard debt-ceiling-beslutningen hører hjemme i den langsigtede økonomi-epic; #97 har stået blocked siden maj.
keep #62 / close #976 [low] Min Aktivitet→Indbakke-foldningen afgøres af Today/Manager-Inbox-epicens IA — samme mentale model (beskeder + handlinger).
keep #330 / close #615 [low] Job-locking i #330 løser tick-overlap generelt; #615's punkt-guard på finalizeExpiredAuctions bliver overflødig.
keep #1677 / close #1178 [high] Samme feature: fyr/frigiv rytter fra holdet. #1677 er nyest med accept-kriterier og økonomi-kobling; #1178 er én linje fra ældre spec.
keep #1994 / close #985 [high] Ejer besluttede 29/6 at fjerne lejefunktionen helt (0 aftaler i prod, #1994) — forbedringsønskerne i #985 er dermed forældede.
keep #2008 / close #918 [medium] #918 er claude:done, og Dev-fanens rework (PCM-historik → evne-historik) dækkes fuldt af #2008; #1136/L0 angiver 'løser #918'.
keep #2010 / close #923 [medium] #923's ønske (PCS-stil resultat-filtrering/palmarès) leveres af rytterside-rework #2000 slice #2010; ejer skrev selv 'rework planlagt'.
keep #1875 / close #1017 [medium] Valgt retning er mock-previews (#1867/#1875) med sentinel der bevidst blokerer prod-login på previews — #1017's mål dækkes ad den vej.
keep #1290 / close #873 [medium] Codex er udfaset (Claude-only, 12/6). Codex-doctor-hardening er formålsløst; #1290 ejer netop re-triage/oprydning af codex-issues.
keep #1239 / close #1110 [low] #1239's katalog af sportslige fokus-typer + mål-templates dækker #1110 (board-mål efter ryttertyper); merge ind i design-sessionen.
keep #1996 / close #956 [low] Deadline Day/transfervinduet er afskaffet (altid-åbent marked; endpoints fjernet i #1926) — #956-epicens præmis findes ikke længere.
keep #1774 / close #1975 [medium] Samme rod: hardkodet globalt '60 racedays' i stedet for per-division-tal. Flyt kun 1975's lille DA-oversættelses-del med over i 1774.
keep #1799 / close #2032 [low] Begge er akademi-placerings-fejl. 2032 er lav-evidens og peger selv på 1799 som relateret; bør undersøges/fixes samlet.
keep #1712 / close #1899 [low] 1899's race_days_total-beslutning er allerede dækket af 1712's scope/acceptkriterier (+ #1856-planens per-division-model).
keep #1900 / close #1835 [high] #1900 er split af #1835: race-hub-halvdelen (S6) er shippet, resten videreført ordret i #1900. #1835 er claude:done.
keep #1984 / close #1983 [medium] #1984 subsumerer #1983: læsbar overlap-status pr. rytter/løb + falsk-positiv-verify (zootnes case i begge). Begge claude:done.
keep #1975 / close #1774 [medium] Samme rod: hardcodet/globalt '60 racedays' skal være per-division. #1975 nyest (post-#1958-rebuild); #1774's tal er stale.
keep #1922 / close #1894 [low] Trænings-rework #1922 omdefinerer fokus/default-modellen; #1894 (smart default) giver kun mening som quick-fix før rework.
keep #2000 / close #1833 [low] Rytter-rework #2000 (+ hover-kort #2009) erstatter evne-visningen; #1833's tooltip-forklaring bør foldes ind i epic'ens slices.
keep #1819 / close #1818 [low] Begge gen-kører #1441/#1606-scorecards mod aktuel virkelighed (12-trup-løn hhv. ppp=75) — én samlet re-kørsel dækker begge.
