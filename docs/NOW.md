# NOW — Aktuel arbejdsstatus

## Aktiv slice
- `Slice 9 — Økonomi, boardEngine og admin`

## Leverancer (prioriteret rækkefølge)
1. ~~Garanteret salg-bug (P0)~~ ✅ løst — only egne ryttere, backend + frontend
2. ~~Bestyrelse på dashboard~~ ✅ løst — regression fra boardEngine-refactor
3. ~~Admin-forbedringer — slet bruger~~ ✅ løst — fuldt implementeret (frontend + backend + audit log)
4. ~~Økonomi-retuning (del 1)~~ ✅ løst — startkapital 800K, sponsor 240K; præmiepenge afventer Google Sheets-integration
5. ~~boardEngine split~~ ✅ løst

## Holdt ude af denne slice
- PCM mappings — afventer ekstern data

## Udskudt fra Slice 8
- Live beta-verifikation af season flow (season start → result approval → season end)
- Discord/webhook-regression → skal reproduceres live; transferhistorik til Discord-tråd indgår i sporet
- Evne-filter/slider → ingen statisk root cause fundet; kræver frisk live-reproduktion

## Næste slice (Slice 10 — Navigation-omstrukturering)
- Sidebar restructure: Overblik, Marked, Resultater (ny gruppe), Liga
- Bundlede UX-fixes: head-to-head auto-suggest, auktion-synlighed på rytterliste/side, "Point"→"Værdi", fjern ubrugte evne-farver, løn synlig i rytterlisten + filtrerbar
