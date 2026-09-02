# Youth tiers · Design handoff (Claude Design, 2026-09-02)

Files: `Youth tiers hi-fi.html` (standalone, open in a browser; pan/zoom) · `Youth tiers wireframes.html` (rounds 1 and 2, kept as history).
Artboard ids: 3a Academy · 3b S1b Coming soon · 3c Junior team · 3d My Team, all squads · 3e Youth races, Standings · 3f Youth races, Calendar · 3g Graduation Day · 3h Graduation Day, empty · 3i Rider journey · 3j Rider journey, empty · 3k Move to squad (rider profile).
All names, clubs and amounts are example data. Copy is EN, sentence case, no em-dash.

## Owner decisions taken in this session (EN)

1. Squads are separate areas. Clubhouse nav gains `U23 team` and `Junior team` next to `My Team` (senior). `Academy` stays and is reduced to intake, Graduation Day and accounts. No "squads" block on the Academy page; the squads sit one line away in the sidebar.
2. All three squad pages share the My Team template (T2: PageHeader with squad name, tabs, filter bar, DataTable). Youth squad tabs: Squad · Calendar · Results · Standings · Development. Senior keeps its current tabs.
3. Squad filter in every roster: one Select `Squad: Senior team / U23 team / Junior team / All squads`. `All squads` adds a Squad column (3d). Checkbox-per-squad was rejected.
4. Squad names: default `[Club] U23` / `[Club] Juniors`, renamable via a quiet `Rename` action in the header cluster.
5. Youth races live in two places: the squad page tabs, and a new `Youth races` page under Results (Select U23 team / Junior team + gold `Set tactics`; tabs Calendar · Results · Standings · Rankings). A race is a race.
6. Moving riders: row action `Move up` / `Move down` on the squad page (secondary, never gold) AND `Move to squad` menu in the rider profile hero (3k). Both open the existing AcademyTransferConfirmModal.
7. Gold, one per view: `Sign` on intake cards (Academy), `Set tactics` (Youth races and squad Calendar tab), `Confirm all` (Graduation Day), `Sell / Auction` (rider profile hero, as today). Everything else secondary or ghost.
8. Graduation Day banner shows on Academy only, plus the Inbox notification. Not on Dashboard.
9. Mobile quick nav unchanged; U23 team and Junior team are reached via the menu.
10. S1b Coming soon (slice 0) is built: today's Academy page plus one `Youth squads` card under the roster, two rows with the FacilityTrackCard "Coming soon" pill, one sentence each, quiet action `Roadmap`. No new nav items, no empty tables, no numbers.
11. "Class of S{n}" is not shown as a line on Academy. It appears only as the meta label on the Rider journey card and as an event ("Discovered · Class of S3").

## Rules this design changes (update `docs/YOUTH_RULES.md` in the same PR)

- §1 / §2.1: Junior team and U23 team get their own pages and nav items (Clubhouse), and their own names. YOUTH_RULES today says "Akademiet ... Én side i spillet" covering intake + Junior + U23. New: Academy page = intake + Graduation Day + accounts; squads are separate pages.
- §2.3 Ungdomsløb: youth races get a dedicated `Youth races` page under Results in addition to the squad page tabs. CLAUDE_DESIGN_BRIEF §4 S2 assumed one page only; the brief's Select + gold `Set tactics` header is kept.
- §3 Kommer snart: unchanged, built as 3b.
- Brief §4 S1: "Class of S3" line behind a fold on Academy is dropped (owner 2/9: not understood, not needed until #2493). Rider journey keeps the tag.
- Brief §4 S1: Senior team quiet action on Academy is dropped (owner chose no cross-link; squads live in the sidebar).
- Squad caps shown (Junior 10, U23 12) are the §2.4 proposal, still pending economy sim.

## Component notes for the build

- Nav: two new Clubhouse items after My Team; one new Results item after Overview. Order in 3a.
- Squad page = TeamPage.jsx reused with `squad` param; DataTable columns as My Team. 16-year-olds get the subline `Eligible from 17`. `Move down` disabled with tooltip when season age > 18.
- Filter bar: existing Select (sm). `All squads` mode adds a `Squad` CategoryTag column; youth squads tinted accent-t text.
- Youth races Standings: dataTableStyles ZONES recipe (success/danger row tint, 2 px edge on boundary rows, zonePillClass). Own team: `tr.cz-me` (navy 3 px + 5 % tint), never gold.
- Graduation Day (T1, 896 px): one Card per transition; per rider a 6-column row (identity, rating plate, PotentialBand, contract, coach sentence, segment). Segment default `Move up`; when blocked, disabled with reason text in danger under the segment and `Sell` preselected. Default-behaviour sentence once under the cards. Empty: EmptyState with `inbox` icon, no gold.
- Rider journey: new Card in RiderHistoryTab, left column of the 1.55fr / 1fr grid, trade history table on the right. Events only from real records (intake, squad change, first win, Graduation Day). `Developed by [club]` footer only when the rider changed club. Empty: EmptyState `road` icon.
- Move to squad (3k): secondary Button opening Menu with three MenuItems (current disabled as "Current", ineligible disabled with reason). Confirms via AcademyTransferConfirmModal.

## Ejer-beslutninger (DA, kort)

Trupperne er selvstændige områder i Klubhus (My Team, U23 team, Junior team, Academy). Academy = intake, Graduation Day og regnskab. Alle rostere har ét trup-Select (én trup eller alle). Holdnavne kan omdøbes. Ungdomsløb findes både på holdsiden og på en egen side "Youth races" under Results. Flyt sker fra holdsidens rækker og fra rytterprofilen. Én guld-knap pr. side. Graduation-banner kun på Academy plus Inbox. Mobil-bundnav uændret. S1b Coming soon bygges først (slice 0). "Class of S3" vises ikke på Academy. Reglerne der ændres, står i afsnittet ovenfor og skal rettes i YOUTH_RULES.md i samme PR.
