# AI-slop audit, hele frontenden (2026-06-20)

Komplet gennemgang af alle player-facing flader og funktioner for "AI slop", kalibreret mod founder-reglerne (Whoop/Linear/Rapha-DNA, flad 2-farve guld+navy, ingen glow/gradient/backdrop-blur, SVG-ikoner ikke emoji, hairline-radius, Bebas/DM Sans/Inter Tight, ingen em-dash, ingen "free forever", ingen intern vokabular i player-tekst). Reference: `memory/feedback_anti_ai_slop_design_taste.md`, `docs/brand/BRAND_BRIEF.md`, `docs/TONE_OF_VOICE.md`.

## Metode + pålidelighed

44 flader auditeret af en agent hver (5 fundament-agenter for det delte lag + 39 flade-agenter), mod én fælles checklist. Admin-sider er bevidst ekskluderet (interne, kun ejer ser dem). Data: `2026-06-20-ai-slop-findings.json` (rå, alle felter inkl. evidens) ligger ved siden af denne fil.

Forbehold: orkestreringen hang to gange på landing-agenten (kontekst-overload), så den blev kørt om via engine-retry. Selve audit-dataen er komplet for alle 44 flader. Per founder-reglen er denne rapports domme IKKE selv-godkendte: hver P0 skal verificeres visuelt/mod kode før den lukkes.

### Uafhængig kontrol (read-only agent, mod kildekode)

