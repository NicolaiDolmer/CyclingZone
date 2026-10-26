-- #6853 / #5764 (løsning B, ejer-go 24/10) — potentialet vises for rollen med
-- det højeste potentiale, med en typeboks ved tallet, på alle flader.
--
-- `potential_single_number` er paraply-flaget for potentiale-visningen i
-- Udvikling 2.0 (spec docs/superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md §8).
-- Startstadiet er `off`: ingen spiller ser en ændring, når migrationen er
-- applied. Flaget tændes samlet med resten af Udvikling 2.0 (ejer-only).
--
-- Evalueres af backend/lib/potentialDisplayBand.js via evaluateFlagStage
-- (off | beta | on). `beta` = kun beta-testere/admin ser den nye visning.
-- Rent visning: ingen motor eller værdi læser flaget.
--
-- Idempotent (ON CONFLICT DO NOTHING): kan replayes uden at overskrive et
-- stadie ejeren allerede har flyttet.

INSERT INTO public.app_config (key, value, description)
VALUES (
  'potential_single_number',
  '"off"'::jsonb,
  'Stage flag (off|beta|on) for the Development 2.0 potential display (#6853, #5764, spec 6110 section 8): potential shows the role with the highest potential, with a small role box next to the number, on every surface. Display only. Flips together with the rest of Development 2.0.'
)
ON CONFLICT (key) DO NOTHING;
