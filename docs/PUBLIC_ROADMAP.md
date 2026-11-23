# Public roadmap

Den offentlige roadmap bor i spillet: **https://cyclingzone.org/roadmap** (data i `roadmap_items`, admin-redigeret). Ejeren opdaterer den selv og annoncerer ændringer i #the-roadbook på Discord.

Denne fil var en pre-launch-liste fra før sæson 1 og er forældet; historikken ligger i git-loggen. Planlægning for AI-sessioner: [`MASTERPLAN.md`](MASTERPLAN.md) (rækkefølge) og [`GAME_DESIGN_DOCUMENT.md`](GAME_DESIGN_DOCUMENT.md) (intention).

## Fælles kategorier og tid

Admin og den offentlige roadmap bruger den samme taksonomi. roadmap_items.category
er nøglen, og frontend/src/lib/roadmapCategories.ts indeholder nøglerne og navnene på
dansk og engelsk. Vækst er intern. Spillernes hentning udelukker kategorien,
og RLS begrænser direkte læsning til admin. Engine beholdes til ældre rækker,
og migrationen gemmer tidligere kategorier, når den ændrer en nøgle.

En plan kræver ejerens ja, et issue med afgrænset leverance og et aftalt
tidspunkt. Admin registrerer issue og tidspunkt. Tidspunktet gemmes som ISO-uge
(2026-W49), dato (2026-11-30) eller en aftalt sæson- eller kvartalsmilepæl
(season_6_start, season_6, q1_2027). Ældre rullende uger beholdes i
databasen til gennemgang af den oprindelige aftale. Spillersiden afleder ingen
dato for dem. Registry-sync og split uden et eksplicit planvalg opretter skjulte
idéer. Aktivt arbejde, beta og leveret følger den eksisterende statusmodel.

[Ejerbeslutninger 23/11](https://github.com/NicolaiDolmer/CyclingZone/issues/8584#issuecomment-7094754650)
· [Planreglen](https://github.com/NicolaiDolmer/CyclingZone/issues/8584#issuecomment-7094794872)
