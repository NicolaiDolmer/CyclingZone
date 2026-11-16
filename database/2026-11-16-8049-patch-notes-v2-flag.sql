-- #8049: den nye patch notes-side (efter område, uge for uge, arkiv pr. måned,
-- "Nyt siden sidst" husket på brugeren via seen_markers fra #6515).
--
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er applied.
-- off = den gamle side uændret. beta = ny side for indloggede beta-testere.
-- on = ny side for alle, også udloggede besøgende. Ejeren flytter flaget fra admin-fladen.
--
-- Rent visning: flaget læses af GET /api/feature-flags. Motoren læser det ikke.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'patch_notes_v2_8049',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the new patch notes page (#8049): week by week, grouped by area, monthly archive loaded on demand, "new since your last visit" kept on the user. Display only.'
)
ON CONFLICT (key) DO NOTHING;
