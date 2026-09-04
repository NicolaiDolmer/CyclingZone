-- #3514 fase 1-rest: data-krog til A7 (ejer-valg 1/9, addendum §A7).
-- ============================================================================
-- En visions-milepæl der bliver opfyldt FØR sin mål-sæson skal fejres straks
-- (confidence + formandsbeat i selve øjeblikket) og lukkes MED SAMME, i stedet
-- for at vente til sin oprindelige mål-sæson. Addendum §A7 kalder det en
-- bevidst genåbning af spec §3.1's "evalueres i mål-sæsonen" for netop denne
-- ene situation.
--
-- Denne migration lægger KUN data-krogen. Selve "foreslå ny milepæl ved næste
-- årsmøde"-flowet er fase 2-UI og bygges ikke her (addendum: "læg kun data-
-- krogen, byg ikke forslags-flowet").
--
--   achieved_early — sand når milepælen blev lukket FØR sin target_season_number
--                    (adskiller den fra en almindelig rettidig achieved-lukning
--                    i kvitteringsfeedet/UI'en).
--   slot_open      — sand når en tidligt lukket milepæl har efterladt et tomt
--                     slot på visionens tidslinje. Fase 2's årsmøde-UI læser
--                     dette felt for at vide hvilke hold der skal tilbydes en
--                     erstatningsmilepæl. Ryddes (sat false) af fase 2-flowet
--                     når erstatningen er foreslået — ikke bygget her.
--
-- INERT: begge kolonner default false, ingen eksisterende række ændrer værdi.
-- Kill-switchen (board_mandate_model_enabled) er stadig 'off' — se
-- database/2026-08-18-3514-mandate-model.sql. Idempotent (add column if not
-- exists), ingen population rammes.

alter table public.board_vision_milestones
  add column if not exists achieved_early boolean not null default false;

alter table public.board_vision_milestones
  add column if not exists slot_open boolean not null default false;

comment on column public.board_vision_milestones.achieved_early is
  '#3514 addendum A7 (ejer-valg 1/9): sand når milepælen blev opfyldt og lukket FØR sin target_season_number ("fejr straks + fyld op"). Skrives af boardMandateEngine.evaluateEarlyMilestones via applySeasonEndSync.';

comment on column public.board_vision_milestones.slot_open is
  '#3514 addendum A7: sand når en tidligt lukket milepæl har efterladt et tomt slot på visionens tidslinje. Data-krog for fase 2''s årsmøde-UI ("bestyrelsen foreslår en NY milepæl i det tomme slot") — forslags-flowet er ikke bygget her.';
