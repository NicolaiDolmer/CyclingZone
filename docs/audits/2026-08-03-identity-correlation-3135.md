# Identitets-korrelation som primærsignal — #3135

> Fair-play epic [#3131](https://github.com/NicolaiDolmer/CyclingZone/issues/3131), lag 3 (detektion). Bygger på [#3132](https://github.com/NicolaiDolmer/CyclingZone/issues/3132) (identity_events, live siden 2026-07-31). Kørt read-only mod prod 2026-08-03. Refs #2226, #2776, #2221.

## Metode

Regel (ejer-beslutning 30/7, bindende): **forbundet identitet ∧ ensidig værdioverførsel → flag.** Delt identitet uden værdistrøm flagges ikke, og ingen automatisk sanktion — kun et flag til ejer-review.

**Identitetssignaler** (aldrig user-agent — se `docs/GAME_INVARIANTS.md`-adjacent begrundelse i #3131/#3132):

1. IP-eksakt
2. IP-prefix (/24 IPv4, /64 IPv6 — allerede afledt af #3132's trigger på `identity_events.ip_prefix`)
3. `first_seen_at`-arv — primær kilde `signup_attribution.first_seen_at` (88/189 brugere, tilbage til april); `identity_events.first_seen_at` er fallback (kun 6 rækker, tabellen er 3 dage gammel)
4. Signup-tidsnærhed (≤15 min)
5. Email/brugernavn-lighed — KUN svagt sekundært signal (tal-suffiks strippet, min. 4 tegn)

**Værdistrøm:** for hver transfer/auktion/byttehandel mellem to hold beregnes hvor meget værdi der flyttede til modtageren udover det modtageren betalte (rytterens nuværende `base_value` minus prisen; for byttehandler `(modtaget værdi − afgivet værdi) − cash_adjustment`). Summeret og **nettet** pr. par, så to nogenlunde ligeværdige handler i hver retning ikke tæller som "ensidig". Selv-handler (samme hold begge sider — forekommer i `auctions` som bogføring af `auto_squad_purchase` ved holdoprettelse) er eksplicit udelukket.

**Population:** kun `is_ai=false, is_bank=false` hold (samme filter som UI'ets "rigtige hold").

**Vindue:** identitetssignaler bruger al tilgængelig historik (næsten hele spillerbasen er alligevel <90 dage gammel — beta åbnede 2026-05-08). Værdistrøm er afgrænset til de sidste 90 dage, jf. opgavens instruks.

**Tærskel:** et par flages når nettet værdistrøm overstiger 100.000 CZ$ i én retning — lånt fra #2226 regel 2's oprindelige konvention. **Denne tærskel er bevidst ikke finkalibreret her; #3136 ejer endelig kalibrering.**

## Vigtigt fund undervejs: CGNAT giver falske "eksakt IP"-match selv med fan-out-filter

Første version af korrelationen brugte simpel array-overlap på IP. Det fangede en **helt ny falsk positiv**: "24/7 Aspire-Light" og "LEGO-Vestas" delte en eksakt IP (`152.233.12.241`) med en ensidig værdistrøm på 152.720 — ville have flagget som en ny sag. Ved eftersyn delte **fem helt urelaterede hold** samme IP over 3 dage (formodentlig én mobiloperatørs CGNAT-pulje). Rettelse: et `ip_exact`/`ip_prefix`-match tæller kun som signal hvis **højst 2 forskellige brugere nogensinde** har brugt den pågældende IP ("fan-out ≤ 2"). Med den rettelse forsvinder denne falske positiv fra output (se `scripts/fairplay/3135-identity-pair-correlation.sql`).

**Denne heuristik er ikke perfekt** — samme mobiloperatør-adresseområde producerede også et par med fan-out=2 (Beers & Gears ↔ Guaracha Guerreros, se nedenfor), som i en lille population (189 brugere) stadig kan være et tilfældigt CGNAT-sammenfald snarere end en husstand. Fan-out-filteret reducerer støj, det eliminerer den ikke. Se "Kendte begrænsninger".

## Resultat af 90-dages-scanningen (prod, 2026-08-03)

65 hold-par har mindst ét identitetssignal. Af dem har **5 par** faktisk handlet med hinanden i de sidste 90 dage:

| Par | Signal | Transaktioner | Netto værdistrøm | Flagget? |
|---|---|---|---|---|
| EvoPro ↔ Barra CC | email/brugernavn (svagt) | 1 (byttehandel) | **766.201** mod EvoPro | **JA — #2221** |
| 24/7 Aspire-Light ↔ LEGO-Vestas | IP-eksakt, høj fan-out (CGNAT, se ovenfor) | 4 auktioner | 152.720 mod LEGO-Vestas | Nej — intet pålideligt identitetssignal |
| Team Hansen ↔ LEGO-Vestas | IP-eksakt, høj fan-out | 2 auktioner | -88.251 | Nej — under tærskel + upålideligt signal |
| Beers & Gears ↔ Guaracha Guerreros | IP-eksakt, fan-out=2 | 1 auktion | -76.678 | Nej — under 100k-tærsklen |
| TR Cycling ↔ LEGO-Vestas | IP-eksakt, fan-out=2 | 1 auktion | 10.539 | Nej — kendt lovligt par (30/7) |

**Kun ét par flagges: EvoPro ↔ Barra CC, som ER #2221.** Ingen nye ubekræftede sager fundet. Beers & Gears ↔ Guaracha Guerreros er lavt under tærsklen og har kun fan-out=2 på en IP i et adresseområde der ellers viste sig promiskuøst — sandsynligvis endnu et CGNAT-sammenfald, ikke en husstand; nævnes for gennemsigtighed, ikke som en anbefaling til handling.

## Falsk-positiv-rate mod de 5 kendte par (30/7-scanningen)

| Kendt par | Identitetssignal fundet? | Værdistrøm | Flagget? |
|---|---|---|---|
| 24/7 Aspire-Light ↔ Metro-L3 | Ja (IP-eksakt, fan-out=2) | 0 (ingen handler) | Nej |
| The Wheelbarrels ↔ Nickstar Rockets | Ja (IP-eksakt + `first_seen_at`) | 0 | Nej |
| The Morse Codes ↔ Team Velocity One | Ja (IP-eksakt, fan-out=2) | 0 | Nej |
| TR Cycling ↔ LEGO-Vestas | Ja (IP-eksakt, fan-out=2) | 10.539 (1 handel) | Nej |
| Bad At Names ↔ ejerens testkonti (@cyclingzone.dev) | Delvist* | 0 | Nej |

*Ejerens fire testkonti deler faktisk samme udviklings-IP (`109.59.94.167`, fan-out=4) — men fan-out=4 overstiger det konservative "fan-out≤2"-filter, så de connecter IKKE automatisk via IP i denne version af reglen. Det er præcis derfor whitelist-mekanismen er nødvendig som eksplicit backstop, ikke kun signal-tuning: `database/2026-08-03-fairplay-pair-whitelist.sql` seeder disse par eksplicit.

**Falsk-positiv-rate: 0/5 (0%).** Ingen af de 5 kendte lovlige par flages af reglen, uanset om identitetssignalet blev fundet eller ej — fordi ingen af dem har en ensidig værdistrøm over tærsklen.

## Verdikt: #2221 og #2776

**#2221 (EvoPro/Barra CC) — FANGET, verificeret live 2026-08-03.**
Identitetssignal: email/brugernavn (jcarey071 vs. jcarey983, normaliseret til "jcarey"), konti oprettet 18 timer fra hinanden. Ingen IP-historik overlever fra juni (identity_events eksisterede ikke endnu; Barra CC er frosset og har ikke logget ind siden). Værdistrøm: én byttehandel 2026-07-01 hvor EvoPro afgav en ~5.000-værdi rytter + betalte 1.000 kontant, og modtog Jack Marsh (nuværende base_value 772.214) fra Barra CC — netto **766.201** mod EvoPro. Reglen flager dette par korrekt.

**#2776 (kps@latitude.dk/"Racing bike" → Minisize Biking) — kan IKKE genkøres live, men er verificeret mod backup.**
Kontoen og holdet "Racing bike" blev slettet som del af sanktionen 22/7 (dokumenteret i #2776 selv), så en live query rammer intet. Backup-tabellerne `backup_fairplay_20260722_*` (stadig i prod) bekræfter dog værdistrømmen uafhængigt: 2 transfers, Racing bike → Minisize Biking, 1 kr. stykket, nuværende `base_value` 2.419.441 og 303.964 (historisk på hændelsestidspunktet: 1.787.739 og 179.322 per #2776's egen rapport — differencen er sæson-progression siden, ikke en fejl i denne analyse). Ensidig værdistrøm er under alle omstændigheder langt over 100k-tærsklen.

Identitetssignalet der faktisk løste #2776 dengang — `first_seen_at`-arv, 61 sekunders match, tre uger tidligere — kan ikke gen-udtrækkes i dag, fordi `signup_attribution`-rækken blev cascade-slettet med brugeren og ikke indgik i backup'en (kun users/teams/transfer_offers/riders/race_entries/orphan_entries blev sikkerhedskopieret). Dette er ikke en svaghed i reglen — det er selve grunden til at signal 3 (`first_seen_at`) findes i designet, og fremadrettet persisterer #3132 nu dette signal holdbart for enhver ny sag. **Verdikt: reglen som designet ville have fanget #2776 (og gjorde det, manuelt, dengang); den tekniske forudsætning for at genskabe fundet i en SQL-forespørgsel i dag mangler udelukkende fordi beviskonti blev slettet før #3132 gik live.**

## Whitelist-mekanisme

`database/2026-08-03-fairplay-pair-whitelist.sql` — idempotent DDL, **ikke applieret af denne session** (hård regel). Opretter `public.fairplay_whitelisted_pairs` (RLS-låst, service_role-only, samme mønster som `identity_events`), normaliseret parnøgle (`team_id_lo < team_id_hi`, håndhævet af CHECK + unik indeks), og en defensiv seed-DO-block for ejerens fire testkonti (@cyclingzone.dev) mod hinanden og mod hovedkontoen "Bad At Names". Korrelations-scriptet (`3135-identity-pair-correlation.sql`) LEFT JOIN'er denne tabel og udelukker whitelistede par fra output.

**Krævet handling fra ejer/en senere session:** applicér migrationen (og tilføj evt. de 4 øvrige kendte husstandspar fra 30/7-scanningen, hvis de skal undertrykkes permanent fremfor blot at falde under værdi-tærsklen som i dag).

## Filer leveret

| Fil | Formål |
|---|---|
| `database/2026-08-03-fairplay-pair-whitelist.sql` | Whitelist-DDL (ikke applieret) |
| `scripts/fairplay/3135-identity-pair-correlation.sql` | Hoved-detektor: alle forbundne par + værdistrøm + flag, sidste 90 dage |
| `scripts/fairplay/3135-value-flow-detail.sql` | Drill-down: alle transaktioner mellem to specifikke hold, transaktion for transaktion |
| `scripts/fairplay/3135-validation-known-pairs-and-cases.sql` | Valideringsharness: de 5 kendte par + #2221, med forventet-vs-faktisk-flag |
| `docs/audits/2026-08-03-identity-correlation-3135.md` | Denne rapport |

Filnavne prefixet `3135-` for at undgå kollision med #3137-workeren i samme mappe.

## Integrations-note: hvor bor den ugentlige fair-play-scan?

**Der findes intet dedikeret script eller registreret scheduled-task for den ugentlige fair-play-scan i dag.** Gennemsøgt `scripts/` og `docs/`: `scripts/scheduled-tasks/` har kun `time-tracker-weekly-report`, `weekly-memory-audit` og `worktree-cleanup-weekly` — ingen fair-play-variant. Scanningen er hidtil en tilbagevendende AI-drevet analysesession uden fast bopæl (jf. `.claude/learnings/2026-07-30-fair-pris-er-svindeldetektionens-blinde-vinkel.md`, som selv konstaterer at forespørgslerne genopfindes fra bunden hver gang). Filerne i `scripts/fairplay/3135-*.sql` er de **første checked-in artefakter** for denne scan. Anbefaling: når #3138 (fairplay_flags + scoring + admin-review + daglig cron) bygges, bør den enten (a) importere/genbruge disse queries direkte, eller (b) registrere en `scripts/scheduled-tasks/fairplay-weekly-scan.json` efter samme mønster som de tre eksisterende, med denne fil + `3135-identity-pair-correlation.sql` som reference.

## Kendte begrænsninger

1. **`base_value` er nuværende værdi, ikke historisk.** Ingen value-snapshot-tabel findes. For handler i 90-dages-vinduet er driftet typisk lille; for ældre sager (som #2221, 5 uger gammel) kan det afvige mærkbart — se #2221-tallet ovenfor vs. den oprindelige #2226-rapport.
2. **Fan-out≤2-heuristikken reducerer CGNAT-støj, eliminerer den ikke.** En lille population (189 brugere) kan stadig give tilfældige fan-out=2-sammenfald inden for et promiskuøst adresseområde (set i data: Beers & Gears/Guaracha Guerreros). Fremtidig forbedring: kræv vedvarende gen-brug af samme IP over flere ADSKILTE dage for begge parter, eller vedligehold en liste over kendte mobiloperatør-/CGNAT-ranges.
3. **`identity_events` er kun 3 dage gammel** (live siden 2026-07-31) plus ét engangs-backfill-snapshot af aktive sessioner ved migrationstidspunktet. IP-baseret korrelation for sager ældre end det har kun det snapshot at arbejde med — det er derfor #2221's IP-historik er tom (Barra CC har ikke logget ind siden frysningen) og #2776 slet ikke findes (kontoen er slettet).
4. **Signup-tidsnærhed (≤15 min) og email-lighed er lavtillid-signaler alene** — de bidrager kun til et flag når de er koblet med en reel værdistrøm over tærsklen, præcis som designet foreskriver.
5. **100.000-tærsklen er en arbejds-konvention lånt fra #2226**, ikke empirisk kalibreret her. #3136 leverer det datagrundlag.

## Åbne spørgsmål til ejer

- Skal de 4 øvrige kendte husstandspar (24/7↔Metro-L3, Wheelbarrels↔Nickstar, MorseCodes↔VelocityOne, TR↔LEGO-Vestas) whitelistes proaktivt nu, eller er det nok at de i dag falder under værdi-tærsklen?
- Skal Beers & Gears ↔ Guaracha Guerreros (fan-out=2, men i et ellers promiskuøst adresseområde, -76.678 under tærsklen) have et kig, eller er den for lav til at være værd at bruge tid på?
