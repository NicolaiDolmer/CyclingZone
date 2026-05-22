-- #517: P0 lockdown for discord_settings
--
-- Pre-state (verificeret 2026-05-22 via pg_policies):
--   - "Public read discord_settings" SELECT USING (true) ← LEAK: anon kan læse webhook_url
--   - "Admin only discord_settings" ALL USING (auth.uid() IN admin-set)
--
-- Post-state: kun admin-policy. Backend (service_role) bypasser RLS, så
-- discordNotifier.js + nye /api/admin/discord-settings-routes virker uændret.
--
-- Idempotent: bruger DROP IF EXISTS så replay i staging/branches er safe.

DROP POLICY IF EXISTS "Public read discord_settings" ON discord_settings;

-- Sanity-check: behold admin-policy. Hvis den mangler (manual cleanup gået skævt)
-- skal vi NOT auto-recreate her — det er en separat policy-decision. Verificér i
-- post-migration check at admin-policy stadig er der.
