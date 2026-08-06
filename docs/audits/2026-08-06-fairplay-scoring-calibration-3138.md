# Fair-play scoring — kalibrering (#3138)

> Fair-play epic [#3131](https://github.com/NicolaiDolmer/CyclingZone/issues/3131), lag 4 (scoring/aggregering
> oven på detektorerne #3135/#3136/#3137). Bygget 2026-08-06 (parallel-session, natten 5-6/8). Refs #3138.

## Model

`score = værdi-komponent × (identitet + prisafvigelse + livscyklus)` — multiplikativ gate der
implementerer den bindende ejer-regel (30/7): **forbundet identitet ∧ ensidig værdioverførsel → flag;
hver del alene er støj.** Ingen værdistrøm → score 0, uanset identitetssignal. Fuld vægt-tabel og
begrundelser: `backend/lib/fairplayScoring.js` (konstanterne øverst).

| Komponent | Indhold | Range |
|---|---|---|
| Værdi (gate) | 0 under 50k netto-strøm; lineær; mætter ved 250k | 0–1 |
| Identitet | first_seen-arv 0,9 · IP-eksakt(fan-out≤2) 0,7 · IP-prefix 0,5 · signup≤15min 0,5 · email/navn 0,4 — sum, cap 1,0 | 0–1 |
| Prisafvigelse | max over parrets handler uden for 0,10×–2,2× (#3231-båndet), skaleret med ekstremitet × 0,8 | 0–0,8 |
| Livscyklus | lån→værditab 0,7 · kontoalder 0,5 · aktivitetsprofil 0,5 · engangs-mail 0,35 — sum, cap 1,0 | 0–1 |

To flag-typer: `pair_value_flow` (netto-strøm-gatet, #3135-reglen) og `lifecycle_funnel`
(beløbs-gatet ≥100k, kræver ≥2 forskellige livscyklus-signaler — fair-pris-tragten fra #3137).
Tærskel: 0,35 (`app_config.fairplay_flag_threshold`, ejerstyret). Whitelist (#3135) undertrykker
altid. `dismissed`/`actioned` gen-scores aldrig.

Bevidst udeladt i v1 (dokumenteret i koden): #3137-signal 2 (levetid-efter; empirisk max 0,401 i
hele vinduet — ingen diskrimination) og signal 4 (konto-oprettet-under-auktion; 157/168 FP pga.
bevidst hurtig onboarding — auditten kræver selv at det aldrig står alene). Begge kendte sager
fanges uden dem; kan tilføjes som korroboration i v1.1.

## Kalibreringsresultater (fixtures fra de committede audit-tal)

Kilde-tal: `docs/audits/2026-08-03-identity-correlation-3135.md`,
`2026-08-03-price-band-recalibration-3136.md`, `2026-08-03-account-lifecycle-signals-3137.md`.
Fastfrosset som tests i `backend/lib/fairplayScoring.test.js` — en vægt-ændring der knækker en
kendt sag knækker CI.

| Sag | Score | Tærskel 0,35 | Kommentar |
|---|---|---|---|
| **#2221** EvoPro↔Barra CC (766k strøm, jcarey-lighed, 0,008×/15,6×-swap) | **1,58** | FLAG (4,5×) | |
| #2221 uden pris-data (robusthed: kun email-lighed + strøm) | 0,40 | FLAG | #3135-basisreglen bevaret |
| **#2776** 1-kr-handlerne (1,97M strøm, first_seen-arv, lån→tab) | **2,48** | FLAG (7×) | |
| gwshare-tragten (649.853 fair pris, 7-min-konto, temp-mail) | 1,00 | FLAG (tragt) | Bevidst: eneste 100k+-handel fra <2t-konto nogensinde — SKAL til review (ejeren afviser) |
| 24/7↔Metro-L3 · Wheelbarrels↔Nickstar · MorseCodes↔VelocityOne | 0,00 | ok | Ingen handler → gate 0 |
| TR Cycling↔LEGO-Vestas (én 10.539-handel) | 0,00 | ok | Under 50k-gulvet |
| Bad At Names↔testkonti | — | ok | Uden for populationen (@cyclingzone.dev) + whitelist-backstop |
| Beers&Gears↔Guaracha (CGNAT-fanout=2, 76.678) | 0,21 | ok | Synlig i dry-run, ikke flagget |
| CGNAT-parret 24/7↔LEGO-Vestas (152.720, højt fan-out) | 0,00 | ok | Fan-out-filteret fjerner IP-signalet |

**Falsk-positiv-facit mod de 5 kendte lovlige par: 0/5. Begge kendte sager: fanget, med klar margin.**

## Status: live dry-run AFVENTER

Kalibreringen ovenfor er **fixture-baseret** (tallene er de dokumenterede audit-tal, som selv er
målt mod prod 2026-08-03). Den fulde live-genkørsel mod prod er IKKE kørt i denne session
(bevidst konservativt valg i parallel-sessionen 5-6/8). Kør den sådan (READ-ONLY, ingen writes):

```bash
node backend/scripts/fairplayScoringDryRun.js
```

Forventning: #2221-parret øverst (pair_value_flow); de kendte lovlige par under 0,35; evt. nye
kandidater listes med signal-bidrag til manuel vurdering. Kør FØR migrationen applies, så
tærsklen evt. kan justeres i `app_config` fra dag ét. Bemærk: #2776-kontiene er slettet
(sanktion 22/7) og KAN ikke optræde i en live kørsel — den sag er verificeret via fixtures mod
backup-tallene (jf. #3135-audittens rekonstruktion).

## Arvede, kendte begrænsninger

1. `base_value`/`market_value` er nutidige (ingen historisk snapshot) — samme som alle detektorerne.
2. `level`/`xp`/`login_streak` er nutidige proxies for aktivitet på handelstidspunktet (v1).
3. Fan-out≤2 reducerer CGNAT-støj, eliminerer den ikke (se 3135-audittens advarsel).
4. Engangs-domænelisten i `fairplayFlagsCron.js` er et kerneliste-uddrag — SQL-filens fulde
   ~140-liste kan portes 1:1 hvis der dukker nye domæner op i brugerbasen.
