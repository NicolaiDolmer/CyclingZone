# NOW — Aktuel arbejdsstatus

## Aktiv slice
- `Slice 10 — Navigation-omstrukturering` ✅ FÆRDIG (2026-04-25)
- Næste: `Slice 11` — ikke planlagt endnu

## Slice 10 leverancer (alle done)
1. ~~Sidebar restructure: Overblik, Marked, Resultater (ny gruppe), Liga~~ ✅
2. ~~Auktion-synlighed på rytterliste/side~~ ✅ — ⚡-badge i RidersPage + RiderStatsPage
3. ~~Fjern ubrugte evne-farver~~ ✅ — guld/blå/grå bar-logik fjernet fra StatBar
4. ~~"UCI Point"→"Værdi" i sort-dropdown~~ ✅ — `RiderFilters.jsx` SORT_OPTIONS
5. ~~Head-to-head auto-suggest~~ ✅ — `autoSuggest` prop på Hold B i `HeadToHeadPage.jsx`
6. ~~Løn synlig i rytterlisten + filtrerbar~~ ✅ — salary i fetch, kolonne, filter + chips

## Holdt ude
- PCM mappings — afventer ekstern data

## Udskudt
- Live beta-verifikation af season flow (season start → result approval → season end)
- Discord/webhook-regression → skal reproduceres live; transferhistorik til Discord-tråd indgår i sporet
- Evne-filter/slider → ingen statisk root cause fundet; kræver frisk live-reproduktion
