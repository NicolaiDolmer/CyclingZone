# Næste session (12/10 aften, i dag): S5-etapeprofiler + kalender (frist 18/10), sæsonskiftet 25/10 og knivskarp prioritering

Planlagt 12/10 med ejeren (styringssession). Sessionen starter I DAG 12/10, ikke i morgen (ejer: "udskyd ikke til i morgen"). Alle beslutninger herunder er hans. Genåbn ingen af dem.

## Startprompt (kopiér ind i en ny Claude Code-session)

```
Ny session efter docs/sessions/2026-10-12-aften-saesonskifte-og-prioritering.md. Læs FØRST den fil, derefter docs/NOW.md, docs/MASTERPLAN.md, AGENTS.md hard rule 25 + 36 (design og måling FØR byg) og .claude/learnings/2026-10-12-codex-6490-retro.md. Jeg er med fra start. Rækkefølge: (1) Meld først hvad der brænder (Sentry 24 t, CI-jobs der fejler gentagne gange, DB/disk, tokens pr. agent i seneste bølge). (2) I morgen kl. 12 (13/10, første v4-bjergetaper): tjek pr. division mod balance-internals/motor-bench/bench-main-live.json og luk #6456/#6464 hvis de holder. (3) S5-etapeprofiler #6369 → kalender #5841 senest 18/10: design med mig FØRST (ét kort ad gangen med billede), byg derefter i bølge. (4) #6490: status på PR #6538 (rider_training_seen), merge efter Codex-review og min go, post-verify paritet, observér 2 aftener, derefter kort om DROP INDEX. (5) Udvikling 2.0-kortet om aldring (#6499, flag development_v2_aging_enabled) før 25/10. (6) Prioriteringskørslen: Haiku scorer alle åbne issues med anbefalinger, Opus efterprøver, jeg godkender lister; LUK INTET uden min aftale. (7) "Hvad brænder"-vagten (B) designes med mig før byg. Udskyd intet planlagt uden aftale. Svar på dansk.
```

## Status ved overdragelse (12/10 sen eftermiddag)

- **Merget 12/10:** #6530 (rytterværdi på handlen, migration post-verificeret, schema-snapshot opdateret), #6532 (CodeQL, kun test), #6483 (U23/junior EXP + sæson-alder), #6482 (notifikationer), #6533 (træningssiden: samlet dags-valg bag flaget `training_bulk_day`, off), #6534 (første løb for nye spillere bag `first_race_card`, off; preview `?preview=first-race`) — tjek at #6534 faktisk landede.
- **Åbne PR'er:** #6538 (#6490 rider_training_seen, opus, Codex reviewer) · #6539-PR (bølge-agenter med tools-tilladt-liste; self-modification → ejeren merger selv).
- **Flag der venter på ejerens "kør":** `training_bulk_day` → beta (efter Codex-review af adfærd: gentagne tryk, løbsdage, aftenafregning) · `first_race_card` → beta.
- **Patch note** for #6482 + #6483 skrives ved close-out 12/10 (tjek at den er lavet).
- **Codex:** kører lasttesten #5904 på staging med 3 timers grænse (ny session). Læs resultatet på #5904.

## Beslutninger 12/10 (låste)

- #6490: løsningen er `rider_training_seen` (spec `docs/superpowers/specs/2026-10-12-6490-rider-training-seen-design.md`). Codex' 7 PR'er lukket. DROP INDEX kun på separat ejer-go efter 2 aftners observation.
- #1140: pakke A (første løb) bag flag; intet fjernes fra spillet.
- #6523/#6524: træningssiden bag flag; intet fjernes; Today/R1-R5 bevares.
- Cross-review Claude↔Codex kun ved samme område.
- Hard rule 36: teknisk design + måling før byg; 4 t uden resultat → stop; ingen polling.
- Haiku må gennemgå alle issues og give anbefalinger; **ingen lukning uden ejer-aftale**.

## Prioriteringskørslen (forberedt, kør efter ejer-go i sessionen)

**Problem:** 779 åbne issues; 753 `claude:todo`, 574 `priority:med`, 335 uden `cat:`. Labels bærer intet signal.

**Model:** score pr. issue = spillere ramt × alvor + løftestang (gør det os/AI/spillerne hurtigere fremover?) + sikkerhed − indsats. Lofter: "Nu" ≤ 10, "Næste" ≤ 30, resten backlog; icebox-forslag i portioner til ejeren.

**Kørsel:** Haiku-chunks à ca. 30 issues (body afkortet til 1.200 tegn, effort low) med skema: score-felter, område, foreslået bane, dublet-mistanke, kort begrundelse. Opus efterprøver alle forslag om "Nu", "icebox" og dubletter. Token-estimat: ca. 26 Haiku-chunks + 3-4 Opus-refute ≈ 3-4 mio. tokens (Haiku-delen billig); bekræft med ejeren før start. Resultat: ejer-dashboard med top 40 + icebox-portioner i klart sprog (hvorfor pr. punkt).

**Icebox-kandidater fra triage 12/10 (venter på ejer-go):** #6515, #6422, #6463.

## "Hvad brænder"-vagten (B, ejer-godkendt idé; design før byg)

Daglig rapport kl. 08:00 til morgenblokken: Sentry-nye/stigende, CI-jobs røde N dage i træk (Perf & SEO rød siden 14/9), DB-størrelse/WAL/disk-vækst (#6537), tokens pr. agent i seneste bølge (deltrin > 100k eller prefix > 50 KB = alarm), spor uden merget leverance > 4 t. Haiku kan køre opsamlingen; Claude melder fund i første linje.

## Andre åbne tråde

- #6536 legacy-træningssti (143 hold) · #6537 disk (ikke akut, autoscale virker) · #6528 Postgres-minor (ejer-vindue) · #6461 Train now 4/5 (sandsynligvis by design; A/B-kort på #6490 om daglig træningsoplevelse, Claude anbefaler A) · #6526-analysen: dag 1-2 er største lækage (20/22) og 13 veteraner væk (win-back-udkast når ejeren vil).
