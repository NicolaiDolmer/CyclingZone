# Spørgeskema-systemet (SSOT)

> Bygget i #4943 efter ejer-beslutning 7/9: skemaet bygges **i spillet**, ikke i
> Google Forms. Indholdet kommer fra `docs/discord/2026-09-07-spoergeskema-spillere-v2.md`.
> Migration: `database/2026-09-07-4943-in-app-survey.sql`.

## 1. Delene

| Del | Hvor |
|---|---|
| Tabeller + seed | `database/2026-09-07-4943-in-app-survey.sql` |
| Side `/survey/:slug` | `frontend/src/pages/SurveyPage.jsx` (T1, max-w-4xl) |
| Kontrollerne | `frontend/src/components/survey/SurveyQuestion.jsx` |
| Ren logik + tests | `frontend/src/lib/survey.js` + `survey.test.js` |
| i18n (sidens chrome) | `frontend/public/locales/{en,da}/survey.json` |
| Dashboard-kort | `frontend/src/components/SurveyInviteCard.jsx` |
| Indbakke-udsendelse | `backend/scripts/sendSurveyInvite.mjs` |

Spørgsmålenes egen tekst ligger **i databasen** (`label_en`/`label_da`), ikke i
i18n-filerne: et skema er redaktionelt indhold med en levetid, ikke UI-chrome.
Kun sidens rammer (knapper, sektionsnavne, skala-etiketter) er i18n.

## 2. Livscyklus

`draft` → `open` → `closed`. RLS: kladder er admin-only, `open` og `closed` er
læsbare for indloggede, men **spørgsmålene** er kun læsbare mens skemaet er
`open`, så et lukket skema hverken kan besvares eller læses igennem. Svar kan
kun skrives mens skemaet er `open`; upsert på
`survey_responses_survey_user_question_uniq` gør at en spiller kan rette indtil
det lukker.

```sql
-- Åbn (ejer-go kræves)
UPDATE public.surveys SET status = 'open', opens_at = NOW(), updated_at = NOW()
 WHERE slug = '2026-09-features';
-- Luk
UPDATE public.surveys SET status = 'closed', closes_at = NOW(), updated_at = NOW()
 WHERE slug = '2026-09-features';
```

Udsendelse (kræver ejerens ordrette "kør", køres af orkestratoren):

```bash
node backend/scripts/sendSurveyInvite.mjs --survey 2026-09-features --dry-run
node backend/scripts/sendSurveyInvite.mjs --survey 2026-09-features --apply
```

## 3. Segmentering: join-nøglerne

Skemaet spørger **ikke** om division, sæsoner, hyppighed, Pro eller sprog
(v2-udkastets Q1-Q6). Det står allerede i databasen. **Join på
`survey_responses.team_id`, ikke på `user_id`,** når segmentet hænger på holdet:
et join på bruger duplikerer hvert svar én gang pr. hold manageren ejer.
`user_id` er den rigtige nøgle til de segmenter der hænger på kontoen (sprog,
login-hyppighed, anciennitet).

| Segment | Kilde | Nøgle |
|---|---|---|
| Division (1-4) | `teams.division` | `teams.id = survey_responses.team_id` |
| Liga-gruppe | `teams.league_division_id` | samme |
| Sæsoner spillet | `count(DISTINCT season_standings.season_id)` | `season_standings.team_id = teams.id` |
| Pro | `subscriptions.status = 'active'` | `subscriptions.team_id = teams.id` |
| Founder | `subscriptions.is_founder` | samme |
| Login-hyppighed | `users.login_streak`, `users.last_seen`, `users.last_login_date` | `users.id = survey_responses.user_id` |
| Sprog | `users.language` (`en`/`da`), fallback `users.browser_language` | samme |
| Anciennitet | `users.created_at`, `teams.created_at` | samme |

`survey_responses.team_id` er et øjebliksbillede taget da svaret blev gemt, så
et svar kan stadig placeres hvis holdet senere skifter ejer eller nedlægges.

**Findes ikke i databasen:** platform (telefon/computer). v2s Q5 er droppet
uden erstatning. Skal den krydses, kommer tallet fra Clarity/GA, ikke herfra.

## 4. Værdi-former i `survey_responses.value`

| `kind` | JSONB |
|---|---|
| `scale_1_5`, `scale_0_10` | `{"score": 4}` |
| `idea_importance` | `{"ratings": {"live_race": {"idea": 5, "importance": 4, "dont_know": false}}}` |
| `multi_max3`, `multi` | `{"selected": ["racing", "training"]}` |
| `single`, `yes_no` | `{"choice": "yes"}` |
| `text` | `{"text": "..."}` |

"Ved ikke" er sit eget felt (`dont_know: true`, begge akser `null`), fordi
`null` alene ikke kan skelnes fra "ikke besvaret". Kun funktioner spilleren har
rørt står i `ratings`.

## 5. Analyse: fem færdige forespørgsler

Køres af Claude via Supabase MCP (`SELECT` er nok, ingen skrivning). Byt slug
ud hvis der kommer et nyt skema.

### 5.1 Svarprocent

