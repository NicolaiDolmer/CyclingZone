# Auktion: ledende hold opdateredes ikke live ved overbud (#980)

**Dato:** 2026-06-03
**Type:** Bugfix (P0)
**Filer:** `frontend/src/pages/AuctionsPage.jsx`

## Symptom
Når man blev overbudt på en rytter, opdaterede UI'et ikke "ledende hold" (fører-navnet)
før man manuelt genindlæste siden. Prisen + pulse-animationen opdaterede dog fint live.

## Rod-årsag
Supabase realtime `postgres_changes`-payloaden (`payload.new`) indeholder kun **rå
kolonner** på `auctions`-rækken — herunder `current_bidder_id` — men **ikke** det joinede
`current_bidder:current_bidder_id(id, name)`-objekt, som kun findes når man henter via en
embedded select (loadAll).

UPDATE-handleren merged med `{ ...a, ...updated }`, så:
- `current_price` og `current_bidder_id` blev opdateret korrekt (derfor virkede pris+pulse),
- men `current_bidder`-objektet (det fører-NAVNET vises fra, via `getAuctionLeaderName`)
  forblev det **gamle** join → stale navn indtil næste fulde reload.

Det er den klassiske "realtime giver rå rækker, ikke joins"-fælde.

## Fix
I UPDATE-handleren: når `current_bidder_id` skifter, genopbyg `current_bidder`-objektet
i stedet for at lade det stå stale:
- skift til `null` → `current_bidder = null`,
- skift til ny byder → slå navnet op i en lille `teamNameCacheRef` (seedet fra loadAll's
  seller/current_bidder-navne); cache-miss → hent `teams(id, name)` async og flet ind med
  en guard (`a.current_bidder_id === data.id`) så et nyere skift ikke overskrives.

## Forebyggelse / mønster
Når en komponent viser **joinede** felter og samtidig modtager realtime-UPDATE på den rå
tabel: realtime-payloaden har ALDRIG joins. Enten (a) re-fetch den ramte række med dens
join, eller (b) genopbyg de afledte felter fra de rå kolonner (cache navne hvor muligt).
Tjek alle steder der læser et `*.name`/`*.<join>` mod en realtime-merget række.

Beslægtet: [[feedback_runtime_verify_first]] — rod-årsag verificeret i koden før fix.
