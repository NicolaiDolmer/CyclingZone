# Feature-liveness audit — whitelist-disciplin

Auditen (`backend/scripts/audit-feature-liveness.js`, workflow `Feature-liveness audit`)
finder mønstret **"deployed kode + 0 data / 0 brugere"** i fem detector-klasser:

| Detector | Finder |
|---|---|
| A | Tabel med 0 rows, men backend har INSERT/UPSERT-paths |
| B | Backend-endpoint uden frontend-kalder |
| C | Forskel mellem `database/*.sql` og `schema_migrations` (begge veje) |
| D | Prod-tabel uden `CREATE TABLE` i `database/*.sql` |
| E | Event i `KNOWN_EVENTS` med 0 impressions i 30 dage |

Fund er **ikke** automatisk bugs. Nogle er bevidste (en webhook HAR ingen
frontend-kalder; en outbox ER tom når alt er leveret). Dem suppresser vi i
scriptets whitelists — og det er netop dér en vagt kan rådne.

## Reglen for en whitelist-entry

Hver entry skal bære to ting i en kommentar lige over sig:

1. **Begrundelse** — hvorfor er fundet bevidst? Skriv evidensen, ikke konklusionen:
   hvad viste en læsning mod prod, hvilken commit flyttede filen, hvilket flag er
   off, hvilken test dækker skrive-stien. "Jeg tjekkede engang" er ikke en
   begrundelse.
2. **Udløbsbetingelse** — hvornår skal entryen fjernes igen? Fx "fjern når
   matrix-PR'en er merged", "fjern efter første sæsonskifte efter 3/9", "fjern når
   handlingen fjernes fra produktet" (permanent).

Er en finding flag-styret, så brug `FLAG_GATED_EMPTY_TABLES` i stedet for en
statisk entry: auditen læser flagets LIVE værdi i `app_config` ved hver kørsel, så
en senere flag-flip uden data fanges automatisk i stedet for at afhænge af at
nogen husker at rydde op.

`WHITELIST_EMPTY_TABLES`, `WHITELIST_ZERO_IMPRESSION_EVENTS` og
`WHITELIST_APPLIED_WITHOUT_REPO_FILE` har en **forward-guard** (#2299): bliver
entryen unødvendig — tabellen får rows, eventet får impressions, filen dukker op i
`database/` igen — flager auditen selv entryen som stale. `PERMANENT_EMPTY_TABLES`
har bevidst ingen forward-guard: dér er tom den sunde tilstand, og rows er lige så
sundt.

## 48-timers-reglen for altid-røde vagter

**Ejer-regel 11/9 (#3069): en vagt der altid er rød skal rettes eller fjernes
inden 48 timer.**

En permanent rød check er værre end ingen check. Den lærer reviewere at rød er
normalt ("grøn på nær kendt audit"), og så siger den ingenting den dag et ægte fund
lander. Auditen var rød i 14 af 14 kørsler fra 7/9 til 11/9, og seks PR'er blev
merget hen over den.

Når en liveness-kørsel er rød:

1. **Kør auditen read-only mod prod først** — gæt aldrig på findings-listen:
   `infisical run --env=prod -- node backend/scripts/audit-feature-liveness.js`
2. **Afgør pr. fund:** ægte drift → ret årsagen. Bevidst tilstand → whitelist med
   begrundelse + udløbsbetingelse.
3. **Kan et fund ikke afgøres inden for 48 timer?** Så gør detektoren advisory
   (exit 0 + tydelig advarsel) med en begrundelse, frem for at lade gaten stå rød.
   En advisory vagt man læser slår en blokerende vagt man ignorerer.
4. Kør auditen igen og bekræft 0 uwhitelistede fund før du lukker.

PR-kørsler springer Detector C og E over (`--skip=C,E`): C ville falsk-flage hver
ny migration som "ikke applied" indtil auto-migrate har kørt efter merge, og E har
brug for dage/uger af akkumulerede events. De to dækkes af den ugentlige cron og af
`workflow_run` efter Auto-migrate.
