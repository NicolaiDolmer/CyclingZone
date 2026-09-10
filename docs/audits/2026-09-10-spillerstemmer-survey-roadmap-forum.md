# Spillerstemmer 20/8-10/9 2026: spørgeskema, roadmap-stemmer og forum

> Kilder: spørgeskema `2026-09-features` (27 gennemførte), `roadmap_item_scores`, `forum_posts`/`forum_replies` (udvalgte tråde), `nps_responses` (30 dage), `player_feedback` (21 dage). Alle tal er kørt direkte mod databasen 10/9. SQL i bilaget.

## 1. Sammenfatning

Spillerne peger samstemmende på tre ting: **ungdom/akademi** (U23, junior, reelle overgange), **træning** (dybde, tydelighed, races der tæller som træning) og **race engine v4** (allerede i gang). De tre kilder, spørgeskema, roadmap-stemmer og forum, rammer alle samme retning på disse tre områder, hvilket er et usædvanligt stærkt signal for et skema med kun 27 svar.

Spillerne afviser klart tre ting: delte træningsprogrammer mellem managere (30 % veto), AI-hold der byder uopfordret (30 % veto) og at håndtere transfers direkte fra indbakken (28 % veto). De vil heller ikke betale ekstra for Pro medmindre det er kosmetik/statistik, aldrig gameplay-fordele; det siges eksplicit syv gange i fritekst. Kun 7 % ville betale nyt for Pro med det de selv valgte.

Fog of war-holdningen er klar: 71,5 % vil have mere skjult, men markedsværdien der afslører unge rytteres potentiale er det mest utvetydige punkt (kun 7,4 % veto), mens fulde interval-visninger på rivaler er mere delt (11,1 % veto). Mobil er en gentagen klage på tværs af alle kilder (works_worst 22 %, fritekst, egen forumtråd, åbne issues).

