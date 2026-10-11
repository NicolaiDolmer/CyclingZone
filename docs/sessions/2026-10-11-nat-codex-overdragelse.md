# Overdragelse til Codex-aften/nat 11/10 (fra Claude-session `031242c6`)

Ejeren arbejder videre med Codex resten af aftenen og natten. Denne fil er sandheden om, hvad Claude-sessionen efterlod. GitHub-issues er SSOT for detaljer.

## Status ved overdragelse
- **Merget 11/10 aften:** #6478 #6480 #6481 #6479 #6498 #6503 #6502. Migration fra #6479 (forum-politik) er post-verificeret. Prod-oprydning #5903 (2 forkerte startlister) kørt med ejer-go, nu 0.
- **I Claudes merge-kø (lad den køre færdig; start IKKE en anden kø samtidig):** #6501 (tilbagegang D4 bag slukket flag + seed-migration `development_v2_aging_enabled = off`), #6505 (patch 7.357), #6477 (chunk), #6488 (merge-køen frigives ved deploy), #6426 (databasevagt). Tjek `gh pr list --state open` før du merger noget selv.
- **Flaget `development_v2_aging_enabled` må IKKE tændes** (ejer-only, efter ejerens beslutning om faldets form, før 25/10).
- **#6426 databasevagt** fejler hvert 5. min, indtil ejeren opretter GitHub-secrets `DISCORD_OPS_WEBHOOK_URL` og `SUPABASE_PUBLISHABLE_KEY` (ejer-valg 11/10: merge nu, secrets senere). Røde `db-watchdog`-kørsler er forventede indtil da.

## Åbne spor (tag ét ad gangen, kort til ejeren før merge)
| Issue | Hvad | Note |
|---|---|---|
| #6490 | Træningsafregningen ved 10× (GIN-indeks 800 MB, 1 MB WAL pr. afregning, live-målt) | Design først; indekset slettes kun med ejer-go |
| #6504 | "Frigiv rytter" registrerer intet ejerskifte + falsk `needs_reconciliation`-alarm | Lille, klar plan i issuet |
| #6489 | Trup-skift: én port i databasen (trigger + paritet + vagt) | Ejer-godkendt 11/10 |
| #6497 | 4 kopier af `selectInChunks` → én | Rør `raceRunner.js` kun uden for løbsvinduer |
| #6496 | Tekniske standarder (samle-issue #6491-#6495) | Kort #6491 (job-kø) først |
| #6482 #6483 | UI-PR'er | Kræver ægte før/efter-billede før merge |
| #6248 | Maks +1 pr. dag | Shippes med Udvikling 2.0 del 2 (ejer 7/10), ikke nu |

## Fælder fundet i aften (læs før du tæller løb eller rører træning)
- **Endagsløb gemmer resultater som `result_type='gc'`, aldrig `stage`.** Tæl løbsdage via `race_stage_schedule` eller `stage` + `gc` på `race_type='single'`.
- **Træningslukningen tager ~30 min (20:04-20:34) og er tung for databasen.** Merge/deploy ikke backend mellem kl. 20:00 og 20:45.
- **Etape-tick-vinduet HH:57-HH:03:** ingen merges (merge-køen håndhæver det).
- Postmortem: `.claude/learnings/2026-10-11-aften-traening-gin-endagsloeb.md`.

## I morgen (12/10)
v4-bjergetaper pr. division fra kl. 12 mod `balance-internals/motor-bench/bench-main-live.json` · betaling #4511 #4514 #4512 · ejer-kort: faldets form (#6499).
