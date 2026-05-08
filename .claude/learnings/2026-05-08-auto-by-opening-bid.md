# 2026-05-08 — Auto-by skal også være et bud

## Symptom
Auto-by loft kunne gemmes uden at manageren faktisk førte auktionen. Det fik knappen til at føles defekt: en manager kunne sætte et loft, men skulle stadig lægge et manuelt bud først for at komme ind i auktionen.

## Rod-årsag
`PATCH /api/auctions/:id/proxy` var modelleret som en ren max-loft mutation. Selve bud-flowet lå kun i `POST /bid` og i proxy-resolverens modbud, så et nyt auto-by loft på en auktion uden eget fører-bud oprettede ikke en `auction_bids`-række.

## Læring
Auto-by er ikke kun konfiguration; for en manager der ikke fører, er det også en bud-intention. Proxy-ruter skal derfor dele minimum-bid, balance og signing gates med almindelige bud, og de første proxy-bud skal logges som `auction_bids.is_proxy=true`, så tidslinje, realtime og historik har samme sandhedskilde.
