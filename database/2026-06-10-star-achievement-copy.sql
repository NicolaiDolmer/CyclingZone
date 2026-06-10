-- #1205: team_star + transfer_bargain refererede den afkoblede uci_points-skala
-- (#1101 cutover). Backend-definitionen er nu market_value-baseret
-- (STAR_RIDER_MARKET_VALUE = 5.000.000 i economyConstants.js) — copy følger med.
-- Player-facing copy ejes af locales/en+da/achievements.json (i18n-first);
-- DB-værdien her er den kanoniske EN-fallback (jf. ManagerProfilePage.jsx).
-- NB: ingen apostroffer i strenge (auto-migrate, #635).

UPDATE achievements
SET title = 'Star team',
    description = 'Have a star rider on your team: a rider valued at 5,000,000 CZ$ or more.'
WHERE id = 'team_star';

UPDATE achievements
SET title = 'The Steal',
    description = 'Buy a rider for less than half his value.'
WHERE id = 'transfer_bargain';
