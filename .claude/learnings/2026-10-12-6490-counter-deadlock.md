# #6490: en sorteret trigger er ikke en global låseorden

Separate sessioner på PostgreSQL 17 reproducerede to deadlocks i den fælles
ryttertæller: blandet UPSERT og flere statements i samme transaktion. Sortering
inden for hver AFTER-event sikrer ikke en fælles låseorden mellem events eller
over hele transaktionen. Enkelt-session-tests og grøn CI beviste ikke sikkerhed.

Test samtidighed med separate native sessioner og observerede barrierer; dæk både
flere events og flere statements. L-tælleren blev afvist. M er også erstattet:
ejerbeslutning 12/10 vælger `rider_training_seen`, fordi `training_rider_ticks`
allerede dækker per-date-stien. Ingen gammel kandidat-SQL skal aktiveres.

Historisk bevis: [L4 #6510](https://github.com/NicolaiDolmer/CyclingZone/pull/6510).
Ny spec: `docs/superpowers/specs/2026-10-12-6490-rider-training-seen-design.md`.
Claude bygger; Codex reviewer. Ingen merge eller prodændring følger af denne note.