Alle 8 P0 blev verificeret REELLE mod koden, inkl. den kritiske gmail/issue-læk (P0 #6, bekræftet linje-for-linje: `founder.json` l.131 + l.163, `FounderSupporterWaitlistForm.jsx` l.231). Genuine tilføjelser fra kontrollen: konkrete off-palette hex i `HallOfFamePage.jsx` (#60a5fa/#a78bfa/#34d399/#f97316/#ef4444/#ec4899) og `RaceDetailPage.jsx` (#22c55e/#ef4444), samt bekræftet `backdrop-blur-md` på FounderSupporter sticky-header (l.220). Kontrollens egen "lav tillid"-dom diskonteres: den havde kun de 8 P0 at måle mod (ikke de fulde 305), så flere "gaps" er fejl (den antog 2-3 emoji fundet hvor der er 88; den listede Academy/Help/Training/Watchlist som udækkede, men de ER auditeret med scores). Konklusion: P0 står stærkt; den fulde finding-liste er mere komplet end kontrollen kunne se.

## Samlet dom

Siden er IKKE bredt slop-ramt. Fundamentet er faktisk disciplineret: `components/ui/`-biblioteket scorer 1/10, design-tokens og nav scorer 3/10, og **landing-siden scorer 1/10** (den tidligere #672-redesign holder, ren editorial, ingen glow/gradient/emoji/em-dash). Login scorer 2/10.

Problemet er **drift, ikke fravær af system**: ~35 sidefiler omgår det eksisterende design-system. 305 fund fordeler sig på 8 P0, 127 P1, 170 P2. **70% af alt (214 fund) er fire mekaniske kategorier**: emoji brugt som ikoner (88), farve-drift væk fra tokens (48), over-rundede hjørner (47), forkert font (31). De er masserettelige via token-håndhævelse + et sweep, ikke 35 individuelle redesigns.

Det der reelt kan skræmme nye brugere væk er en lille, fokuseret liste (se P0 + new-user-kritisk sti), anført af FounderSupporter-siden (public, scorer 6/10) der lækker din private gmail, interne issue-numre og intern vokabular til offentligheden.

## Systemiske rod-årsager

1. **Tokens er opt-in, ikke håndhævet.** `tailwind.config.js` overskriver ikke Tailwinds default radius-skala, så `rounded-xl/2xl` er frit tilgængelig (149 forekomster i 35 filer). `backdrop-blur` er heller ikke disablet (5 hand-rullede modaler bruger den, selvom Modal-primitiven bevidst har testet blur væk). `fontFamily` mangler en `sans`-nøgle, så `font-sans` IKKE er DM Sans. Fix ét sted, og en stor del af drift bliver umulig.
2. **Komplet SVG-ikon-system findes, men bruges ikke konsekvent.** `ui/icons/` eksporterer ikoner der eksplicit skal "erstatte ALLE emoji", men 88 steder (JSX + locale-JSON) bruger stadig rå emoji/unicode-glyffer (☰ 🔔 ▾ ✓ 🏪 🔨 🏛️ 🎉 ★ osv.).
3. **Ingen lint/CI-guard mod drift.** Der er source-tests der håndhæver "ingen glow/blur" på primitiverne, men intet stopper en side i at hand-rulle slop udenom primitiverne.
4. **Locale-filer er en blind vinkel.** Emoji og copy-slop er bagt ind i `public/locales/*.json`, ikke kun i JSX, så et JSX-only sweep misser dem.

## De 8 P0 (gør først, public/first-impression eller grove)

| # | Flade | Issue | Fil |
|---|-------|-------|-----|
| 1 | Modaler | Konfetti med regnbue-off-palette + animate-bounce | `ConfettiModal.jsx` |
| 2 | Auktion | Emoji som primært ikon (text-4xl, 🏷️/🤖/💼) | `BidConfirmModal.jsx` + `auctions.json` |
| 3 | Onboarding | Emoji-kort som ikoner (🏪🔨🏛️) på FØRSTE skærm efter signup | `OnboardingModal.jsx` |
| 4 | Privacy (public) | `rounded-2xl shadow-lg` i stedet for husets `rounded-cz` | `PrivacyPolicyPage(.En).jsx` |
| 5 | FounderSupporter (public) | Guld-glow shadow på submit-knap (hardcoded hex) | `FounderSupporterWaitlistForm.jsx` |
| 6 | FounderSupporter (public) | **Privat gmail + interne issue-numre (#361/#362/#363/#415) + intern vokabular lækker til offentlig side** | `locales/en|da/founder.json` |
| 7 | FounderSupporter (public) | Emoji/glyffer som ikoner (🎉 ★ '+' '·') | `FounderSupporterWaitlistForm.jsx` + `FounderSupporterPage.jsx` |
| 8 | FounderSupporter (public) | Hero + alle overskrifter i brødfont, ingen Bebas display nogen steder | `FounderSupporterPage.jsx` |

P0 #6 er ikke design-slop, det er en professionalisme/privatlivs-læk på en offentlig side. Den bør rettes med det samme, uafhængigt af resten.

## Handlingsplan (work packages, prioriteret)

### WP0, lås fundamentet (rod-årsag, højest leverage). Effort: M
Forhindrer at drift sker igen OG muliggør sweeps.
- Overskriv Tailwind radius-skala i `tailwind.config.js` så kun brand-radii findes (`rounded-cz` = 5px, `cz-pill`, `full`); map eller fjern `xl/2xl/3xl`.
- Disable `backdropBlur` i config (eller migrér de 5 hand-rullede modaler til `Modal`-primitiven).
- Tilføj `sans: ['"DM Sans"', ...]` til `fontFamily`; self-host DM Sans på linje med Bebas/Inter Tight (fjern render-blocking Google Fonts-link).
- Tilføj ESLint/source-test-guard: ingen rå `rounded-xl/2xl`, ingen rå Tailwind-farver (`green-400`, `blue-500` osv.), ingen emoji i JSX/locale-værdier.

### WP1, emoji → SVG-ikon-sweep (88 fund). Effort: M-L
Mekanisk, høj synlig effekt. Erstat alle emoji/glyf-ikoner med eksisterende `ui/icons` (tilføj de få der mangler, fx Briefcase). Dækker BÅDE JSX og locale-JSON. Tunge filer: `HelpPage.jsx` (6), `team.json` (5), `WatchlistStar.jsx` (4), `BoardPage.jsx` (4), `NotificationsPage.jsx` (4), `Layout.jsx` (3, app-shell), `BidConfirmModal.jsx` (3), `riders.json` (3).

### WP2, farve-drift-sweep (48 fund). Effort: M
Erstat rå Tailwind-farver med `cz-`-semantiske tokens (fx `bg-green-400` → `bg-cz-success`). Tunge filer: `RaceSelectionPanel.jsx` (5), `ConfettiModal.jsx` (3), `TransfersPage.jsx` (3), `SeasonEndPage.jsx` (3), `index.css` chart-palette (3).

### WP3, public + first-impression P0/P1 (front-loadet: "skræm ikke nye brugere"). Effort: M
- **Straks/isoleret:** P0 #6 founder.json-oprydning (gmail → brand-adresse, fjern issue-numre + intern vokabular + debug-prisvariant-label).
- FounderSupporter: kill glow (#5), Bebas på overskrifter (#8), emoji → SVG (#7), editorial-layout-løft (4 generic-layout-fund).
- Onboarding-modal emoji → SVG (#3, første post-signup skærm).
- Konfetti → rolig restrained fejring (#1).
- Privacy: `rounded-2xl` → `Card` (#4).

### WP4, overlays/modaler/bannere (delt, værste område, score 7). Effort: M
backdrop-blur væk, emoji i modaler væk, hand-rullede modaler migreret til `Modal`-primitiven, off-palette confetti fjernet.

### WP5, editorial per-flade-løft (det "rigtige design", generic-layout/uniform-card-grid/centered, ~44 fund). Effort: L
Per founder-modellen "migrér per FLADE" (hele fladen inkl. child-komponenter i én PR). Front-load efter score + trafik: HallOfFame (7), Activity (6), RiderStats (6), PatchNotes (6), Board (6), RaceDetail (5), Help (5), Dashboard, Auctions, Resultater, SeasonPreview, HeadToHead. Dette er løbende kvalitetsarbejde, ikke et engangs-sweep.

### WP6, copy-slop (16 fund). Effort: S
em-dash → komma/punktum (FinancePage, RaceHistory, Academy data-placeholders), emoji i copy (auth/riders/activity.json), AI-marketing ("Dive into"), DA/EN-blanding ("Glemt password?", "Join vores Discord"), "Founder Supporter" rest i SEO-meta, gamification-vokabular ("+25% boost"), forever-claim-formulering. Tone-følsomt: founder-prosa skriver du selv.

## Anbefalet rækkefølge

1. **P0 #6 (gmail/issue-læk)** straks, isoleret. Privatlivs/professionalisme, public side.
2. **WP0** (token-lås + guards). Stopper regression, muliggør sweeps.
3. **WP1 + WP2** (emoji- + farve-sweep). Mekanisk, fjerner 136 fund, stor synlig gevinst, rammer også dashboard/riders/auctions (new-user-sti).
4. **WP3 + WP4** (resten af public + modaler).
5. **WP5** (editorial per-flade, løbende, front-load public + høj-trafik).
6. **WP6** (copy, tone-følsomt).

## New-user-kritisk sti (det der afgør om nye bliver)

Public: Landing (ren ✓), Login (næsten ren), **FounderSupporter (P0-tung, fix først)**, Privacy (P0 #4). Første logged-in: **Onboarding-modal (P0 #3)**, Dashboard (4), Riders (3), Auctions (4). WP0+WP1+WP2 rammer disse sider direkte; WP3 lukker public-fladerne.

## Per-flade score (0 ren, 10 slop)

7: overlays-modals-banners, HallOfFamePage. 6: FounderSupporter, BoardPage, ActivityPage, RiderStatsPage, PatchNotesPage. 5: HelpPage, RaceDetailPage. 4: Races, Team, Dashboard, Transfers, RiderRankings, RacePoints, Resultater, SeasonEnd, Training, Academy, Watchlist, Auctions, TeamProfile, HeadToHead, Privacy, AuctionHistory, RaceHistory, SeasonPreview, Finance(report), Roadmap, copy-sweep. 3: Riders, DeadlineDay, layout-nav-brand, RiderCompare, Profile, design-tokens, Standings, Notifications, Teams, ManagerProfile, Finance. 2: Login+Reset. 1: Landing, ui-component-library.