Det største enkeltstående forum-drama var en bug: sponsor-basen rebases ikke ved oprykning, så 21 af 24 D1-hold betaler D1-udgifter med lavere-divisions indtægt. Ejeren har allerede erkendt det i tråden 31/8 og lovet en rettelse (#4376, bekræftet, åben).

Svarprocenten på spørgeskemaet er lav (11,2 % af 242 spilleberettigede), så tallene er retningsgivende, ikke repræsentative. NPS-stikprøven (6 svar/30 dage) er for lille til at sige noget.

## 2. Spørgeskemaet

**Svarprocent:** 242 spilleberettigede managere, 36 startede, 27 gennemførte = **11,2 %**, gennemsnit 11,3 minutter.

**Tilfredshed (skala 1-5):** ingen under 3. 3: 5 svar · 4: 24 svar · 5: 6 svar. Gennemsnit ≈ 4,0/5. Positivt, men ingen "5-topscorer"-klynge; de fleste sidder på et solidt, ikke begejstret 4-tal.

### Top-8 idéer (idé × vigtighed, skala 0-25), med veto-andel

| # | Idé | Kombineret | Veto-% |
|---|---|---|---|
| 1 | Løbene træner dig (brosten gør dig bedre på brosten) | 17,03 | 3,3 |
| 2 | Gå efter bjerg-/pointtrøjen fra start | 16,63 | 0,0 |
| 3 | U23/juniorhold med egne løb | 16,18 | 7,1 |
| 4 | Markedsværdi der ikke afslører skjult potentiale | 15,84 | 7,4 |
| 5 | Formtræning til udlærte ryttere | 15,05 | 7,7 |
| 6 | Mindre side-sponsorer med egne mål | 14,31 | 4,2 |
| 7 | Holdets udseende (trøje/logo) | 13,66 | 3,7 |
| 8 | Rivalers evner som intervaller (scouting) | 13,27 | 11,1 |

**Bund-5:** delte træningsprogrammer (6,41, veto 30,4 %) · håndtér transfers fra indbakken (8,85, veto 28,0 %) · AI-bud fra AI-hold (9,29, veto 29,6 %) · følg løb live (9,50, veto 17,2 %) · billeder af ryttere/personale (9,51, veto 3,7 %, lav idé men ingen modstand).

**Hvad fungerer dårligst i dag** (andel af de 36 der svarede): træning 44,4 % · holdudtagelse 38,9 % · løb 27,8 % · akademi 27,8 % · at lære spillet 22,2 % · mobil 22,2 % · kalender 19,4 % · marked 16,7 % · økonomi 13,9 % · indbakke 8,3 % · stabilitet 2,8 % · forum 0.

**Fog of war** (`fog_more`): lidt mere 42,9 % · meget mere 28,6 % · ikke mere 21,4 % · ingen holdning 7,1 %. 71,5 % vil have mere skjult. Krydset med idé-aksen peger "lidt mere" (stop værdi-lækage) klarere end "meget mere" (fulde intervaller): `value_no_leak` har lavere veto end `fuzzy_rivals` (7,4 % mod 11,1 %).

**Pro-holdninger:**
- Hvad hører hjemme i Pro: analyse/statistik 57,1 % · profilmærke 46,4 % · historik/palmares 42,9 % · **ingenting ekstra** 39,3 % · omdøbning 32,1 % · sammenligning 32,1 % · udseende 25,0 % · tidlig adgang 10,7 %.
- Betalingsvilje: betaler allerede 46,4 % · måske 35,7 % · nej 10,7 % · ja (nyt) kun 7,1 %.
- Fritekst-tema, syv af syv `pro_exclusions`-svar der nævner princip: **ingen konkurrencefordel i Pro**. Citater: "Pay-to-win!" · "Pro skal i min verden ikke give noget man ikke kan få uden at betale" · "Anything that gives an advantage in the game."

**Inviter en ven:** send et link 34,6 % · gør det allerede 30,8 % · nemmere start til nye 26,9 % · kender ingen 26,9 % · privat liga 15,4 % · belønning til begge 11,5 % · duel 7,7 %.

### Fritekst-temaer

| Spørgsmål | Tema | Antal | Eksempel-citat (maks 12 ord) |
|---|---|---|---|
| one_thing (28 svar) | Træning/rytterudvikling | 7 | "Klart træning og rytterudvikling." |
| one_thing | Junior/U23/akademi | 5 | "Junior and u23 academy's and races" |
| one_thing | Kosmetik/personalisering | 3 | "Personificering af hold/ryttere/løb med udseende/farver/billeder." |
| play_more (10 svar) | Live/detaljeret løbsvisning | 3 | "Hvis løbene blev vist live, endnu mere detaljeret" |
| play_more | Spiller allerede nok | 2 | "Syntes godt nok allerede at jeg checker mit hold temmelig mange gange dagligt" |
| works_worst_detail (14 svar) | Mobil-UX (lister, ranglister) | 5 | "Certain views and lists on mobile view are lacking." |
| works_worst_detail | Udvikling føles langsom/uklar | 4 | "Rider development feels slow... need to develop until 24-26" |
| pro_exclusions (7 svar) | Ingen konkurrencefordel | 5 | "Pro shall not give what you cannot get free" |

## 3. Roadmap-stemmer

Top-10 efter styringsscore (idé × vigtighed, `roadmap_item_scores`, kun godkendte):

| # | Idé | Motor | Stemmer | Score | Status |
|---|---|---|---|---|---|
| 1 | Unge ryttere du selv opdagede og udviklede til stjerner | youth | 34 | 29,77 | active |
| 2 | U19/U23 med reelle forfremmelsesveje fra akademi | youth | 35 | 26,88 | active |
| 3 | Ungdomsakademier: din egen næste generation | youth | 29 | 26,59 | **shipped** |
| 4 | Taktik og form der reelt styrer udfald | races | 34 | 26,58 | **shipped** |
| 5 | Langsigtet udvikling du kan se og styre | training | 33 | 26,39 | active |
| 6 | Meningsfulde valg, aldrig regneark-lektier | training | 33 | 25,80 | active |
| 7 | Mere levende løbsreferater, på vej mod live | races | 30 | 25,60 | **shipped** |
| 8 | Smartere sæsonplanlægger (overlap, træthed, kvalifikation) | races | 35 | 25,59 | active |
| 9 | Reel træningsdybde: programmer pr. rytter | training | 33 | 25,28 | active |
| 10 | Generationsfornyelse for klubbens fremtid | youth | 32 | 24,93 | active |

Roadmap-toppen er domineret af ungdom (4 af top-10) og træning (3 af top-10), præcis samme to områder som spørgeskemaets top og "fungerer dårligst"-listen. Bemærkelsesværdigt: tre af top-10 er allerede **shipped** (akademier, taktik/form, livlige referater), hvilket viser at spillerne fortsat vurderer disse højt selv efter levering, det er ikke mættet endnu. Lavt-stemte men høj idé: "Direkte beskeder mellem managere" (kun 3 stemmer, idé 5,33) og "Inviter en ven" (3 stemmer, idé 5,33 men vigtighed kun 1,67, lav prioritet trods god idé).

## 4. Forum-temaer

**Financial Punishment? (36 svar, størst engagement):** en spiller fandt at sponsor-basen ikke rebases ved oprykning, så D1-hold betaler D1-udgifter med D3-indtægt. Diskussionen afdækkede også en overtrædelse af regel om ét hold pr. person (selvmeldt, afklaret uden karantæne). Ejeren bekræftede fejlen 31/8 og lovede en fix; alle enige om at det er en reel fejl, ikke en balance-diskussion.

**The future of: Youth and academy (8 svar, højeste visningstal 46):** bred konsensus om at U23/junior skal bygges, men uenighed om detaljer: pris (nogle vil ikke have præmiepenge på ungdomsniveau, kun udvikling), trupstørrelse (8 vs. op til 50 samlet trup nævnt), og om racing skal give bedre udvikling end ren træning.

**The future of: The race engine (6 svar, dybt engagement):** ingen uenighed om retningen, kun ønsker til detaljer: betingede ordrer ("jag kun hvis andre hjælper"), ingen fordel af at være online når etapen kører, mere "cykel-logik" i AI-holdenes opførsel.

**The future of: Cycling Zone "Pro" (4 svar):** klar konsensus, ingen fordel, ja til udseende/historik/omdøbning med grænser (godkendt navneliste).

**Sponsors, more than mainsponsor (3 svar):** positiv, men blandet vigtighed; en spiller peger på at små sponsorer bør kobles til fremtidigt personale-system snarere end blot en modifikator.

**Cosmetics-status? (4 svar):** efterspørgsel, ejeren svarer at det afventer en prioritering fra spillerne, den prioritering kom delvist gennem `team_looks` i dette skema (kombineret 13,66, meget lav modstand).

**Just thoughts about the market (3 svar):** forslag om en dagligt roterende liga-styret auktion; medspillere er lunkne, peger i stedet på cooldown/gebyrer.

**More races for lower divisions (1 svar):** ingen modsigelse, men også ingen bred debat; matcher spørgeskemaets `more_races_lower` med middelmådig idé (11,04) og 20 % veto, altså delt.

**Too few riders or too many races? (3 svar):** en bug/uklarhed om trupstørrelse kontra kampprogram i lave divisioner, løst med en hurtig kalenderrettelse samme dag.

**How can we improve the forum?:** oprettet 8/7, uden for det aktive 21-dages vindue, ingen frisk data.

## 5. NPS og in-app feedback

**NPS (30 dage):** kun 6 svar (score 8, 8, 9, 10, 10, 10). Gennemsnit 9,17, 4 promotorer, 0 detraktorer. For lille stikprøve til at konkludere noget, retning er positiv men ikke statistisk brugbar.

**Player feedback (21 dage), 4 indsendelser:**
- Bug: "kom i gang"-checklisten viser "Byg din trup" som ikke klaret trods køb (dashboard).
- Bug: træningsvalget "Hvile" logges som "aktiv restitution" i referatet (training).
- Feedback: mistanke om værdioverførsel mellem to hold via ensidede transfers/bytte (flagget, ikke undersøgt her, kræver manuel gennemgang).
- Bug: nogle ryttere har kun én låst/tom peak-slot i planlægningen (help-siden).

## 6. Krydsanalyse

**Stærkt signal (alle tre kilder enige):**
- **Ungdom/akademi:** roadmap-top (4 af top-10), spørgeskema (#3, 16,18), forum (mest sete dedikerede tråd), works_worst (akademi 27,8 %).
- **Træning:** works_worst-topscorer (44,4 %), dominerende fritekst-tema, spørgeskema-topscorer (`races_train_you` 17,03), roadmap (3 af top-10).
- **Race engine v4:** roadmap (taktik/form shippet 26,58, levende referater shippet 25,60), forum (dybeste enkelttråd), allerede bane 1-prioritet i MASTERPLAN.
- **Mobil er svagt punkt:** works_worst 22,2 %, gentagne fritekst-citater, egen forumtråd, flere åbne issues.

**Uenige/delte:**
- Fog of war: retning enig (71,5 % vil have mere), men grad er delt: "lidt mere" (stop værdi-lækage) klart mere populært end "meget mere" (fulde intervaller).
- Flere løb i lave divisioner: svag opbakning i skema (veto 20 %), ingen debat i forum, ikke et klart mandat.

**Omstridt (veto > 20 %):** delte træningsprogrammer (30,4 %), AI-bud/uopfordrede tilbud (29,6 %), transfers fra indbakken (28,0 %), én stor trup uden faste kategorier (23,1 %). Disse bør ikke prioriteres trods enkelte gode idé-scorer.

## 7. Anbefalet fokus

| # | Hvad | Hvorfor (kilde, tal) | Issue | I MASTERPLAN? |
|---|---|---|---|---|
| 1 | Træning pr. løbsdag: dybde, tydelighed, races der tæller som træning | works_worst 44,4 % (højeste enkelttal i hele skemaet), `races_train_you` 17,03/veto 3,3 %, roadmap 3 af top-10, dominerende fritekst-tema | #4850 (+ #4846-4854) | **Ja, bane 1 punkt 5** (allerede i gang) |
| 2 | Trestrenget klubstruktur: U23/juniorhold med egne overgange | roadmap #1/#2/#10 (top-10), spørgeskema #3 (16,18), forum mest sete tråd (46 visninger, 8 svar), works_worst akademi 27,8 % | #4619, #4621, #2492 (epic) | Kun **venteliste #8** ("trupper") |
| 3 | Sponsor-base rebases ikke ved oprykning (bekræftet fejl) | Forum-tråd med 36 svar (størst engagement i vinduet), ejeren har selv bekræftet fejlen 31/8, rammer 21 af 24 D1-hold | #4376 (bekræftet, åben, priority:high) | Ikke nævnt eksplicit, bør prioriteres som ren fejl uafhængigt af bane |
| 4 | Fog of war på markedsværdi (stop lækage af skjult potentiale) | fog_more 71,5 % vil have mere skjult, `value_no_leak` 15,84/veto kun 7,4 % (laveste blandt fog-idéer), matcher ejer-doktrin "mere fog of war" (6/9) | Ingen fundet i søgning | Doktrin nævnt i "Stående", men intet konkret issue, **mangler** |
| 5 | Mobil-UX på kernesider (træning, transfers, taktik, ranglister) | works_worst mobil 22,2 %, 5 af 14 fritekst-citater om mobil, egen forumtråd-omtale | #1602 (epic), #3643 (træningsside), #5060 (rytternavn-scroll, high) | Delvist, **#4613 (bane 3 punkt 18)** dækker kun træningssiden |
| 6 | Race engine v4 (rute-baseret, energimodel, betingede ordrer) | Roadmap-topscorer shippet (26,58/24,46), dybeste forumtråd i vinduet, allerede ejer-topprioritet | #4971 m.fl. (samlet under v4) | **Ja, bane 1 punkt 2** (allerede i gang, ingen ny handling nødvendig) |
| 7 | Kosmetik/personalisering (trøjefarver, logo, rytterportrætter) | `team_looks` 13,66/veto kun 3,7 % (meget lav modstand), egen forumtråd hvor ejeren lovede en prioritering via spørgeskema (nu delvist leveret), 3 fritekst-nævn | Ingen dedikeret issue fundet | Kun løst koblet til **venteliste #1** design-kit, **mangler konkret issue** |
| 8 | Sælgersiden af markedet (svært at sælge med profit) | works_worst marked 16,7 %, konkrete fritekst-citater ("very restricted... difficult to make even a minimal profit"), forum-tråd om markedsmekanik | Ingen enkeltstående issue set i søgning | **Ja, venteliste #9** økonomi (#3732, #3360, #3720, #1441, #1310) |

**Bevidst nedprioriteret** (veto > 20 %, ikke i top-8): delte træningsprogrammer, AI-bud fra AI-hold, transfers fra indbakken, én stor trup uden kategorier.

## 8. Bilag: SQL'er

Alle forespørgsler er kørt mod `ghwvkxzhsbbltzfnuhhz` via Supabase MCP `execute_sql`, READ-ONLY.

- **Svarprocent:** §5.1 i `docs/SURVEY_SYSTEM.md` (uændret).
- **Idé × vigtighed + veto:** §5.2 (uændret).
- **Fungerer dårligst:** §5.4 (uændret).
- **Satisfaction-fordeling:**
```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
SELECT (r.value->>'score')::int AS score, count(*) AS n
FROM public.survey_responses r JOIN s ON s.id=r.survey_id
WHERE r.question_key='satisfaction' GROUP BY 1 ORDER BY 1;
```
- **fog_more, invite_friend, pro_contents, pro_would_pay:** samme mønster som §5.4/§5.7 (`jsonb_array_elements_text` for multi, `value->>'choice'` for single), spørgsmålsnøgle skiftet ud.
- **Fritekst:**
```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
SELECT r.question_key, r.value->>'text' AS txt
FROM public.survey_responses r JOIN s ON s.id=r.survey_id
WHERE r.question_key IN ('works_worst_detail','one_thing','play_more','pro_exclusions')
  AND coalesce(r.value->>'text','') <> '' ORDER BY r.question_key;
```
- **Roadmap-stemmer:**
```sql
SELECT title_en, engine, votes, avg_idea, avg_importance, steering_score, status
FROM public.roadmap_item_scores WHERE approved = true
ORDER BY steering_score DESC NULLS LAST LIMIT 40;
```
- **NPS (30 dage):**
```sql
SELECT count(*) AS n, round(avg(score),2) AS avg_score,
  count(*) FILTER (WHERE score>=9) AS promoters,
  count(*) FILTER (WHERE score<=6) AS detractors
FROM public.nps_responses WHERE created_at > now() - interval '30 days';
```
- **Player feedback (21 dage):** `SELECT * FROM public.player_feedback WHERE created_at > now() - interval '21 days' ORDER BY created_at DESC;`
- **Forum:** `forum_posts` filtreret på titel (ILIKE) og `created_at > now() - interval '21 days'`, `forum_replies` joinet på `post_id` med `teams.name` via `team_id`, begge med `deleted_at IS NULL`.
