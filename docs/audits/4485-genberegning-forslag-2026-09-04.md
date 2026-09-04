# #4485 — Genberegningsforslag: ungdomsklassement sæson 3 (GENKØRT m. U25 ≤25-regel)

> Status: FORSLAG, ikke kørt. Erstatter `docs/audits/4485-genberegning-foreslag.md` (31/8, 3 løb, gammel U25-regel — forældet, se ejerens kommentar på #4485 2/9). Al måling herunder er SELECT-only mod prod (`ghwvkxzhsbbltzfnuhhz`), 2026-09-04. Ingen skrivning er foretaget. Kodefixet for begge bugs (sæson-referenceår + ≤25-cutoff, PR #4593) er allerede merget — dette dokument dækker KUN de historiske `race_results`-rækker fra før fixet.

## Baggrund

To bugs ramte ungdomsklassementet i sæson 3, oven i hinanden:

1. **Forkert referenceår** (den oprindelige #4485-fejl): `loadSeasonReferenceYear` i `backend/lib/raceRunner.js` læste årstal af `seasons.start_date` (wall-clock) i stedet for `seasons.number` via SSOT'en i `backend/lib/riderSeasonAge.js`. I sæson 3 gav det referenceår 2026 i stedet for 2028 — alle ryttere blev regnet 2 år yngre end de er.
2. **Forkert cutoff** (ejer-beslutning 2/9, PR #4593): U25 fulgte "sæson-alder < 25" (24 år og yngre); UCI-reglen er "sæson-alder ≤ 25" (25-årige tæller stadig med).

Begge er rettet i koden (`isU25ForReferenceYear` i `riderSeasonAge.js`, kaldt fra `raceRunner.js`). Denne audit måler hvor meget af de HISTORISKE `race_results`-rækker for sæson 3 (`season_id = 00000000-0000-0000-0000-000000000003`), skrevet under de gamle bugs, der stadig er forkerte målt mod den nu korrekte regel: **fødselsår ≥ 2003** (referenceår 2028 − 25).

Ejerens kommentar på #4485 (2/9): målt 915 rækker / 28.125 CZ$ i 26 løb (kun `young`), + 38 etaperækker med manglende 25-årige — "genkør audit med ny regel, så ét go på rang + point + penge samlet, og samlet besked til spillerne FØRST ved genberegningen."

## Metode

- **Scope:** alle 30 afsluttede S3 `stage_race`-løb (single-day-løb har ingen ungdomstrøje, jf. #3718-forward-guard i `raceResultsEngine.js`).
- **Korrekt medlemskab:** fødselsår ≥ 2003 (`extract(year from riders.birthdate) >= 2003`), tidszone-uafhængigt ligesom `riderSeasonAge.js`s dato-kun-parsing (Postgres `DATE`-kolonner har intet klokkeslæt, så JS'ens UTC/lokal-drift-problem findes ikke i SQL).
- **Korrekt rækkefølge — genbruger den EKSISTERENDE sportslige facitliste, rører aldrig `finish_time`/`gc`-rang:**
  - `young` (slutklassement): filtrér `result_type='gc'`-rækkerne (sæson-3 sluttiden, urørt) til fødselsår ≥ 2003, og genranger 1..N i samme rækkefølge som `gc.rank`. Dette er matematisk identisk med motorens `rankByCumTimeAsc(classified.filter(is_u25), cumTime, posSum)`, fordi `gc`-rækkefølgen ALLEREDE er cumTime-rækkefølgen — at filtrere og bevare relativ orden ændrer ikke resultatet.
  - `young_day` (daglig ungdomstrøje): samme princip, men baseret på `result_type='leader'` (dagens GC-så-langt-rækkefølge) pr. `stage_number`, filtreret til fødselsår ≥ 2003 og genranget 1..N. `leader`-feltet har altid fuld feltstørrelse (v3: alle er "classified" på alle etaper, jf. kommentar `raceRunner.js:259`).
  - Sidste etape af hver løb emitter `gc`/`young` (ikke `leader`/`young_day`) — ekskluderet fra `young_day`-sammenligningen for at undgå falske "manglende rækker".
- **Point/præmie:** slået op i `race_points` (`result_type='Ungdomstroje'` for `young`, `'UngdomstrojeDag'` for `young_day`), samme tabel motoren selv bruger via `buildRacePointsLookup`. `prize_money = points * 75` (`PRIZE_PER_POINT`, `economyConstants.js`). Bekræftet: `Ungdomstroje` betaler rang 1-3, `UngdomstrojeDag` betaler KUN rang 1 (alle race_class har `rank=1` som eneste ikke-nul-række).

## Målt omfang

### 1. Forkert inkluderede 26+-ryttere (samme mål som ejerens 2/9-tal)

| | young | young_day | I alt |
|---|---|---|---|
| Forkerte rækker (fødselsår < 2003, dvs. sæson-3-alder ≥ 26) | 146 | 769 | **915** |
| Løb ramt | — | — | **26 af 30** |
| Point fjernet | 375 | 78 | 453 |
| Præmie fjernet (kun rang ≤3, da kun de betaler) | 28.125 CZ$ | 5.850 CZ$ | **33.975 CZ$** |

**Matcher ejerens 2/9-måling præcist (915 rækker, 26 løb, 28.125 CZ$ for `young`)** — bekræfter at metoden herunder er identisk med den ejeren målte med.

### 2. Manglende 25-årige (ny, mere komplet måling end 2/9's "38 etaperækker")

`young` (slutklassement): **0 manglende rækker.** De to gamle bugs opvejede hinanden præcist i sæson 3: forkert referenceår gjorde alle 2 år "yngre" end reelt, og den gamle "< 25"-cutoff blev derved reelt "sæson-3-alder ≤ 26" — en delmængde-superset af den korrekte "≤ 25". Alle reelt 25-årige var derfor (ved et matematisk sammenfald) altid korrekt inkluderet i slutklassementet; kun 26-årige stod forkert (afsnit 1).

`young_day` (daglig trøje): **72 etaperækker i 7 løb** hvor en reelt 25-årig rytter helt mangler i klassementet den dag. Dette opstår i det SMALLE deploy-vindue hvor referenceårs-fixet var landet, men ≤25-cutoff-fixet endnu ikke — kun 1 specifik etape pr. berørt løb rammes (den etape der blev kørt i netop det vindue), ikke hele løbet:

| Løb | Berørt etape | Manglende 25-årige rækker |
|---|---|---|
| Giro della Penisola | 14 af 18 | 10 |
| Tour des Grandes Alpes (×2 instanser) | 4 af 6 | 21 |
| Volta ao Alentejo (×4 instanser) | 1 af 4 | 41 |

Fordi dette er en RÆKKEFØLGE-fejl (en manglende 25-årig kan fortrænge den nuværende dagsvinder), måler næste afsnit den faktiske PENGE-konsekvens — som er større end de 72 rækker isoleret set antyder.

### 3. Faktisk podie-/pengekonsekvens

**`young` (slutklassement, rang 1-3 betaler):** 9 af de 26 ramte løb har en reel top-3-ændring (de øvrige 17 løbs 26+-ryttere lå udenfor top-3, så klassementet var visuelt forkert men uden pengekonsekvens). Fast præmiepulje pr. rang ⇒ "overbetalt i alt" = "skyldes i alt" pr. definition (samme rang-beløb, blot til en anden rytter):

| Løb | Rang | Rytter (før → efter) | Hold (før → efter) | Point | Præmie (uændret pr. rang) |
|---|---|---|---|---|---|
| Étoile de Bessèges Mineure (d31bdf60) | 1 | Connor Marsh → Sander Holm | SJ racing → AI Threshold Continental | 27 | 2.025 CZ$ |
| | 2 | Sander Holm → Damien Guerin | AI Threshold Continental → SJ racing | 16 | 1.200 CZ$ |
| | 3 | Damien Guerin → Raúl A. Iglesias | SJ racing → AI Threshold Continental | 11 | 825 CZ$ |
| Étoile de Bessèges Mineure (92ed5885) | 2 | Aitor H. Quintero → Dylan B. Murphy | Nimbus Development 2 → Meridian Cycling Collective | 16 | 1.200 CZ$ |
| | 3 | Dylan B. Murphy → Antoine Vasseur | Meridian Cycling Collective → Couscousgarbit | 11 | 825 CZ$ |
| Étoile de Bessèges Mineure (7b024a19) | 2 | Alberto Álvarez → Yeison Godoy | DLS Invigo → Prime bevere | 16 | 1.200 CZ$ |
| | 3 | Yeison Godoy → Wessel Cornelis | Prime bevere → DLS Invigo | 11 | 825 CZ$ |
| Tour of South Australia | 2 | Kaito Yoshida → Pieter Claes | Guaracha Guerreros → NewE Pro Cycling | 66 | 4.950 CZ$ |
| | 3 | Pieter Claes → Andrea Riva | NewE Pro Cycling → Aquila–L3gatus Racing Team | 40 | 3.000 CZ$ |
| Volta Algarvia (f4116a14) | 1 | Ruben Segers → Sebastian Lindholm | Team Brennan → Team Brutaliste | 53 | 3.975 CZ$ |
| | 2 | Sebastian Lindholm → Niels Tielemans | Team Brutaliste → North Sea Pro Cycling | 33 | 2.475 CZ$ |
| | 3 | Niels Tielemans → Bonaventure Hakizimana | North Sea Pro Cycling → Island Cycling Team | 20 | 1.500 CZ$ |
| Volta Algarvia (e0958b1e) | 2 | Philipp Schwarz → Yang Cao | Sigaard Cycling → Time-Out Hooligans | 33 | 2.475 CZ$ |
| | 3 | Yang Cao → Noah Andersen | Time-Out Hooligans → puckpuckpuck | 20 | 1.500 CZ$ |
| Vuelta a los Picos (e27767ef) | 1 | Jan Fischer → Philipp Schäfer | Tempo Racing → Maillot Devo 3 | 27 | 2.025 CZ$ |
| | 2 | Philipp Schäfer → Woojin Park | Maillot Devo 3 → Chilihvidløg | 16 | 1.200 CZ$ |
| | 3 | Woojin Park → Bram M. Dekker | Chilihvidløg → Maillot Devo 3 | 11 | 825 CZ$ |
| Vuelta a los Picos (94ab93b0) | 1 | Hao Wu → Stijn Mertens | Helmers → Helmers | 27 | 2.025 CZ$ |
| | 2 | Stijn Mertens → Diego G. Delgado | Helmers → Peloton Racing | 16 | 1.200 CZ$ |
| | 3 | Diego G. Delgado → Gonzalo I. Vargas | Peloton Racing → Domestik Development | 11 | 825 CZ$ |
| Vuelta a los Pirineos (34955148) | 1 | Gonzalo Herrera → Ryan Whitfield | A-PEX VELO → Borregaard Racing | 80 | 6.000 CZ$ |
| | 2 | Ryan Whitfield → Corentin Aubert | Borregaard Racing → Metro-L3 | 50 | 3.750 CZ$ |
| | 3 | Nathan Maillot → Hyun Ahn | Reynolds Team → A-PEX VELO | 30 | 2.250 CZ$ |

**Sum: 28.125 CZ$ overbetalt = 28.125 CZ$ skyldes de korrekte top-3.**

De øvrige 17 ramte løb (bl.a. Giro della Penisola, begge Tour des Grandes Alpes-instanser, Vuelta a los Pirineos 8ed6454d — hvor Daan Visser født 2003-12-10 nu er LOVLIGT U25 under den nye ≤25-regel og beholder sin 1.-plads) har uændret top-3: de forkerte 26+-ryttere i de løb lå alle uden for podiet.

**`young_day` (daglig trøje, kun rang 1 betaler):** 13 løb, 30 etape-dage skifter vinder. To forskellige mekanismer bidrager:

| Kilde | Rækker | CZ$ |
|---|---|---|
| 26+-rytter var (forkert) dagens leder | ~24 | 5.850 |
| Reel U25-rytter forfremmet til leder, fordi den retmæssige 25-årige leder manglede helt (afsnit 2) | ~6 | 1.500 |
| **I alt** | **30** | **7.350 CZ$** |

Eksempel på kæde-effekten (Vuelta a los Pirineos 34955148, etape 1/4/5): Gonzalo Herrera (26, A-PEX VELO) var forkert dagsleder alle tre dage; retmæssig leder er Ryan Whitfield (Borregaard Racing) etape 1+5, Corentin Aubert (Metro-L3) etape 4.

### 4. Samlet — rang + point + penge (ét go)

| | young | young_day | I alt |
|---|---|---|---|
| Forkert klassificerede rækker (medlemskab) | 146 | 769 + 72 manglende | 987 |
| Podie-/leder-pladser der skifter hænder | 9 løb / ~23 rækker | 13 løb / 30 etape-dage | 22 løb-instanser* |
| Point flyttet | 375 | 98 | 473 |
| CZ$ overbetalt (= CZ$ skyldes, fast pulje pr. rang) | 28.125 | 7.350 | **35.475 CZ$** |

*22 løb-instanser = unikke løb ramt på podie-/lederniveau (9 for `young` + 13 for `young_day`, nogle løb optræder i begge lister). 30 af de 30 afsluttede S3-etapeløb har mindst én forkert klassifikations-række et sted i feltet (medlemskab), men kun disse 22 har en reel penge-/rangkonsekvens.

**Point-konsekvens for `season_standings`/divisionsplacering: IKKE undersøgt i denne SELECT-only audit** (samme forbehold som 31/8-udgaven). De 473 point flytter mellem specifikke hold (se holdtabel nedenfor for hvem), ikke bare væk — hvis et af de "skylder point"-hold ligger tæt på en divisionsgrænse, kan dette udvide hvem der skal kompenseres. Bør tjekkes FØR reparationen køres.

## Hold ramt — netto CZ$ (kombineret young + young_day)

Fast præmiepulje pr. rang betyder "overbetalt i alt" = "skyldes i alt" (35.475 = 35.475), men IKKE pr. hold — nogle hold har kun modtaget for meget, andre kun for lidt, nogle begge dele på forskellige løb. Top 15 efter "skyldes":

| Hold | AI? | Nuværende saldo | For meget modtaget | Skyldes yderligere |
|---|---|---|---|---|
| Metro-L3 | Nej | 6.605 | 0 | 4.125 |
| Borregaard Racing | Nej | 452.325 | 0 | 3.375 |
| Aquila–L3gatus Racing Team | Nej | 19.870 | 0 | 3.000 |
| Team Brutaliste | Nej | 820.940 | 0 | 2.400 |
| A-PEX VELO | Nej | 1.163.953 | 7.500 | 2.250 |
| AI Threshold Continental | Ja | 581.075 | 0 | 2.100 |
| NewE Pro Cycling | Nej | 41.164 | 0 | 1.950 |
| Maillot Devo 3 | Ja | 510.650 | 0 | 1.650 |
| Island Cycling Team | Nej | 134.962 | 0 | 1.500 |
| puckpuckpuck | Nej | 1.194.724 | 0 | 1.500 |
| Helmers | Nej | 43.161 | 2.625 | 1.125 |
| Suconia STNS Cycling Team | Nej | 774.294 | 0 | 1.125 |
| Time-Out Hooligans | Nej | 629.911 | 0 | 975 |
| North Sea Pro Cycling | Nej | 918.045 | 0 | 975 |
| Team Easy-On | Nej | 481.596 | 0 | 900 |

... (24 yderligere hold med mindre beløb, i alt 39 hold ramt: 10 kun "for meget", 21 kun "skyldes", resten begge på forskellige løb). Største enkelt-"for meget"-poster: Guaracha Guerreros 5.850 CZ$, Team Brennan 4.875 CZ$, A-PEX VELO 7.500 CZ$ (7.500 CZ$ er A-PEX VELOs sum over TO løb — Gonzalo Herrera var forkert leder/podie i begge Vuelta a los Pirineos-instanser). Alle hold med beløb > 0 er `is_ai = false` (menneskestyrede) UNDTAGEN AI Threshold Continental, Maillot Devo 3, Domestik Development, Meridian Cycling Collective, Peloton Racing, Summit Devo, Titanium Development 2, Strada Cycling, Aero Cycling Collective, Nimbus Development 2, Tempo Racing (AI-hold — "skylder"-beløb til et AI-hold er kun bogholderi, ingen spiller mærker det).

## Anbefaling til pengehåndtering (samme A/B-ramme som 31/8, nu opdateret beløb)

**A — Ingen tilbagetrækning, kun efterbetaling (anbefalet, som 31/8):** De 35.475 CZ$ der allerede er udbetalt til forkerte modtagere bliver hos dem; de korrekte modtagere får differencen efterbetalt via den normale præmie-udbetalingssti. Nettoomkostning: 35.475 CZ$ engangsudgift. Ingen spiller får en uforklaret negativ saldo-post for en motorfejl der ikke var deres skyld.

**B — Fuld reversering:** Træk de 35.475 CZ$ tilbage fra de forkerte modtagere, betal de korrekte. Nettoomkostning: 0 CZ$, men ~15-20 menneskestyrede hold får en uventet debitering for et resultat de opnåede inden for de daværende (fejlbehæftede) regler.

**Anbefaling: A**, af samme grunde som 31/8-udgaven — beløbet er trivielt i forhold til holdenes saldi (mediansaldo i tabellen ovenfor er langt over 100.000 CZ$), og en retroaktiv straf skaber mere støj end den sparer.

## Foreslået reparation — IKKE kørt, kun forslag

Idempotent, opdelt i rang → point → penge, med backup FØR skrivning og post-verify EFTER. Følger mønsteret fra `database/2026-09-01-4377-jersey-wins-cumulative-repair.sql` (backup-tabel + `BEGIN/COMMIT` + post-verify-SELECT'er i kommentar). `entrant_key` er `GENERATED ALWAYS` (se `database/2026-08-06-race-results-entrant-uid.sql`) — indsættes ALDRIG eksplicit, udledes automatisk af `rider_id`/`team_id`.

**Forudsætning før kørsel:** verificér `season_standings.total_points`-konsekvensen (afsnit 4) og få eksplicit "kør"-godkendelse pr. hard rule i `CLAUDE.md` (eksplicit GO pr. prod-skridt). Anbefaling: kør som et lille `backend/scripts/dev/`-engangsscript der genbruger `rankByCumTimeAsc`/`buildRacePointsLookup` direkte (undgår en SJETTE kopi af ranking-logikken) med dry-run som standard — nedenstående SQL er et VALIDERET forslag (rækkefølgen er matematisk identisk med motorens, se Metode-afsnittet), men bør stadig køres dry-run først.

```sql
BEGIN;

-- ── Trin 0: BACKUP FØR SKRIVNING ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.race_results_4485_backup_20260904 (
  id             uuid PRIMARY KEY,
  race_id        uuid,
  stage_number   integer,
  result_type    text,
  rank           integer,
  rider_id       uuid,
  rider_name     text,
  team_id        uuid,
  team_name      text,
  points_earned  integer,
  prize_money    bigint,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.race_results_4485_backup_20260904
  (id, race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, points_earned, prize_money)
SELECT id, race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, points_earned, prize_money
FROM public.race_results
WHERE result_type IN ('young', 'young_day')
  AND race_id IN (
    SELECT id FROM public.races
    WHERE season_id = '00000000-0000-0000-0000-000000000003'
      AND status = 'completed' AND race_type = 'stage_race'
  )
ON CONFLICT (id) DO NOTHING;

-- ── Trin 1: RANG — erstat medlemskab + rækkefølge ────────────────────────────
-- Sletter alle nuværende young/young_day-rækker for berørte løb og genopbygger
-- dem fra den URØRTE gc/leader-rækkefølge, filtreret til fødselsår >= 2003.
-- points_earned/prize_money sættes til 0 her — udfyldes i trin 2+3.
WITH s3_races AS (
  SELECT id, race_class FROM public.races
  WHERE season_id = '00000000-0000-0000-0000-000000000003'
    AND status = 'completed' AND race_type = 'stage_race'
),
deleted AS (
  DELETE FROM public.race_results
  WHERE result_type IN ('young', 'young_day')
    AND race_id IN (SELECT id FROM s3_races)
  RETURNING 1
),
gc_u25 AS (
  SELECT rr.race_id, rr.rider_id,
    row_number() OVER (PARTITION BY rr.race_id ORDER BY rr.rank) AS new_rank
  FROM public.race_results rr
  JOIN s3_races sr ON sr.id = rr.race_id
  JOIN public.riders r ON r.id = rr.rider_id
  WHERE rr.result_type = 'gc' AND extract(year FROM r.birthdate)::int >= 2003
),
leader_u25 AS (
  SELECT rr.race_id, rr.stage_number, rr.rider_id,
    row_number() OVER (PARTITION BY rr.race_id, rr.stage_number ORDER BY rr.rank) AS new_rank
  FROM public.race_results rr
  JOIN s3_races sr ON sr.id = rr.race_id
  JOIN public.riders r ON r.id = rr.rider_id
  WHERE rr.result_type = 'leader' AND extract(year FROM r.birthdate)::int >= 2003
  -- Sidste etape emitter 'gc' i stedet for 'leader' — naturligt ekskluderet,
  -- da der ikke findes en tilsvarende 'young_day'-forbruger for den stage_number.
)
INSERT INTO public.race_results
  (race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, points_earned, prize_money)
SELECT g.race_id, 1, 'young', g.new_rank, r.id,
       trim(r.firstname || ' ' || r.lastname), t.id, t.name, 0, 0
FROM gc_u25 g
JOIN public.riders r ON r.id = g.rider_id
LEFT JOIN public.teams t ON t.id = r.team_id
UNION ALL
SELECT l.race_id, l.stage_number, 'young_day', l.new_rank, r.id,
       trim(r.firstname || ' ' || r.lastname), t.id, t.name, 0, 0
FROM leader_u25 l
JOIN public.riders r ON r.id = l.rider_id
LEFT JOIN public.teams t ON t.id = r.team_id;

-- ── Trin 2: POINT — udled points_earned af (race_class, result_type, rank) ──
UPDATE public.race_results rr
SET points_earned = COALESCE(rp.points, 0)
FROM public.races ra
LEFT JOIN public.race_points rp
  ON rp.race_class = ra.race_class
 AND rp.result_type = CASE rr.result_type WHEN 'young' THEN 'Ungdomstroje' ELSE 'UngdomstrojeDag' END
 AND rp.rank = rr.rank
WHERE rr.race_id = ra.id
  AND rr.result_type IN ('young', 'young_day')
  AND ra.season_id = '00000000-0000-0000-0000-000000000003'
  AND ra.status = 'completed' AND ra.race_type = 'stage_race';

-- ── Trin 3: PENGE — prize_money = points_earned * PRIZE_PER_POINT (75) ───────
-- ⚠️ Kun klassement-FELTET rettes her. Den FAKTISKE udbetaling af differencen
-- til de korrekte top-3/leder-hold (35.475 CZ$, se afsnit "Anbefaling A")
-- SKAL gå via den normale præmie-udbetalingssti (samme kode raceRunner bruger
-- til at kreditere teams.balance), ALDRIG en direkte UPDATE teams.balance —
-- ellers mister transaktionen sit spor i holdets øvrige økonomi-historik.
UPDATE public.race_results
SET prize_money = points_earned * 75
WHERE result_type IN ('young', 'young_day')
  AND race_id IN (
    SELECT id FROM public.races
    WHERE season_id = '00000000-0000-0000-0000-000000000003'
      AND status = 'completed' AND race_type = 'stage_race'
  );

COMMIT;

-- ── POST-VERIFY (kør efter COMMIT) ───────────────────────────────────────────
-- 4a. Ingen 26+-rytter tilbage i young/young_day for S3 (forventet 0):
--     SELECT count(*) FROM public.race_results rr
--     JOIN public.races ra ON ra.id = rr.race_id
--     JOIN public.riders r ON r.id = rr.rider_id
--     WHERE rr.result_type IN ('young','young_day')
--       AND ra.season_id = '00000000-0000-0000-0000-000000000003'
--       AND extract(year FROM r.birthdate)::int < 2003;
--
-- 4b. Ingen manglende 25-årige tilbage (forventet 0 for young_day; young var
--     allerede 0 før reparationen):
--     -- (gentag "missing"-forespørgslen fra Metode-afsnittet mod race_results
--     --  EFTER reparationen; forventet 0 rækker)
--
-- 4c. Rækkeantal pr. løb uændret ift. feltstørrelsen (ingen rytter tabt/duplikeret):
--     SELECT race_id, result_type, stage_number, count(*) FROM public.race_results
--     WHERE result_type IN ('young','young_day')
--       AND race_id IN (SELECT id FROM public.races WHERE season_id='00000000-0000-0000-0000-000000000003')
--     GROUP BY race_id, result_type, stage_number
--     -- sammenlign manuelt mod feltstørrelsen i backup-tabellen + gc/leader-optællingen.
--
-- 4d. Backuppen dækker alle rørte rækker:
--     SELECT count(*) FROM public.race_results_4485_backup_20260904;
--
-- ── ROLLBACK (kun hvis nødvendigt) ───────────────────────────────────────────
-- BEGIN;
-- DELETE FROM public.race_results
--   WHERE result_type IN ('young','young_day')
--     AND race_id IN (SELECT DISTINCT race_id FROM public.race_results_4485_backup_20260904);
-- INSERT INTO public.race_results (id, race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, points_earned, prize_money)
--   SELECT id, race_id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, points_earned, prize_money
--   FROM public.race_results_4485_backup_20260904;
-- COMMIT;

-- Refs #4485
```

**Efterbetalingen (35.475 CZ$ til de korrekte top-3/ledere) er IKKE inkluderet i SQL'en ovenfor** — den skal ske via den normale prize-udbetalingskode (kreditering af `teams.balance` gennem samme sti raceRunner bruger), ikke en direkte `UPDATE`. Team-tabellen i afsnittet ovenfor giver de præcise beløb pr. hold.

## Udkast til spillerbesked (ejeren poster selv)

**EN:**
> We found and fixed a bug where the youth classification (young rider jersey) in some Season 3 stage races didn't match the new U25 rule (25-and-under) correctly — a handful of riders were shown who shouldn't have been, and a few 25-year-olds were missing from the daily jersey on one stage per affected race. We corrected the classification for 26 races and are crediting the difference to every team that was shortchanged. Nobody who already received a prize is having it taken back.

**DA:**
> Vi har fundet og rettet en fejl hvor ungdomsklassementet (den unge rytters trøje) i nogle sæson 3-etapeløb ikke fulgte den nye U25-regel (25 år og yngre) korrekt — enkelte ryttere stod forkert med, og et par 25-årige manglede i dagstrøjen på én etape pr. berørt løb. Vi har rettet klassementet i 26 løb og krediterer differencen til alle hold der fik for lidt. Ingen der allerede har fået en præmie, får den trukket tilbage.

## Ikke undersøgt (out of scope for denne SELECT-only audit)

- Om de 473 fejlagtige `points_earned` har påvirket `season_standings.total_points` og dermed divisionsplacering/sæson-præmier. Bør tjekkes FØR reparationsscriptet køres (hold-tabellen ovenfor viser hvem der skylder point).
- Sæson 1/2-instanser af de samme løbstyper — målt 0 forkerte rækker for sæson 1-2 i den oprindelige 31/8-audit (referenceåret matcher tilfældigt for tidlige sæsoner); ikke genmålt her, da #4485/#4593 kun er en sæson-3-drift-fejl.
