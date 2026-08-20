# 2026-08-18 · Staging-backend mod branch-klon postede 60 falske resultater til prod-Discord

## Hvad skete der

En tidligere sessions script (`start-staging-backend.mjs`, trin 7-staging-arbejdet) startede kl. 20:25 en
lokal backend (worktree `3746-trin7`, fuld cron-stack) mod Supabase-branchen `bircbxynabqnypdpoovd` —
en klon med ægte data backfillet 17/8, **inklusiv `discord_settings` med prod-webhook-URLs**.

I klonens verden var alle løb siden 17/8 "ikke kørt". Dens stage-scheduler indhentede dem og postede
60 re-simulerede resultat-embeds med **forkerte vindere** til de rigtige spillerkanaler over 75 minutter
(20:32–21:41). Sentry var slået fra i scriptet → usynligt i al monitorering. Prod-motor/DB: 100 % upåvirket.

## Hvorfor det var svært at finde

1. **Alle prod-flader var rene:** kalender uændret siden 20/7, alle etaper kørt til tiden, ingen nye
   result-rækker, outbox tom, Railway-log tavs, admin_log tom. Fem plausible teorier (outbox-drain,
   recovery-genkørsel, deploy-churn-overlap, digest-sweep, admin-simulate) faldt én efter én på evidens.
2. **Gennembruddet var indholdet:** embeds'ene viste ANDRE vindere end de oprindelige opslag — dvs.
   re-simulering, ikke genudsendelse. Kun ét system kan simulere: en race-engine et sted udenfor prod.
3. `Get-CimInstance Win32_Process` fandt derefter kilden på ét opslag.

## Læringer

- **Uforklarlig prod-output med tavse prod-logs → tjek LOKALE processer tidligt.** Andre sessioners
  baggrundsprocesser (dev-servere, staging-backends, harnesses) er en reel aktør på en solo-founder-maskine
  med parallelle AI-sessioner. `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` koster 5 sekunder.
- **Data-kloner arver integrationer.** En DB-klon "med ægte data" indeholder webhook-URLs, tokens-pointere
  og feature-flags der peger på VIRKELIGHEDEN. En klon er ikke isoleret bare fordi dens *skrivninger* er.
- **Læs indholdet, ikke kun metadata.** Timestamps/afsender-mønstre gav fem forkerte teorier;
  embed-INDHOLDET (forkerte vindere) gav den rigtige på ét blik.
- **Baggrundsprocesser skal dø med sessionen.** Start-scripts til stagingmiljøer bør registrere
  oprydning (kill ved close-out) — en cron-stack må aldrig overleve den session der startede den.

## Forebyggelse

- **PR #3962 (live-guard):** al udgående Discord no-op'er medmindre `SUPABASE_URL` er prod;
  override kun via `DISCORD_LIVE_MESSAGING=allow`. Gør hele klassen umulig, uanset DB-indhold.
- Restpunkt (#3961): null `discord_settings.webhook_url` ved branch-seed (defense-in-depth nr. 2).

Refs #3961, PR #3962. Evidens: 60 opslag logget i session-scratchpad (`rogue-posts-evidence.json`).
