# 2026-06-11 — #517-hærdning stille rullet tilbage af tab-refactor (fundet i #1180-audit)

## Symptom

Live admin-UI (`pages/admin/AdminSystemTab.jsx`) lavede direkte supabase-CRUD på
`discord_settings` inkl. rå `webhook_url` fra klienten — selvom #517 havde flyttet
ejerskabet til hærdede backend-routes med server-side maskering (2026-05-22).

## Rod-årsag

#529-tab-refactoren splittede `AdminPage.jsx` (2.077 linjer) i 5 tab-filer, men
tog udgangspunkt i den GAMLE pre-#517-kode for webhook-sektionen. Den hærdede
version levede kun videre i den originale `AdminPage.jsx` — som samtidig blev
af-routet og dermed død kode. Resultat: hærdningen kørte aldrig i den UI brugeren
faktisk fik, og ingen test fejlede, fordi #517 ikke efterlod nogen source-guard
på den routede fil.

## Fix

PR (Refs #1180): AdminSystemTab re-pointet til `/api/admin/discord-settings`-routes
(list maskeret · POST · PATCH :id/default · DELETE :id · POST :id/test via gemt URL),
`AdminPage.jsx` slettet, den rå-URL-modtagende `POST /admin/discord/test`-route fjernet.

## Forward-guard

`backend/lib/discordSettingsAdminRoutes.test.js` scanner **hele frontend/src**
(ikke én navngiven fil) for `supabase.from("discord_settings")` + asserter
route-gating, server-side maskering og at rå-URL-routen ikke genopstår.

## Lektioner

1. **Hærdnings-/kontrakt-guards skal scanne træet, ikke pege på én fil.** En guard
   bundet til ét filnavn overlever ikke en refactor der flytter koden — scan
   `frontend/src` rekursivt for det forbudte mønster (jf. `raceEditAdminRoute.test.js`,
   der pegede på AdminPage.jsx og måtte re-pointes i samme PR).
2. **Ved fil-split-refactors: diff den nye fil mod HEAD af originalen,** ikke mod
   hukommelsen om den. #529 kopierede en forældet version af webhook-sektionen ind.
3. **Dead code er ikke neutralt** — den døde AdminPage.jsx skjulte regressionen ved
   at få `grep`-baserede checks (og læsere) til at tro at hærdningen var i brug.
