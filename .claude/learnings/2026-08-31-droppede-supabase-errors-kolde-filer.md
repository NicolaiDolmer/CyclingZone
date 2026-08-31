# 2026-08-31 — 27 droppede Supabase-errors i seks kolde filer (#2997)

## Rod-årsag

`supabase-js` kaster ikke. Den returnerer altid `{ data, error }`. Skriver man

```js
const { data: team } = await supabase.from("teams").select("balance").eq("id", teamId).single();
```

uden at binde `error`, forsvinder fejlen sporløst: ingen throw, ingen 500, ingen
Sentry-linje. Koden læser bagefter `data` som om den var et gyldigt svar, og en
fejlet læsning bliver til et **plausibelt forkert resultat** frem for en fejl.

Det er ikke en teoretisk klasse. De 27 sites i denne omgang havde konkrete
konsekvenser:

| Sted | Hvad en tabt fejl blev til |
|---|---|
| `loanEngine.getTotalDebt` | 0 i gæld → gældsloftet i `createLoan` åbnede for et hold der reelt lå ved loftet |
| `proxyBidding` proxy-liste | tom liste → alle autobud ignoreret → forkert auktionsvinder |
| `proxyBidding.canAffordAutoBid` | `!team` → autobud behandlet som udmattet → manageren tabte auktionen |
| `academyGraduation` | "not_pending" / "rider_not_found" til manageren, mens rækken lå der fint |
| `riderBidTimeline` | afsluttet auktion vist på rytterprofilen mens en live kørte |
| `deadlineDayReport` indgangs-læsning | "intet at gøre" → deadline day fyrede aldrig, tick efter tick |
| `discordNotifier` webhook-routing | så ud som "ingen kanal konfigureret" → beskeden forsvandt |

Fælles træk: **fallback-koden var skrevet til "ingen række", ikke til "kunne
ikke læses"**, og de to tilstande var gjort umulige at skelne.

## Fix

Alle 27 sites binder nu `error`, og fejl-retningen er valgt bevidst pr. sted:

- **Pengesti og kontraktsti → kast.** Alle mutationer i de filer går gennem
  `*_atomic`-RPC'er eller ligger efter opslaget, så et kast i pre-flight fejler
  lukket uden delvis pengebevægelse.
- **Notifikation og ren berigelse → `captureException` + fald tilbage.** En
  manglende webhook-URL eller et manglende holdnavn må aldrig vælte den
  spilhandling der udløste beskeden.

`PGRST116` ("ingen række") beholdes som den legitime not-found-sti, dér hvor
koden allerede havde en. Ellers ville fixet lave "Lån ikke fundet" om til en
rå læsefejl i UI'et.

## Læring

1. **Ratchet-tal skal måles, ikke citeres.** Issuet sagde 170 og 111 i api.js.
   Målingen 30/8 gav 160 og 108, og `prizePayoutEngine.js` var allerede ryddet.
   Et af issuets tre prioriterede punkter var løst uden at nogen havde opdateret
   teksten. Mål altid selv før du bygger.
2. **Ratchet'en havde en åben flanke.** Guarden fejlede kun ved *flere* fund end
   baseline. Den fangede ikke at nogen kunne "løse" en ny droppet error ved at
   skrive filen ind i `BASELINE` igen med et højere tal. Testen der er tilføjet
   nu låser begge ender for de ryddede filer.
3. **Fallback-værdier skjuler fejlklassen.** `|| []`, `?? null` og
   `if (!row) throw new Error("not_found")` er ikke fejlhåndtering — de gør en
   fejlet læsning uskelnelig fra et tomt resultat. Når du ser dem oven på et
   Supabase-kald, så spørg hvad koden gør hvis læsningen fejlede.
4. **Guarden minder om nedspisning, men nogen skal lytte.** `api.js` havde stået
   "UNDER baseline" siden #2986 uden at tallet blev strammet. Sænk baseline i
   SAMME PR som oprydningen, ellers driver tabellen fra virkeligheden.

## Forward-guard

- `scripts/lint-dropped-supabase-error.mjs`: de seks filer er fjernet fra
  `BASELINE` (implicit 0) — enhver ny droppet error i dem fejler CI med det samme.
- `scripts/lint-dropped-supabase-error.test.mjs`: ny test låser at de ryddede
  filer hverken får en baseline-linje igen eller nye fund.