```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features'),
eligible AS (
  -- DISTINCT user_id, ikke count(*): invitationen sendes pr. BRUGER, og en
  -- manager med to hold kan kun gennemfoere een gang.
  SELECT count(DISTINCT user_id) AS n FROM public.teams
   WHERE is_ai = false AND is_test_account = false AND is_bank = false AND user_id IS NOT NULL
)
SELECT (SELECT n FROM eligible) AS eligible_managers,
       (SELECT count(DISTINCT r.user_id) FROM public.survey_responses r JOIN s ON s.id = r.survey_id) AS started,
       (SELECT count(*) FROM public.survey_completions c JOIN s ON s.id = c.survey_id) AS completed,
       round(100.0 * (SELECT count(*) FROM public.survey_completions c JOIN s ON s.id = c.survey_id)
             / NULLIF((SELECT n FROM eligible), 0), 1) AS completion_pct,
       (SELECT round(avg(seconds_spent) / 60.0, 1) FROM public.survey_completions c JOIN s ON s.id = c.survey_id) AS avg_minutes;
```

### 5.2 Idé x vigtighed pr. funktion, med veto-andel

Veto-andelen er andelen der gav 1 eller 2 på idé-aksen. Over 25 % er
funktionen omstridt, uanset hvor pænt gennemsnittet ser ud (v2-udkastet §4).

```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features'),
r AS (
  SELECT rt.key AS feature,
         COALESCE((rt.value->>'dont_know')::boolean, false) AS dont_know,
         (rt.value->>'idea')::int AS idea,
         (rt.value->>'importance')::int AS importance
    FROM public.survey_responses resp
    JOIN s ON s.id = resp.survey_id
    CROSS JOIN LATERAL jsonb_each(resp.value->'ratings') AS rt(key, value)
   WHERE resp.question_key = 'feature_axes'
)
SELECT feature,
       count(*) FILTER (WHERE NOT dont_know)                       AS rated,
       count(*) FILTER (WHERE dont_know)                           AS dont_know,
       round(avg(idea) FILTER (WHERE NOT dont_know), 2)            AS avg_idea,
       round(avg(importance) FILTER (WHERE NOT dont_know), 2)      AS avg_importance,
       round(avg(idea) FILTER (WHERE NOT dont_know)
           * avg(importance) FILTER (WHERE NOT dont_know), 2)      AS combined,
       round(100.0 * count(*) FILTER (WHERE NOT dont_know AND idea <= 2)
           / NULLIF(count(*) FILTER (WHERE NOT dont_know), 0), 1)  AS veto_pct
  FROM r
 GROUP BY feature
 ORDER BY combined DESC NULLS LAST;
```

### 5.3 NPS-fordeling

```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features'),
n AS (
  SELECT (r.value->>'score')::int AS score
    FROM public.survey_responses r JOIN s ON s.id = r.survey_id
   WHERE r.question_key = 'nps'
)
SELECT count(*)                                        AS answers,
       count(*) FILTER (WHERE score >= 9)              AS promoters,
       count(*) FILTER (WHERE score BETWEEN 7 AND 8)   AS passives,
       count(*) FILTER (WHERE score <= 6)              AS detractors,
       round(100.0 * (count(*) FILTER (WHERE score >= 9) - count(*) FILTER (WHERE score <= 6))
             / NULLIF(count(*), 0), 1)                 AS nps,
       round(avg(score), 2)                            AS avg_score
  FROM n;
```

### 5.4 Hvad fungerer dårligst i dag

```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features')
SELECT area, count(*) AS picks,
       round(100.0 * count(*) / NULLIF((SELECT count(DISTINCT r2.user_id)
             FROM public.survey_responses r2 JOIN s ON s.id = r2.survey_id
            WHERE r2.question_key = 'works_worst'), 0), 1) AS pct_of_answerers
  FROM public.survey_responses r
  JOIN s ON s.id = r.survey_id
  CROSS JOIN LATERAL jsonb_array_elements_text(r.value->'selected') AS area
 WHERE r.question_key = 'works_worst'
 GROUP BY area
 ORDER BY picks DESC;
```

### 5.5 Krydsning pr. division og Pro

```sql
WITH s AS (SELECT id FROM public.surveys WHERE slug = '2026-09-features'),
seg AS (
  -- Join paa team_id (svarets egen oejebliks-kopi), ikke paa user_id: et join
  -- paa bruger duplikerer hvert svar én gang pr. hold manageren ejer og kan
  -- placere det samme svar i to divisioner.
  SELECT t.id AS team_id,
         t.division,
         EXISTS (SELECT 1 FROM public.subscriptions sub
                  WHERE sub.team_id = t.id AND sub.status = 'active') AS is_pro
    FROM public.teams t
   WHERE t.is_ai = false AND t.is_test_account = false AND t.is_bank = false AND t.user_id IS NOT NULL
),
rated AS (
  SELECT seg.division, seg.is_pro, rt.key AS feature,
         (rt.value->>'idea')::int AS idea,
         (rt.value->>'importance')::int AS importance
    FROM public.survey_responses resp
    JOIN s ON s.id = resp.survey_id
    JOIN seg ON seg.team_id = resp.team_id
    CROSS JOIN LATERAL jsonb_each(resp.value->'ratings') AS rt(key, value)
   WHERE resp.question_key = 'feature_axes'
     AND COALESCE((rt.value->>'dont_know')::boolean, false) = false
)
SELECT division, is_pro, feature,
       count(*)                       AS rated,
       round(avg(idea), 2)            AS avg_idea,
       round(avg(importance), 2)      AS avg_importance
  FROM rated
 GROUP BY division, is_pro, feature
HAVING count(*) >= 3   -- under 3 svar er støj, ikke et segment
 ORDER BY division, is_pro, avg_importance DESC;
```

Byt `seg.division` ud med et af de andre segmenter fra §3 (sæsoner, sprog,
`login_streak`) for de øvrige krydsninger; strukturen er den samme.
