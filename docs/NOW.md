# NOW — Aktuel arbejdsstatus

## Aktiv slice
- `Slice 8 — Bug-rydning og quick wins`

## Leverancer (prioriteret rækkefølge)
1. ~~Hemmelige achievements synlige → fix~~ ✅ løst
2. ~~Event-sekvens dokumentation → færdiggør (`docs/EVENT_SEQUENCE.md`)~~ ✅ løst
3. Live beta-verifikation af season flow (season start → result approval → season end)
4. ~~Landekode/flag på øvrige rytterflader~~ ✅ løst
5. Discord/webhook-regression → reproducér og afgræns (`investigation`)

## Holdt ude af denne slice
- boardEngine split — for stor risiko som sidegevinst
- Økonomi retuning — kræver dedikeret sparringssession
- PCM mappings — afventer ekstern data

## Næste slice (kandidater til Slice 9)
- Økonomi-retuning (kræver sparringssession først)
- boardEngine split (refactor_safe, lav feature-risiko)
- Admin-forbedringer (slet bruger + øvrige admin-gaps)

## Blockers / investigations
- Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet.
- Discord/webhook-regression: webhook-path skal reproduceres live; transferhistorik til Discord-tråd indgår i sporet.
