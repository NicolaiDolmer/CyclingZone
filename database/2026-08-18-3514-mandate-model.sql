-- #3514 fase 1a. "Mandatet": datamodel for én tillid, ét årligt mandat, vision som tidslinje.
-- Spec (GODKENDT af ejer 7/8): docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md
-- Plan: docs/slices/09-board-mandate-rework-MASTER.md
-- Drejebog for cutoveren: docs/2026-08-23-cutover-drejebog.md (komponent 4)
--
-- ======================================================================
-- DENNE MIGRATION ER INERT. Den flytter INGEN spillerdata.
-- ======================================================================
-- Den opretter tre TOMME tabeller + én kill-switch der seedes til 'off'.
-- Ingen eksisterende tabel røres: `board_profiles`, `board_satisfaction_events`,
-- `board_consequences`, `team_board_members` er urørte. Så længe flaget er 'off'
-- læser og skriver INGEN kodesti disse tabeller, og appen opfører sig bit-for-bit
-- som i dag.
--
-- Selve BACKFILLEN (1-års-mål → mandat, 3/5-års-mål → visions-milepæle, confidence
-- = 50/30/20-vægtet snit) ligger IKKE her. Den er et separat, ejer-gated script:
--   backend/scripts/dev/mandateMigration3514.mjs   (dry-run er default)
-- Grunden: database/2026-*.sql auto-applies ved merge, og en population-mutation
-- må aldrig auto-applies. Backfillen køres 23/8 efter ejer-go, med scorecard først.
--
-- Idempotent: `create table if not exists` + `on conflict do nothing`. Kan køres igen.
-- Rollback: se docs/2026-08-23-cutover-drejebog.md komponent 4 (flag → 'off' er nok;
-- tabellerne kan stå tomme/urørte uden effekt).

