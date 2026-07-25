# Et 8-sekunders statement timeout kostede 19 etaper deres berigelse — permanent

**Dato:** 2026-07-25 · **Kontekst:** Daglig Sentry/Railway-triage · CYCLINGZONE-3D + 3E

## Symptom
To Sentry-issues 24/7 kl. 12:15 og 12:22 (CEST), begge
`Error: canceling statement due to statement timeout`, i to forskellige cron-jobs
(stage-scheduler og auto-prize). Én forekomst hver, 0 brugere ramt — ser ud som støj.

## Rod-årsag
Backenden går gennem PostgREST's `authenticator`-rolle, som har
`statement_timeout=8s`. `recompute_season_standings` er en fuld re-derivation:
seq scan over `race_results` (**458.553 rækker pr. 25/7** — mod de 166k den blev
skrevet til under #2391). Warm koster den ~800 ms, men når flere løb afvikler
**samme etape på samme scheduler-tick**, kører flere fulde recomputes samtidig →
enkelte sprænger de 8 s og Postgres CANCELLERER statementet.

Ingen af de to call-sites retry'ede: `isTransientSupabaseError` kendte kun
Cloudflare-5xx og socket-fejl, ikke Postgres-timeouts. Så fejlen kastede
med det samme.

## Konsekvens (det dyre, ikke selve fejlen)
I `simulateStageByIndex` kaldes `updateStandings` **efter** at
`apply_stage_result` har committet resultaterne og bumpet `stages_completed` —
men **før** `persistRuns` / `persistPassages` / `persistIncidents` /
`persistStageMoments` og `applyFatigue`. Et kast her afbryder hele resten, og
fordi `stages_completed` allerede er bumpet, kører etapen **aldrig** igen.
Der findes ingen heal-sweep.

Verificeret i prod: Tour des Fjords etape 4 har 117 resultater men 0 runs,
0 moments, 0 incidents. Backwards-check over sæsonen: **19 etaper i 14 løb**
mangler runs+moments — og **alle 14 er partielle** (løbet har runs for de øvrige
etaper), så ingen af dem kan bortforklares som pre-v3/legacy. Klyngerne
(Vuelta Burgalesa ×4, alle etape 5; Tour de Malaisie ×2, etape 5+6) peger
direkte på samtidige afviklinger på samme tick.

Kode-kommentaren på linje 1803 påstod at et kast her var sikkert fordi standings
er "self-healing". Det er sandt for standings — og forkert for alt det der ligger
*efter* kaldet. Kommentaren beskrev intentionen, ikke kontrolflowet.

## Fix (denne PR)
1. `isTransientSupabaseError`: Postgres `57014`/`55P03` + "canceling statement due
   to (statement|lock) timeout" klassificeres som transient. Et cancelleret
   statement er altid rullet tilbage, og begge call-sites bag `withSupabaseRetry`
   er idempotente (paginerede reads + samme-payload PATCHes) → retry er sikkert.
2. `updateStandings`: RPC-kaldet lagt ind i `withSupabaseRetry`. Missing-function
   (PGRST202) skal stadig falde til Node-stien og må ikke retry'es — derfor
   klassificeres den udenfor retry-laget.

## Læring
1. **"1 forekomst, 0 brugere" i Sentry siger intet om skaden.** Skaden lå ikke i
   fejlen, men i hvad kastet sprang over. Spørg altid: hvad ligger *efter* det
   sted der kastede, og kører det nogensinde igen?
2. **Et bumpet idempotens-flag gør en fejl permanent.** Når counteren er rykket
   før berigelsen er skrevet, er "vi prøver igen næste gang" ikke sandt. Berigelse
   der ikke må tabes, skal ligge før counter-bumpet eller have en heal-sweep.
3. **Set-baserede optimeringer har en udløbsdato.** #2391 målte ~190 ms ved 166k
   rækker; ved 458k er det ~800 ms warm og sprængbart under samtidighed. En
   optimering målt én gang er ikke en garanti — seq scan over en voksende tabel på
   et kritisk kodepath er en tidsindstillet bombe.
4. **Retry-klassificering skal kende sin database, ikke kun sit netværk.**
   Transient-detektering der kun kigger på gateway/socket-fejl misser
   Postgres' egne selv-helende afvisninger (timeout, deadlock, lock).
