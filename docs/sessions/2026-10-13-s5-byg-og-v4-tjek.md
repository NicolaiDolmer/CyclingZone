# Næste session 13/10: S5-etapeprofiler byg, v4-bjergtjek kl. 12, aldring, vagter

Planlagt 12/10 aften med ejeren. Alle beslutninger er hans; genåbn ingen af dem.

## Startprompt

```
Ny session efter docs/sessions/2026-10-13-s5-byg-og-v4-tjek.md. Læs FØRST den fil, derefter docs/NOW.md og issue #6549 (Hvad brænder-rapporten kl. 08). Jeg er med fra start. Rækkefølge: (1) Meld fund fra #6549 i første linje. (2) Secrets til databasevagten (#5878): giv mig de 2 kommandoer, verificér grøn kørsel bagefter. (3) S5-etapeprofiler #6369: design-go givet 12/10 (spec docs/superpowers/specs/2026-10-12-s5-etapeprofiler-design.md). Byg-plan + målt baseline (regel 36), derefter bølge (opus på generator/motor), tørkørsel mod benchmark-gaten, før/efter-billede, live senest 18/10. (4) Kl. 12: v4-bjergetaper pr. division mod balance-internals/motor-bench/bench-main-live.json; luk #6456/#6464 kun med mit go. (5) Udvikling 2.0-aldring #6499: kort med prøvekørsel faktor 0,7 vs 1,0 side om side. (6) #6490: 1. observationsaften (paritet + afregningstid), DROP INDEX-kort efter 2. aften (14/10). (7) Bølge-token-rapport (PR 2 af #6548). Svar på dansk.
```

## Status ved overdragelse (12/10 ca. 22:30)

- **Merget 12/10 aften:** #6544 (auto-udtag dobbeltbookede: binding-opslaget afkortet ved >1000 entries, CYCLINGZONE-4P, issue #6543) · #6538 (rider_training_seen, post-verify: paritet 0 på alle 3 tjek, de 3 funktioner læser seen, codex_readonly SELECT ok, GIN bevaret) · #6546 (recovery-replay, #5928) · #6547 (staging-refresh: pg_dump-diagnostik, `-DirectConnection`, `-PgBin`) · #6550 (Hvad brænder-vagten, rapport i fastgjort #6549 kl. 08).
- **Prioriteringskørsel (ejer-godkendt):** Nu-listen (10) har `priority:high`: #5878 #6184 #6490/#5911 #5904 #6110/#6499 #6369/#5841 #5871 #4159 #5978/#6428 #6339. 22 issues lukket (15 leveret, 7 overhalet), 23 i icebox (label), 2 dubletter lukket. Liste C (vent med lukning): #6464 (kl. 12 i morgen) · #5842 (25/10) · #5162 · #6350 · #6531. Kørslen brugte 4,9 mio. tokens (estimat 3-4).
- **S5-etapeprofiler:** kort 1-6 besluttet, design-go 12/10, byg i morgen. Benchmark i `docs/design/s5-benchmark/`.
- **#5904 refresh:** pg_dump LYKKEDES (839 MB, 55 min, PG17 over direkte forbindelse; pooleren var sandsynligvis årsagen før). Stoppet før restore af gaten "Transaction control found in public dump". Intet skrevet til staging. 13/10: find linjen i dumpet, ret gate/filtrering, genkør med `-SkipDump -DirectConnection -PgBin <pg17>` (dump ligger i `%TEMP%\cz-staging-refresh`).
- **Brand fundet:** DB Watchdog (#5878) har aldrig kørt: GitHub-secrets `SUPABASE_PUBLISHABLE_KEY` og `DISCORD_OPS_WEBHOOK_URL` mangler (ejer sætter dem 13/10). Aftentræningen 11/10 tog 255 s fra start (mål 120 s, #5911).
- **Patch note:** #6544 (auto-udtag fejlede for hold med lang historik) skal med i næste patch.
- **Udskudt af ejeren til 13/10:** aldringskortet (#6499), secrets til databasevagten.
