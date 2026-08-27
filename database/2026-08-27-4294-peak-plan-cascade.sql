-- #4294 — en peak-plan skal dø sammen med sit målløb.
--
-- ROD-ÅRSAG. `rider_peak_plans` gemmer BÅDE et anker (`target_race_id`) og et
-- AFLEDT resultat (`window_start`/`window_end`, snappet om målløbets etapedatoer
-- af snapPeakWindow). Kun ankeret havde en FK, og den var ON DELETE SET NULL.
-- Da kalender-regenereringen slettede sæson 3's races (de nye løb er skrevet
-- 26/8 kl. 23:38 CEST), nulstillede FK'en derfor ankeret mens vinduet blev
-- stående med den GAMLE kalenders datoer.
--
-- Målt i prod 27/8 før reparationen: 812 af 894 planer i S3 uden målløb, 731 med
-- vinduer der overlappede den NYE kalender, 490 ryttere ramt. På åbningsdagen
-- 28/8 dækkede 280 af de forældreløse vinduer dagen. Det er 274 distinkte
-- ryttere, heraf 272 på 27 menneskehold, som altså ville have stået i et peak ingen
-- spiller havde valgt eller kunne se. 316 af planerne på menneskehold var
-- allerede låst (`isPlanLocked` ser kun på `window_start`), så spilleren kunne
-- ikke fjerne dem.
-- Motoren filtrerede ikke på `target_race_id`, så vinduerne ville have fyret:
-- `race_engine_v3_scoring` og `peak_planner_enabled` er begge `on` i prod.
--
-- DATAEN ER ALLEREDE REPARERET (ejer-GO 27/8, backup `backup_4294_rider_peak_plans`,
-- 812 rækker slettet, post-verify: 82 planer tilbage, alle med gyldigt målløb).
-- Denne migration fjerner KILDEN, så det ikke kan ske igen.
--
-- HVORFOR CASCADE OG IKKE SET NULL. En plan uden sit målløb er meningsløs i alle
-- tre lag: UI'et viser den som "No peak" (der er intet mål at vise i select'en),
-- fjern-knappen er deaktiveret når vinduet er begyndt, og motoren scorer den
-- alligevel. De to øvrige FK'er på tabellen (`rider_id`, `season_id`) er allerede
-- ON DELETE CASCADE. Denne bringer den tredje i overensstemmelse.
--
-- OM KOMMENTAREN I 2026-07-13-rider-peak-plans.sql:14 ("target_race_id bevares
-- til UI (race-fokus) + story-tag `perfect_peak` (S6)"): CASCADE ændrer intet for
-- den brug. Feltet bevares stadig og peger stadig på løbet. Forskellen er kun hvad
-- der sker når løbet SLETTES, og et slettet løb kan ikke bære et `perfect_peak`.
--
-- DESTRUKTIV? Nej. Ingen DROP/DELETE/UPDATE af data. Migrationen ændrer kun
-- fremtidig sletnings-adfærd. Idempotent: kan køres flere gange.
--
-- FORWARD-GUARD I KODEN (samme PR): `loadPeakPlans` og `raceCardPeakOverlay`
-- udelader planer uden målløb, så motoren har en fail-safe selv hvis en fremtidig
-- skrivevej finder på at efterlade en. Efter denne migration er det en vagt uden
-- arbejde, og det er den rigtige tilstand.

begin;

alter table public.rider_peak_plans
  drop constraint if exists rider_peak_plans_target_race_id_fkey;

alter table public.rider_peak_plans
  add constraint rider_peak_plans_target_race_id_fkey
  foreign key (target_race_id) references public.races(id) on delete cascade;

commit;

-- POST-VERIFY (read-only, kør efter apply):
--
--   select pg_get_constraintdef(con.oid) as definition
--     from pg_constraint con
--     join pg_class rel on rel.oid = con.conrelid
--     join pg_namespace ns on ns.oid = rel.relnamespace
--    where ns.nspname = 'public'
--      and rel.relname = 'rider_peak_plans'
--      and con.conname = 'rider_peak_plans_target_race_id_fkey';
--
--   Forventet: FOREIGN KEY (target_race_id) REFERENCES races(id) ON DELETE CASCADE
--
--   select count(*) as skal_vaere_nul
--     from public.rider_peak_plans
--    where target_race_id is null;
--
--   Forventet: 0
