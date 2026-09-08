# Manager-DM v1 — design (#3200)

Ejer-designvalg 8/9 (#3200-kommentar, rækkefølge i #4751). Fair-play-evidens: #3131.

## 1. De tre ejer-valg og hvad de betyder i koden

1. **Kun 1:1.** En samtale har præcis to deltagere. Ingen pulje-/gruppetråde i v1.
   Indgange: managerprofilen (`/managers/:teamId`), forfatternavne i forummet,
   og handler (transfertilbud + auktioner). Samles i en Beskeder-fane i indbakken.
2. **Blokér + anmeld + log.** Ingen automatisk indholdsfiltrering. Alle beskeder
   ligger i én tabel og slettes aldrig fra databasen; en bruger kan kun skjule en
   samtale for sig selv. Admin må ikke læse privat post uden en anmeldelse.
3. **Kobling til handler MED fra start.** Knap på transfertilbud og auktioner der
   åbner samtalen med modparten og citerer handlen som første besked. Kun tal
   begge parter allerede kan se.

## 2. Deltagere er brugere, ikke hold

`participant_a`/`participant_b` er `users.id` (#4379: en manager er én person).
Visningen er stadig manager + hold (`teams.manager_name`, `teams.name`), slået op
via holdet der ejes af brugeren. Skifter en manager hold, følger samtalen personen.

## 3. Tabeller (`database/2026-09-08-3200-manager-dm.sql`, idempotent)

| Tabel | Nøglefelter | Note |
|---|---|---|
| `dm_conversations` | `id`, `participant_a`, `participant_b`, `created_at`, `last_message_at` | `participant_a` er altid `least(u1,u2)`, `participant_b` `greatest(u1,u2)`, håndhævet af CHECK + UNIQUE. Én række pr. par, uanset hvem der skrev først. |
| `dm_messages` | `id`, `conversation_id`, `sender_id`, `body`, `created_at`, `context JSONB` | `context` = citeret handel (kind, rytternavn, beløb, dato, deep link). Ingen DELETE-policy: det ER loggen. |
| `dm_reads` | `(conversation_id, user_id)` PK, `last_read_at` | Ulæst = beskeder efter `last_read_at` fra den anden part. |
| `dm_blocks` | `(blocker_id, blocked_id)` PK, `created_at` | Retningsbestemt. |
| `dm_reports` | `id`, `conversation_id`, `reporter_id`, `reason`, `created_at`, `resolved_at` | Rækkens eksistens er admin-nøglen til tråden. |
| `dm_conversation_hides` | `(conversation_id, user_id)`, `hidden_at` | Skjul pr. bruger. Ny besked ophæver skjulet i visningen; rækken ryddes ikke. |

## 4. RLS

- `dm_conversations`: SELECT hvis `auth.uid()` er en af parterne. INSERT via backend.
- `dm_messages`: SELECT hvis brugeren er part i samtalen. **INSERT sker kun via
  backendens service-role** efter blok- og rate-tjek; ingen direkte klient-INSERT.
  Ingen UPDATE, ingen DELETE for nogen rolle (heller ikke afsender).
- `dm_blocks`/`dm_reads`/`dm_conversation_hides`: kun ens egne rækker.
- `dm_reports`: INSERT for en part i samtalen; SELECT for anmelderen.
- **Admin:** en SELECT-policy på `dm_messages` for admin-rollen der kræver
  `EXISTS (SELECT 1 FROM dm_reports r WHERE r.conversation_id = m.conversation_id)`.
  Uanmeldte samtaler er dermed usynlige for admin på databaseniveau, ikke kun i UI.

## 5. Blokerings-semantik (valgt: knappen skjules ikke, beskeden kvitteres)

Den blokerede afsender må ikke kunne udlede blokeringen. Derfor **skjules knappen
ikke**, og endpointet returnerer `200 { delivered: false }` i stedet for en fejl:
beskeden gemmes i `dm_messages` (loggen skal være komplet — det er evidensen i
#3131), men modtageren får hverken notifikation eller rækken i sin visning, fordi
RLS-læsningen for modtageren filtrerer beskeder fra en blokeret afsender fra.
Afsenderen ser sin egen besked i tråden. Alternativet, at skjule knappen, lækker
blokeringen direkte, og at afvise med 403 lækker den lige så tydeligt.

## 6. Endpoints (`/api/messages`, backend — ikke direkte PostgREST)

| Metode | Sti | Gør |
|---|---|---|
| GET | `/api/messages/conversations` | Liste med modpart, sidste besked, ulæst-antal |
| GET | `/api/messages/unread-count` | Tallet til navigations-badgen |
| GET | `/api/messages/conversations/:id` | Tråd, pagineret, nyeste sidst |
| POST | `/api/messages/send` | `{ recipientUserId \| conversationId, body, context? }` — opretter samtalen hvis den mangler |
| POST | `/api/messages/conversations/:id/read` | Sætter `last_read_at` |
| POST | `/api/messages/block` / `unblock` | `{ userId }` |
| POST | `/api/messages/report` | `{ conversationId, reason }` |
| POST | `/api/messages/conversations/:id/hide` | Skjuler for kalderen |

Validering: `body` trimmet, 1-2000 tegn, ren tekst (ingen HTML), modtager ≠
afsender, modtager skal være en rigtig manager (ikke AI/bank). Rate-limit **30
beskeder pr. 10 min pr. bruger** på `send`. Notifikation af ny type `dm_message`
til modtageren, dedupe pr. samtale mens den er ulæst (samme mønster som
`forum_thread_reply`), registreret i `notificationTypes.js`, DB-constrainten og
`frontend/src/lib/notificationLink.js`.

**Realtime er ikke med i v1.** Åben tråd poller hvert 20. sekund; listen og
badgen følger indbakkens eksisterende hentning. Realtime kan lægges ovenpå senere
uden at ændre datamodellen.

## 7. UI (T1 standard content)

- **Indbakken** får fanen Messages/Beskeder med samtaleliste: initial-avatar som i
  forummet, managernavn, holdnavn, sidste linje, tid, ulæst-prik. Tom tilstand
  peger på managerprofilerne.
- **Tråd:** beskeder i to retninger, input nederst med tegntæller mod 2000,
  tre-prik-menu med Blokér og Anmeld. Citeret handel vises som et indrykket kort
  over den første besked med link til tilbuddet/auktionen.
- **Managerprofilen:** primær handling i heroen, adskilt fra identitetsrækken
  (#5012/#5007 arbejder der parallelt).
- **Forummet:** ét link i `ForumAuthorIdentity`; body renderes med forummets
  eksisterende sikre renderer, så links bliver tekst-links.
- Copy: EN først, DA under, jeg-stemme i systemtekster. Nyt i18n-namespace
  `messages` (en+da). Mobil først (390px).

## 8. Dokumentation der skal følge med

`docs/SOCIAL_RULES.md` får et DM-afsnit (gates, blok-semantik, admin-adgang via
anmeldelse, ingen sletning), og `docs/GAME_INVARIANTS.md` en note om 2000-tegns
loftet og rate-limitten.
