# spawnSync hænger på daemon-start (Windows): arvet stdout-pipe

**Dato:** 2026-06-17 · **Kontekst:** `scripts/db-verify-restore.mjs` / `db-selftest.mjs` (DB-backup-tooling, #1105 Fase B trin 5)

## Symptom

Selvtesten "hang" uden output. Source-Postgres var oppe (`log` viste `ready to accept connections`), men `src`-databasen blev aldrig oprettet og der var **nul klient-forbindelser** — processen sad fast *før* det første `CREATE DATABASE`. Det lignede flakiness/langsomhed; det var det ikke.

## Rod-årsag

`run(pgCtl, [...,'start'])` brugte `spawnSync` med default `stdio: 'pipe'` (fordi scripts'ene fanger stdout). `pg_ctl start` starter `postgres` som barn, der **arver stdout/stderr-pipe-handles**. `spawnSync` returnerer først når stdout-pipen lukker — dvs. når daemonen dør. Daemonen lever videre → `spawnSync` returnerer aldrig, selvom `pg_ctl` selv er exited og serveren er klar.

Klassisk Node-fælde: en backgroundet grandchild der arver den fangede stdout-pipe holder `spawnSync` (eller `execSync`) i live for evigt.

## Fix

Start daemoner med `stdio: 'ignore'`, så `postgres` ikke arver pipen. Server-output går allerede til logfilen via `pg_ctl -l`, så intet tabes:

```js
run(pgCtl, ['-D', dataDir, '-l', logFile, '-o', `-p ${port} ...`, '-w', 'start'], { stdio: 'ignore' });
```

`db-lib.mjs run()` fik en `stdio`-passthrough til netop dette.

## Generel regel

Når du `spawnSync`/`execSync`-starter noget der **forbliver kørende** (DB-server, dev-server, watcher), så fang ALDRIG dens stdio via pipe — brug `stdio: 'ignore'` (eller redirect til fil). Ellers hænger det synkrone kald på den arvede pipe, ikke på exit-koden. Diagnose-tegn: barnet er oppe (log siger ready), men ingen klient-aktivitet og kaldet returnerer aldrig. Skyldes IKKE langsomhed — tjek pipe-arv før du øger timeouts.

Relaterer til [reproducer-lokalt-før-push] (2 fix-runder samme symptom → stop + rod-årsag): her var rod-årsagen pipe-arv, ikke initdb-hastighed.