-- ----------------------------------------------------------------------
-- 1. Bestyrelsesrelationen: ÉT tillidstal pr. hold (spec §3.1)
-- ----------------------------------------------------------------------
-- Erstatter de 3 parallelle `board_profiles.satisfaction`-værdier, som er
-- rod-årsagen bag mindst 8 tæller-mismatch-fejl siden maj (#2469→#2592→#2596,
-- #3095, #3141, #3144, #3494). Én række pr. hold, aldrig flere.

create table if not exists public.board_relations (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null unique references public.teams(id) on delete cascade,
  confidence        integer not null default 50 check (confidence between 0 and 100),
  -- 4 kategoriscorer 0-100 (results/economy/identity/ranking). Samme kategorier og
  -- vægte som boardConstants.BASE_CATEGORY_WEIGHTS, motoren genbruges, kun
  -- lagringen er ny.
  category_scores   jsonb not null default '{}'::jsonb,
  -- Kvittering for tallet selv (spec §2 "kvittering for alt"): hvor kom confidence
  -- fra, hvilke input, hvilke vægte. Migrationen skriver {method:'migration_v1',...}.
  confidence_source jsonb not null default '{}'::jsonb,
  -- Tillids-trappen (spec §3.2 / beslutning 6) aflæses af motoren ud fra confidence;
  -- feltet her er den SIDST tildelte værdi på et underskrevet mandat, til kvittering.
  last_event_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.board_relations is
  '#3514 "Mandatet": ÉT tillidstal (confidence 0-100) pr. hold, erstatter de 3 parallelle board_profiles.satisfaction. category_scores = results/economy/identity/ranking 0-100. confidence_source = kvittering for hvordan tallet opstod. Tom indtil mandateMigration3514.mjs køres (ejer-gated).';

comment on column public.board_relations.confidence_source is
  '#3514: kvittering for confidence-tallet. Migrationen skriver {method:"migration_v1", weights:{"1yr":0.5,"3yr":0.3,"5yr":0.2}, inputs:{...}, migrated_at:...}. Motoren skriver {method:"weekend_update"|"milestone"|"mandate_signed", ...}.';

-- ----------------------------------------------------------------------
-- 2. Mandatet: 1-årigt, 3-5 mål, forhandlet på årsmødet (spec §3.1/§3.2)
-- ----------------------------------------------------------------------

create table if not exists public.board_mandates (
  id                    uuid primary key default gen_random_uuid(),
  team_id               uuid not null references public.teams(id) on delete cascade,
  season_id             uuid references public.seasons(id) on delete set null,
  season_number         integer,
  -- draft = genereret men ikke vist; proposed = ligger på årsmødet og venter;
  -- active = underskrevet og gældende; completed = evalueret ved sæsonslut;
  -- lapsed = auto-accepteret/udløbet uden underskrift.
  status                text not null default 'draft'
                          check (status in ('draft','proposed','active','completed','lapsed')),
  focus                 text,
  goals                 jsonb not null default '[]'::jsonb,
  -- Tillids-trappen (beslutning 6): <30 → 1 justering, 30-74 → 2, ≥75 → 3.
  -- Skrives ved forhandlingens start, så trappen der GJALDT er bevaret som kvittering
  -- selv hvis confidence flytter sig undervejs.
  adjustments_allowed   integer not null default 2 check (adjustments_allowed between 0 and 5),
  adjustments_used      integer not null default 0 check (adjustments_used >= 0),
  -- 1 anmodning på årsmødet + 1 ekstraordinær der låses op ved mid-season check-in
  -- (beslutning 5).
  request_used          boolean not null default false,
  extraordinary_request_unlocked boolean not null default false,
  extraordinary_request_used     boolean not null default false,
  proposed_at           timestamptz,
  signed_at             timestamptz,
  -- Auto-accept-fallback efter 5 kalenderdage (spec §3.2). Cron aflæser STATUS her,
  -- ikke et window-felt, det var rod-årsagen bag #3502.
  auto_accept_deadline  timestamptz,
  source                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.board_mandates is
  '#3514 "Mandatet": ét 1-årigt mandat pr. hold pr. sæson (3-5 mål), forhandlet på årsmødet. Erstatter board_profiles-rækkernes 1yr-plan + wizard-forhandlingen. adjustments_allowed sættes af tillids-trappen ved forhandlingens start og bevares som kvittering.';

-- Ét mandat pr. hold pr. sæson.
--
-- BEVIDST IKKE partial (`where season_id is not null`): Postgres behandler i
-- forvejen NULL som forskellig fra NULL i en unique-nøgle, så drafts uden sæson
-- blokerer alligevel ikke hinanden, OG en partial unique kan ikke bruges som
-- ON CONFLICT-mål af PostgREST's upsert. Det fejlede i staging-dry-runnet 17/8
-- ("there is no unique or exclusion constraint matching the ON CONFLICT
-- specification"), hvilket er præcis den slags fejl et dry-run findes for.
create unique index if not exists uq_board_mandates_team_season
  on public.board_mandates (team_id, season_id);

-- Årsmøde-cron'ens opslag: "hvilke mandater venter på underskrift og er løbet tør?"
create index if not exists idx_board_mandates_pending_deadline
  on public.board_mandates (status, auto_accept_deadline)
  where status = 'proposed';

-- ----------------------------------------------------------------------
-- 3. Visionen: 3/5-års-målene som milepæle på en tidslinje (spec §3.1)
-- ----------------------------------------------------------------------
-- Grandfathering-princippet fra #1234: en milepæl beholder sin OPRINDELIGE
-- slut-sæson fra den plan den kom fra. Ingen bliver forringet retroaktivt.

create table if not exists public.board_vision_milestones (
  id                   uuid primary key default gen_random_uuid(),
  team_id              uuid not null references public.teams(id) on delete cascade,
  -- Stabil nøgle pr. hold, så en milepæl kan gen-findes uden at afhænge af rækkefølge.
  milestone_key        text not null,
  goal                 jsonb not null default '{}'::jsonb,
  target_season_number integer not null,
  -- '3yr' | '5yr' | 'mandate_promotion' (sidstnævnte reserveret til senere faser)
  origin               text not null default '3yr',
  weight               numeric(4,2) not null default 1.00,
  -- Fase 2's tidslinje viser headline-milepæle stort og folder resten sammen.
  -- Reglen er ren og ligger i backend/lib/boardMandate.js (isHeadlineMilestone).
  is_headline          boolean not null default false,
  status               text not null default 'pending'
                         check (status in ('pending','achieved','missed')),
  evaluated_at         timestamptz,
  -- Engangs-tillidsslaget ved misset milepæl (beslutning 3), gemmes så kvitteringen
  -- kan vise præcis hvad milepælen kostede. Ingen kaskade ind i næste mandat.
  confidence_delta     integer,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.board_vision_milestones is
  '#3514 "Mandatet": klubvisionen som milepæls-tidslinje. Hver milepæl kommer fra et 3- eller 5-års-mål og BEHOLDER sin oprindelige slut-sæson (grandfathering, #1234). Evalueres i sin mål-sæson: misset = ét synligt engangs-tillidsslag (confidence_delta), aldrig en kaskade.';

create unique index if not exists uq_board_vision_milestones_team_key
  on public.board_vision_milestones (team_id, milestone_key);

-- Sæson-evalueringens opslag: "hvilke milepæle forfalder i denne sæson?"
create index if not exists idx_board_vision_milestones_due
  on public.board_vision_milestones (target_season_number, status)
  where status = 'pending';

-- ----------------------------------------------------------------------
-- 3b. Kvitterings-feedet: ÉN strøm, ikke to (spec §2)
-- ----------------------------------------------------------------------
-- Specen siger eksplicit at kvitteringerne "genbruger board_satisfaction_events".
-- Det kræver to justeringer af den eksisterende tabel, fordi den i dag antager at
-- enhver hændelse tilhører en `board_profiles`-række:
--
--   a) `board_id` gøres NULLABLE. Mandat-modellens hændelser hører til holdets
--      relation, ikke til en plan-række. At LØSNE en not-null er bagudkompatibelt:
--      ingen eksisterende række bliver ugyldig, og ingen eksisterende skriver
--      udelader feltet. Migrations-kvitteringen ("Board model updated") peger dog
--      stadig på 1-års-boardet, så sporet tilbage til den gamle model bevares.
--   b) To nullable FK'er så en kvittering kan pege på det mandat eller den milepæl
--      der flyttede tallet. Uden dem ville fase 2 ikke kunne vise HVAD der skete,
--      og "kvittering for alt" ville være en påstand, ikke en funktion.
--
-- Alternativet (en ny events-tabel) ville genskabe præcis den duplikering
-- reworket findes for at fjerne: to kilder til samme historik.

alter table public.board_satisfaction_events alter column board_id drop not null;

alter table public.board_satisfaction_events
  add column if not exists mandate_id uuid references public.board_mandates(id) on delete set null;

alter table public.board_satisfaction_events
  add column if not exists milestone_id uuid references public.board_vision_milestones(id) on delete set null;

comment on column public.board_satisfaction_events.board_id is
  '#3514: nullable siden mandat-modellen. NULL = hændelsen hører til holdets board_relations-række (mandat-modellen), ikke til en enkelt board_profiles-plan. Migrations-kvitteringen peger stadig på 1-års-boardet.';

-- ----------------------------------------------------------------------
-- 4. RLS: service-role-only (samme mønster som training_slot_health_daily)
-- ----------------------------------------------------------------------
-- Bestyrelsesdata læses af spilleren gennem backendens API med service-nøglen,
-- aldrig direkte fra klienten. RLS slås til UDEN policies → ingen anon/authenticated-
-- adgang overhovedet. Det matcher hvordan board_profiles allerede eksponeres.

alter table public.board_relations         enable row level security;
alter table public.board_mandates          enable row level security;
alter table public.board_vision_milestones enable row level security;

-- ----------------------------------------------------------------------
-- 5. Kill-switch: seedet til 'off' (spec §"Fase 1 bag kill-switch")
-- ----------------------------------------------------------------------
-- off (default)  = bit-for-bit nuværende adfærd. board_profiles er sandheden,
--                  de 3 satisfaction-tal vises som i dag, de nye tabeller er døde.
-- beta           = kun beta-testere læser mandat-modellen (samme tre-tilstands-
--                  mønster som race_day_engine_enabled; ejer-politik er dog at
--                  flippe for alle, kill-switchen er rollback, ikke beta-gate).
-- on             = mandat-modellen er sandheden.
--
-- Flippet 23/8 er EJER-GATET og køres manuelt efter backfillen er verificeret:
--   update public.app_config set value = '"on"'::jsonb  where key = 'board_mandate_model_enabled';
--   update public.app_config set value = '"off"'::jsonb where key = 'board_mandate_model_enabled';  -- rollback

insert into public.app_config (key, value, description) values
  ('board_mandate_model_enabled', '"off"'::jsonb,
   '#3514 "Mandatet": kill-switch for bestyrelsens mandat-model (ét confidence-tal i board_relations + board_mandates + board_vision_milestones). off|beta|on. off (default) = board_profiles og de 3 satisfaction-tal er stadig sandheden, og de nye tabeller læses ikke. Flip er ejer-gated og forudsætter at mandateMigration3514.mjs er kørt med --apply. Rollback = sæt tilbage til off.')
on conflict (key) do nothing;
