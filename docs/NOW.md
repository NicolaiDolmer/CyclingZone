# NOW — Aktuel arbejdsstatus

## Aktiv slice
- `Slice 10 — Navigation-omstrukturering` ✅ FÆRDIG (2026-04-25)
- `Slice 11 — Resultater-hub + Rytterrangliste` ⛔ BLOKERET — afventer ekstern data (se nedenfor)
- Næste aktive: `Slice 11b — Quick wins` ✅ FÆRDIG (2026-04-26)

## Slice 10 leverancer (alle done)
1. ~~Sidebar restructure: Overblik, Marked, Resultater (ny gruppe), Liga~~ ✅
2. ~~Auktion-synlighed på rytterliste/side~~ ✅ — ⚡-badge i RidersPage + RiderStatsPage
3. ~~Fjern ubrugte evne-farver~~ ✅ — guld/blå/grå bar-logik fjernet fra StatBar
4. ~~"UCI Point"→"Værdi" i sort-dropdown~~ ✅ — `RiderFilters.jsx` SORT_OPTIONS
5. ~~Head-to-head auto-suggest~~ ✅ — `autoSuggest` prop på Hold B i `HeadToHeadPage.jsx`
6. ~~Løn synlig i rytterlisten + filtrerbar~~ ✅ — salary i fetch, kolonne, filter + chips

## Slice 11 — blokeret, hvorfor
- **Rytterrangliste**: Kræver at vi kender Google Sheets-strukturen for løbsresultater (kolonner, format, datakontrakt) — ellers designer vi mod den forkerte kilde.
- **Løbsarkiv-forbedringer + akkumuleret graf**: Kræver en liste over alle løb + eksempler på resultater i Google Sheets, så historikvisning og dataaggregering designes korrekt.
- Når brugeren sender Google Sheet → åbn Slice 11 igen og kør begge leverancer i én session.

## Holdt ude
- PCM mappings — afventer ekstern data

## Udskudt
- Live beta-verifikation af season flow (season start → result approval → season end)
- Discord/webhook-regression → skal reproduceres live; transferhistorik til Discord-tråd indgår i sporet
- Evne-filter/slider → ingen statisk root cause fundet; kræver frisk live-reproduktion
