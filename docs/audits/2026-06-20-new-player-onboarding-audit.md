# Ny-spiller onboarding-audit + handlingsplan (2026-06-20)

> **Formål:** Komplet gennemgang af hele hjemmesiden, alle undersider og funktioner **strikt fra en splinterny spillers perspektiv** — så siden er præsentabel og ikke skræmmer nye brugere væk. Bestilt som forberedelse til den permanente forever-relaunch (epic [#1105](https://github.com/NicolaiDolmer/CyclingZone/issues/1105)).
>
> **Samlet dom:** `rough-but-shippable`. Bunden er overraskende solid og editorial (wordmark-only header, ægte cykel-data, fuld EN/DA-paritet, ingen gradients/glow, bevidste tom-tilstande). Ingen hård crash fundet. **Men** den offentlige indgang + signup-seamen + førstehåndsindtrykket har flere ting der sandsynligvis skræmmer nye spillere væk i deres første session. Det er rettbart — overvejende S/M-effort copy- og flow-fixes.

## Metode (hybrid)

1. **Kode+copy fan-out (13 agenter):** Hele appen opdelt i 10 rejse-klynger + 3 cross-cutting lenses (copy/i18n, visuel smag, flow-seams). Hver agent scorede mod et fast nyt-spiller-rubrik ved at læse **både** sidekode **og** den faktiske copy i begge sprog (`public/locales/{en,da}/`). → **91 findings**.
2. **Adversarisk kritik:** En selvstændig kritiker-agent reviewede planen for huller, overdrivelser og forkert rækkefølge. Dens korrektioner er foldet ind nedenfor (markeret 🔧).
3. **Visuel spot-check (ejer-relevant):** Den offentlige indgang (landing + login/signup) verificeret live i lokal dev. Bekræftede landing-CTA-problemet. Den logget-ind kritiske sti ligger i ejer-click-through-tjeklisten (Fase 0).

### Klynge-sundhed
| Klynge | Sundhed | | Klynge | Sundhed |
|---|---|---|---|---|
| A1 Entry & auth | rough | | A8 Racing & results | rough |
| A2 First-run & shell | rough | | A9 Social & meta | rough |
| A3 Riders & market | rough | | A10 Help, info & trust | rough |
| A4 Auctions & transfers | rough | | X1 Copy/tone/i18n | rough |
| A5 Team & tactics | rough | | X2 Visuel smag / anti-slop | **solid** |
| A6 Training & academy | rough | | X3 Flow-seam simulation | rough |
| A7 Finance | rough | | | |

---

## De største skræk-faktorer (det vigtigste først)

| # | Skræk-faktor | Sev | Hvor | Evidens |
|---|---|---|---|---|
| 1 | **Landing sælger spillet som "åbner snart / join Discord / få launch-mailen"** — selvom spillet er live og tager imod spillere NU. Eneste signup er en lille topbar-knap. Kolde besøgende ender på en venteliste i stedet for at oprette hold. | **P0** | `/` | `LandingPage.jsx:168-181` (hero har kun Discord + waitlist); FAQ: "a fresh season opening soon" |
| 2 | **Signup→email-confirm→login-seam er selvmodsigende + fejler tavst.** "Dit hold er klar" vises samtidig med "bekræft din email og log ind". Login før bekræftelse fejler med generisk "forkert email/adgangskode". Ingen visning af hvilken email der blev sendt til. | **P0** | `/login?mode=signup` | `LoginPage.jsx:104,194-276` |
| 3 | **Kerne-loopet er usynligt i onboarding** 🔧 — holdudtagelsen (line-up + kaptajn/spurt-kaptajn/jæger til næste løb) ligger *kun* begravet på løb-detalje-siden. Ingen af onboardingens 4 trin nævner den, selvom "outthink the field" er hero-løftet. Auto-fill redder spilleren fra at blive blokeret, men de lærer aldrig kerne-handlingen. | **P1** | `/races/:id` (`RaceSelectionPanel.jsx`) | `RaceDetailPage.jsx:201`; onboarding-trin = navngiv/køb/byd/board — ingen line-up |
| 4 | **15 evne-koder uden legende blokerer det første rytter-valg.** Tabellen viser `CLM/TT/FLT/TMP/SPR/ACC/PCH/END/REC/DUR/DSC/COB/POS/AGR/TAC` uden tooltip/legende. Onboarding-tippet peger på forkerte *gamle* koder (`BJ/SP`), og detalje-siden bruger ANDRE navne (Mountain/Flat). | **P1** | `/riders` → `/riders/:id` | `RidersPage.jsx` SortTh; `riders.json` emptyState.tipStats |
| 5 | **Blindgyde-tom-tilstande:** tom trup på `/team` ("No riders on the team yet" uden CTA), alle 6 transfer-faner tomme uden onboarding, og dashboard-onboarding (den eneste guide) kan dismisses **permanent** ved ét fejlklik. | **P1** | `/team`, `/transfers`, `/dashboard` | `DashboardPage.jsx:80-81,411` |
| 6 | **To "coming soon"-dead-ends i hovednavigation** — `/academy` ("coming soon. Stay tuned.") og `/training` ("Daily training starts at the relaunch") signalerer halvfærdig/forladt app ved udforskning. | **P1** | `/academy`, `/training` | nav-items i `Layout.jsx` |
| 7 | **PatchNotes viser hver note dobbelt (EN+DA) + interne dev/security-noter** (exploits, SQL, fil-stier) → ligner et log-dump. *(Sekundær side — sjældent ramt i første session, derfor flyttet til Fase 3.)* | P2 | `/patch-notes` | `PatchNotesPage.jsx` (ingen i18n-filter) |

🔧 **Kritik-note om emoji:** Fan-out'en fandt en systematisk emoji-i-chrome-overtrædelse (69 forekomster, 18 filer) der bryder din anti-AI-slop-regel. Det er **reel brand-gæld**, men kritikken har ret i at det er *over-vægtet som skræk-faktor* — en emoji i en knap driver ikke frafald som en knækket signup-seam gør. Derfor: kun de onboarding-flader en ny spiller møder i sin første session er rykket op i Fase 1; resten er backlog-polish (Fase 4).

---

## Fase 0 — Ejer-verifikation FØRST (blokerer kodning af Fase 1)

Flere Fase 1-fixes hviler på fakta kun ægte prod-data kan bekræfte. Kør denne click-through før vi koder, ellers bygger vi på antagelser. **~15 min, inkognito + telefon:**

1. **Inkognito → cyclingzone.org som kold besøgende.** Hvad er den mest fremtrædende handling? Tror du spillet er åbent nu eller "kommer snart"? Hvor mange klik til "opret hold"?
2. **Opret en HELT ny konto (frisk email).** Tag tid: signup-klik → brugbart dashboard. Notér HVER besked undervejs (især success-skærmen) — modsiger de hinanden?
3. **Bekræftelsesmailen:** kom den? Afsender/emne troværdigt? Spam? Virker linket? Hvor længe tog den? *(Mail-templaten er det ene off-app-skridt og er helt uverificeret.)*
4. **Log bevidst ind FØR du klikker bekræftelseslinket.** Hvilken fejl? Forstår en ny spiller at det er pga. manglende bekræftelse?
5. **Dashboard:** har din nye konto en **starttrup** (ryttere) eller er den **tom**? → afgør hvilket onboarding-narrativ der er korrekt ([#1560](https://github.com/NicolaiDolmer/CyclingZone/issues/1560)).
6. **`/auctions` + `/transfers` (Market):** er der FAKTISK købbare ryttere i den friske liga? Hvis tom, fører hele rådet "køb din første rytter" til en blindgyde.
7. **Køb/byd på én rytter → `/races` el. dashboard:** kan du finde ud af HVORNÅR næste løb er, og hvordan du stiller op? *(kerne-loop-test)*
8. **Fejlklik X på "Get started"-kortet → genindlæs:** er guiden væk for altid?
9. **GENTAG signup→første-bud på TELEFON.** Virker felter, bekræftelses-knapper og bud-modal? Noget afskåret på smal skærm?
10. **`/riders` som ny spiller:** kan du afkode `CLM/TT/FLT…` uden at gætte?

---

## Fase 1 — First-session-blockers (kritisk sti: signup → første bud → første løb)

> Mål: fjern alt der dirigerer en ægte ny spiller væk fra at spille, sender modstridende/tavse signaler, eller blokerer det første rytter-valg. **Ship #1 og #2 SAMMEN** — den højeste-leverage handling (landing-CTA) sender bare flere folk ind i en knækket onboarding hvis seamen ikke er fikset.

| # | Handling | Sev | Effort | Filer |
|---|---|---|---|---|
| 1 | **Gør "Opret hold / Spil nu" til primær hero-CTA** (link `/login?mode=signup`) + omskriv "opening soon"-copy til "play now". Behold Discord/waitlist som sekundære. Ny nøgle `hero.ctaPlay`. | **P0** | M | `LandingPage.jsx`, `landing.json` (en+da) |
| 2 | **Ret signup-seamen til ét entydigt skridt med kvittering:** "Vi har sendt en bekræftelsesmail til {email} — åbn den og klik linket, så kan du logge ind". Fjern modstridende "Your team is ready". Map Supabase "email not confirmed"-fejl til egen besked. | **P0** | M | `LoginPage.jsx`, `auth.json` (en+da) |
| 3 | 🔧 **Gør kerne-loopet synligt:** tilføj et onboarding-trin/-pointer "Udtag dit hold til næste løb", forklar `Suitability/Form/Fatigue` + rollerne (kaptajn/spurt-kaptajn/jæger) med tooltips, og gør auto-fill tydelig ("vi har valgt for dig — juster her"). | **P1** | M | `RaceSelectionPanel.jsx`, `DashboardPage.jsx`, `races.json` (en+da) |
| 4 | **Stop permanent-dismiss af dashboard-onboarding ved 0/4 trin** — vis kortet så længe `completed < total` uanset dismiss (eller flyt X til sessionStorage). Behold permanent-dismiss kun ved 4/4. | **P1** | S | `DashboardPage.jsx:411` |
| 5 | **Evne-legende + tooltips på `/riders`** (title pr. stat-SortTh + altid-synlig kollapsbar legende for alle 15 koder, genbrug `rankings.legend`) + **ret forkert tip** (`BJ/SP/TT` → faktiske koder/fulde ord). | **P1** | M | `RidersPage.jsx`, `riders.json` (en+da) |
| 6 | **Tom trup på `/team` → guidende start:** "Your squad is empty. Sign riders from the auctions or transfer list to get started." + primær knap til `/riders`/`/auctions`. Ny nøgle `squad.emptyState`. | **P1** | S | `TeamPage.jsx`, `team.json` (en+da) |
| 7 | **Onboarding-intro på `/transfers`** (som `AuctionsFirstBidHint`): forklar transfer vs. auktion, hvor man finder ryttere (Market-fanen), at Swaps/Loans er valgfrie. **Default 'Market'-fane** når 0 tilbud. | **P1** | M | `TransfersPage.jsx`, `transfers.json` (en+da) |
| 8 | **Fjern "coming soon"-dead-ends:** skjul `/academy` + `/training` nav-items indtil de er live, ELLER gør dead-end-siderne guidende (forklar hvad de bliver + CTA tilbage). Drop vag "Stay tuned". | **P1** | M | `academy.json`, `training.json`, `common.json` |
| 9 | **Fix de allerførste onboarding-flader** (de er literalt første in-app-indtryk): `SetupWizardModal` Monogram→Wordmark + `rounded-2xl`→`rounded-cz`; `OnboardingModal`/`CompletionCard` emoji-eyebrow → editorial-markør; mobil-topbar hamburger/klokke-emoji → SVG-ikon. | **P1** | M | `SetupWizardModal.jsx`, `OnboardingModal.jsx`, `OnboardingCompletionCard.jsx`, `Layout.jsx` |
| 10 | **Default `/auctions` til 'All'-fane** når `mySituationCount===0` (altid sandt for ny spiller), så fladen åbner med faktiske auktioner. | P2 | S | `AuctionsPage.jsx` |

---

## Fase 2 — Jargon-afkodning + tom-tilstand-guidance (forståelse)

> 🔧 Promoveret over den kosmetiske emoji-sweep: dette afgør om spilleren *forstår* spillet.

| Handling | Sev | Effort | Filer |
|---|---|---|---|
| **Definér CZ$ + Division + GC + Deadline Day ved første kontakt** (title-tooltips på sidebar-balance, Division-linje, GC i rankings, Deadline Day ved flash-auktion) + CZ$ i help-glossar. | P2 | M | `Layout.jsx`, `TeamPage.jsx`, `help.json`, `dashboard.json` |
| **Synkronisér stat-terminologi** (Help-glossar vs. rytter-tooltips; `UDH=Endurance`, `MOD=Resilience`) + rytter-type-tooltips (Baroudeur/Rouleur…) + `RiderStatsPage` bestStat/typeLabel afledt af de 15 CZ-evner (ikke gamle PCM-STATS). | P2 | M | `help.json`, `rider.json`, `riderTypes.json`, `RiderStatsPage.jsx` |
| **Gør dashboard- + akademi-tom-tilstande guidende** (CTA-linje i hver: auctions→browse riders, transfers→market; akademi: én samlet guidende tilstand). | P2 | M | `DashboardPage.jsx`, `dashboard.json`, `AcademyPage.jsx` |
| **Forenkl Finance-forecast for nul-historik** (skjul horisont-vælger + 20%-range i intro-sæson, vis "First season — rough estimate") + ret DA `Lejegebyr`→`Lånegebyr`. | P2 | M | `FinanceForecastCard.jsx`, `finance.json` (en+da) |
| **Konsolidér til ÉT onboarding-system på dashboard** (vælg progress-kortet som sandhed; reducér `OnboardingModal` til 1-skærms intro uden egen handlingsliste; betinget på squad-state). | P2 | M | `OnboardingModal.jsx`, `OnboardingProgressCard.jsx`, `DashboardPage.jsx` |

---

## Fase 3 — Tillids-copy + målrettet polish (de flader nye spillere møder)

| Handling | Sev | Effort | Filer |
|---|---|---|---|
| **PatchNotes:** render kun aktivt sprog (i18n-filter) + skjul interne dev/security-noter. | P2 | L | `PatchNotesPage.jsx` |
| **Ret tillids-brydende copy:** i18n-leak `Loan fee (renter)`→`Loan fees`; fjern dead-end-løfte "Full elevation profiles arrive later"; fjern Monogram fra `FounderSupporterPage`. | P2 | S | `dashboard.json`, `races.json`, `FounderSupporterPage.jsx` |
| **Cookie-banner mindre dominant** (visuel spot-check: stor centreret modal dækker hero ved første besøg). GDPR-krævet → gør den bottom-anchored/mindre, fjern den ikke. | P2 | S | `CookieBanner.jsx` |
| **Academy/Training:** 1-2 sætnings intro under titlen (genbrug help `whatAcademy`/`whatDailyTraining`) + "Learn more"-link; oversæt `TrainingPage` runError. | P1 | S | `AcademyPage.jsx`, `TrainingPage.jsx`, `academy.json`, `training.json` |
| **Racing copy:** `results imported`→"Results appear here once this race has been run"; DA-nits `Igang`→`I gang`, `løb spillet`→`løb afviklet`, `relanch`→`relancering`. | P3 | S | `races.json`, `standings.json`, `training.json` (da) |
| **Fjern/redirect død `/hall-of-fame`-rute** (eller → `/standings`) + tilføj "first 10 minutes"-boks øverst på `/help`. | P3 | S | `App.jsx`, `HelpPage.jsx` |

---

## Fase 4 — Editorial konsistens + brand-gæld (backlog)

| Handling | Sev | Effort | Filer |
|---|---|---|---|
| 🔧 **Global emoji-i-chrome sweep** (de resterende ~60 forekomster *udenfor* onboarding-fladerne) → SVG-ikoner el. farve/tekst. Spejl i `da/`. | P2 | M | `rider/team/races/auctions/transfers/finance/seasonEnd.json` |
| **Indfør delt `PageHeader` m/ Bebas display-font** i hele indlogget app (erstat hånd-rullede `text-xl font-bold` h1'er). | P2 | M | `ui/PageHeader.jsx` + sider |
| **Luk radius/skygge-token-drift** (9 rå `rounded-2xl`→`rounded-cz`; `shadow-2xl`→overlay-token; evt. ESLint-guard). | P3 | S | `BoardPage.jsx`, `CookieBanner.jsx`, `BidConfirmModal.jsx` |
| **Mikro-polish:** watchlist H1 `Talent scout`→`Watchlist` (match nav); compare-empty værdi-linje + meningsfuldt ikon; Discord-kort på `/profile` kollapset. | P3 | S | `watchlist.json`, `RiderComparePage.jsx`, `ProfilePage.jsx` |
| **(Valgfri)** Sidebar progressive disclosure for nye konti. 🔧 *Svagt grounded — grupperne er allerede collapsed. Vurdér ROI før indsats.* | P2 | M | `Layout.jsx` |

---

## Quick wins (samme dag, S-effort, høj leverage)

- Stop permanent-dismiss af dashboard-onboarding (`DashboardPage.jsx:411`) — ét fejlklik dræber ellers den eneste guide.
- Ret `riders.json` `emptyState.tipStats` (`BJ/SP/TT` → faktiske koder/fulde ord).
- Tom trup på `/team` → guidende CTA mod `/riders`.
- Default `/auctions` til 'All'-fane når `mySituationCount===0`.
- Ret i18n-leak `Loan fee (renter)`→`Loan fees` + DA `Lejegebyr`→`Lånegebyr`.
- `SetupWizardModal`: Monogram→Wordmark + `rounded-2xl`→`rounded-cz`.
- DA-nits: `Igang`→`I gang`, `løb spillet`→`løb afviklet`, `relanch`→`relancering`.
- Fjern/redirect død `/hall-of-fame`-rute.

---

## Kendte huller i auditten (ærlig afgrænsning)

Auditten var kode+copy + visuel spot-check af den offentlige indgang. Følgende er **ikke** fuldt dækket og bør verificeres af ejer / i en opfølgning:

- **Kerne-loopets payoff-øjeblik:** hvad ser en ny spiller når deres *første løb afvikles*? (notifikation? hvor finder jeg mit resultat?) Retention hænger på at det føles som en belønning — uauditeret.
- **Mobil:** kun emoji-i-topbar fanget. Signup-formular, bud-modal og bekræftelses-knapper på ~380px er ikke verificeret (Fase 0 punkt 9).
- **Bekræftelsesmailens indhold:** afsender, emne, om linket virker, spam-risiko. Det ene off-app-skridt, helt uverificeret (Fase 0 punkt 3).
- **Loading/fejl-tilstande:** hvad ser en ny spiller ved langsom load / netværksfejl på dashboard. En hvid skærm skræmmer mere end nogen emoji.
- **Ejer-beslutning (ask-first):** er "Free to play right now" acceptabelt, eller skal gratis-løftet blødgøres yderligere? "The full game is free" er IKKE ordret "free forever", så det er en smags-fortolkning — afgøres af dig, ikke auto-fixes.

---

## Næste skridt (anbefaling)

1. **Kør Fase 0-tjeklisten** (~15 min) — den afklarer de 2 P0'er + #1560-spørgsmålet.
2. **Godkend planen** → jeg opretter GitHub-issues for Fase 1 (de ~10 first-session-blockers), evt. som én fleet-bølge.
3. **Implementér Fase 1**, ship #1+#2 sammen, verificér live.
4. Fase 2-4 som løbende kvalitets-batches mod forever-relaunch.

> Kilde: workflow-fan-out `wf_6117f146` (13 agenter, 91 findings) + adversarisk kritik + visuel spot-check, 2026-06-20.
