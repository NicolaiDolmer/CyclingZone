-- #1210: STAR_RIDER_MARKET_VALUE re-kalibreret 5M -> 8M mod den fiktive
-- launch-population (ejer valgte A: 8M = superstjerne-baandets graense, 1,5%).
-- Player-facing copy ejes af locales/en+da/achievements.json (i18n-first);
-- DB-vaerdien her er den kanoniske EN-fallback (jf. ManagerProfilePage.jsx).
-- NB: ingen apostroffer i strenge (auto-migrate, #635).

UPDATE achievements
SET description = 'Have a star rider on your team: a rider valued at 8,000,000 CZ$ or more.'
WHERE id = 'team_star';
