# Postmortem · 2026-07-20 · Rytter-progression: idempotens-guard skrevet før mutation, ikke atomisk med den

## Hvad skete der?
`developRidersForSeason` (#1137) skrev `rider_development_log` (idempotens-guarden mod dobbelt-udvikling) FØRST for alle kandidat-ryttere i én upsert-batch, og DEREFTER `rider_derived_abilities` + `riders` i to separate `runBatched`-update-loops. Fundet under review af PR-C (#2361) forud for den uigenkaldelige S1→S2-sæsonovergang mod hele spillerbasen (~6.939 ryttere) — ikke observeret i prod endnu, men motoren har kørt sådan siden #1137.

## Root cause
Skrive-rækkefølgen adskilte "logget" fra "anvendt": fejlede en `riders`-update midt i update-loopet (netværk, constraint, hvad som helst), var dev-loggen allerede skrevet for ALLE ryttere i den kørsel. En re-run læser `rider_development_log` som sit `alreadyDeveloped`-filter og sprang derfor de fejlede ryttere permanent over — deres nye evner/base_value/pensionering blev ALDRIG anvendt, men loggen sagde "udviklet". Filens egen header påstod fejlagtigt "Re-run efter delvis fejl er sikker".

Faldgruben ved den naive fix (bare flytte log-skrivningen til sidst): `developRiderSeason` udvikler fra rytterens NUVÆRENDE evner (ikke fra en snapshot). Uden en guard der er atomisk MED mutationen ville en re-run uden log-skrivning først læse de allerede-rykkede evner og udvikle rytteren IGEN — dobbelt-udvikling, ikke no-op.

## Fix
Ny RPC `apply_rider_development` (`database/2026-07-20-rider-development-atomic-rpc.sql`): `INSERT ... ON CONFLICT (rider_id,season_id) DO NOTHING` → `GET DIAGNOSTICS ROW_COUNT` → hvis 0, `RETURN false` UDEN at røre evner/rytter; ellers UPDATE begge tabeller og `RETURN true` — alt i én Postgres-transaktion pr. rytter. `backend/lib/riderProgressionEngine.js` kalder RPC'en pr. rytter i den eksisterende `runBatched(..., 25, ...)`-loop i stedet for tre separate batch-operationer. Fejler ét RPC-kald, er alle forudgående ryttere i loopet allerede committet korrekt (log OG mutation sammen); re-run behandler kun de reelt uafsluttede.

## Forhindret-fremover
Ny test (`backend/lib/riderProgressionEngine.test.js`, "re-run-sikkerhed: RPC-fejl for én rytter …") simulerer et RPC-kald der fejler for én rytter midt i en batch, kører igen, og assertérer at rytteren udvikles præcis 1× og at allerede-committede ryttere forbliver uændret. Testen låser invarianten "logget ⟺ anvendt" fast — en fremtidig regression der genintroducerer et to-trins skriv ville få denne test til at fejle.

## Læring
En idempotens-guard (unique-constraint + skip-hvis-findes) er kun en garanti hvis den skrives ATOMISK med den mutation den vogter. At skrive guarden først "for sikkerheds skyld" føles konservativt, men gør faktisk re-run FARLIGERE ved delvis fejl: den forhindrer korrekt nok dobbelt-udvikling, men den maskerer også at mutationen aldrig skete. Generel regel for enhver "log/idempotens-marker + mutation af flere tabeller"-motor: hvis mutationen kan fejle delvist, skal marker+mutation enten (a) være i samme DB-transaktion (RPC/plpgsql), eller (b) markeren skal skrives EFTER en bekræftet succesfuld mutation, ALDRIG før.
