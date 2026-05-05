# 2026-05-05 — Ønskeliste-auktionsnotifikation linkede til Transfers

## Bug
Når en manager fik en Indbakke-notifikation om at en rytter på ønskelisten var sat til auktion, sendte klik på notifikationen til `/transfers` i stedet for `/auctions`.

## Root cause
Backend brugte samme notification-type (`watchlist_rider_listed`) til både ønskeliste-transferlistinger og ønskeliste-auktioner. Frontend havde derfor kun én type-mapping og pegede den mod transfermarkedet.

## Fix
Ønskeliste-auktioner bruger nu `watchlist_rider_auction`, DB CHECK-constraint og kontrakt-test kender typen, og frontend mapper den til `/auctions`. Gamle allerede-sendte auktion-notifikationer med den gamle type routes også til `/auctions` via titel/besked-fallback.

## Læring
Når en notification-type bruges til navigation, skal typen afspejle destinationens domæne. Del ikke samme type mellem markedsflows, selv hvis beskeden ligner hinanden.
