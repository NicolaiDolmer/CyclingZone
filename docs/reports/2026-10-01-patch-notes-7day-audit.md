# Patch notes: 7-dages-audit 24/9-1/10 (#6014)

Ejer-direktiv 1/10: en spiller der kun læser patch notes på sitet eller i Discord skal være fuldt opdateret.
Udført 1/10 ca. 17-18 (CEST), read-only mod prod og Discord. Standarden der kom ud af det: [`PATCH_NOTES_RULES.md` §2a](../PATCH_NOTES_RULES.md).

## Kilder

| Kilde | Hvad | Bevis |
|---|---|---|
| Merged PR'er | 223 merges 24/9 00:00 - 1/10 15:05 UTC | `gh pr list --state merged --search 'merged:>=2026-09-24'` |
| Sitet | v7.297-v7.329 (7.312-7.315 og 7.328 findes ikke) | `frontend/src/data/patchNotes.js` |
| Prod-flag | `app_config` med `updated_at >= 2026-09-23` + `admin_log` (`feature_flag_changed`) | read-only SQL 1/10 |
| Registry | `board_mandate_model_enabled` state live, verified 28/9 | `docs/FEATURE_REGISTRY.yml` |
| Sæsonskiftet | S3→S4 27/9 | `.claude/learnings/2026-09-27-saesonskifte-s3-s4.md`, v7.305-7.306 |
| Discord | `#patch-notes`, `#the-roadbook`, `#race-communique`, beta `#updates` | Discord REST read-only, intet postet |

## Flag-flips i vinduet (prod, read-only)

| Flag | Til | Dato (CEST) | Klasse | På sitet? |
|---|---|---|---|---|
| `youth_squad_pages` | beta → on | 26/9 19:05 | BETA→LIVE | Ja, 7.304 |
| `rider_best_role_display` | beta → on | 26/9 22:27 | BETA→LIVE | Ja, 7.303 |
| `rider_valuation_model` | v6 | 26/9 22:21 | TÆNDT | Ja, 7.303 |
| `training_programs` | beta | 27/9 08:54 | BETA | Ja, 7.305 |
| `upkeep_per_race_day` | on | 27/9 09:24 | TÆNDT | Ja, 7.305 |
| `board_mandate_model_enabled` | on (var beta) | 27/9 10:26 | BETA→LIVE | **Nej → tilføjet 7.330** |
| `race_engine_v4` | on | 28/9 13:27 | TÆNDT | Ja, 7.310 |
| `training_condition_per_date` | on | 29/9 19:12 | RETTELSE | Ja, 7.318/7.319 |
| `training_daily_receipt` | beta | 30/9 22:07 | BETA | Ja, 7.326 |
| `training_train_now`, `training_program_cells`, `training_fatigue_rules` | beta | 1/10 14:28 | BETA | **Nej → tilføjet 7.330** |
| `email_loop_race_digest` | on | 24/9 18:28 | (mail, ikke patch note-flade) | Nej, bevidst |
| `academy_drift_enabled` | off | 25/9 | Ja, 7.300 | Ja |

**Omdømme (`rider_reputation_enabled`):** prod står på `on` (sat 10/9, read-only SQL 1/10). Kun `on` åbner for
læsning (`isReputationReadEnabled` i `backend/lib/reputationFlag.js`), og `/api/display-flags` sender den videre til
klienten. Visningen kom med #5828, merget 1/10 15:48 CEST, så omdømmet er synligt for alle fra i dag. Patch note-
teksten fra #5828 (7.312 i PR'ens historik, endelig ordlyd fra PR-bodyen) er tilføjet i 7.330 som `switched_on`.
(En tidligere version af denne rapport sagde fejlagtigt `shadow`.)

## Manglede på sitet (tilføjet som v7.330, dato 1/10)

| Ændring | PR | Klasse |
|---|---|---|
| Mandatet (ny bestyrelse, årsmøde, bestyrelsens dom i sæsonopsummeringen) for alle siden 27/9 | #5758 #5759 #5760 #5761, flag 27/9 | BETA→LIVE |
| Rytterens omdømme synligt (profil, database, holdsider, auktioner, marked, bestyrelsens stjernemål) | #5828, flag `on` | TÆNDT |
| Træn nu, plan pr. løbsdag, Træthed i aften, Træthedsgrænse | #5999 | BETA |
| U23-/juniorløb gav hvile i stedet for udvikling; startede ikke løbsdag 1; rørte seniorbestyrelsen | #5880 #5890 #5892 | RETTELSE |
| Frie løbsdage inde i et etapeløb er træning | #5880 (ejer-valg A 28/9) | LIVE |
| Ingen bjergpræmie uden bjergpoint | #6003 | RETTELSE |
| Afmeldt hold vises som Afmeldt; salg venter ikke på løbet | #5732 | RETTELSE |

Bevidst ikke noteret (ikke spillervendt eller dækket andetsteds): ops/CI/docs/deps/test-PR'er, motor-PR'er bag
slukket v4 før 28/9 (samlet i 7.310), #5996 (backend-only, nye løb bindes til `legacy`), #6005 (intern retry),
#5815 (engangsmail før skiftet), #5791 (tilbage-knap gendanner filtre, allerede lovet i Discord 17/9), #5680
(dobbelt plus i gammel bestyrelsesside).

## Rollout-markering på eksisterende entries

Alle player-changes i 7.297-7.329 har fået `rollout`. Fordeling: live for langt de fleste; beta: 7.298 (3), 7.301
boardroom, 7.304 boardroom, 7.305 træningsprogrammer, 7.326 kvittering; beta_to_live: 7.303 bedste rolle, 7.304
U23/junior-sider; switched_on: 7.303 værdimodel, 7.305 upkeep, 7.308 træning pr. løbsdag, 7.310 løbsmotoren;
event: 7.304 ingen værdiopdatering, 7.305 S4-kalender, 7.306 sæsonstart/sammenlægning/parkering/ungdomsløb, 7.309 gave.

## Discord mod sitet

`#patch-notes` dækker 7.295-7.308 (sidste patch-opslag 28/9 10:26) plus en forhåndsmeddelelse om 7.318/7.319 (29/9).

| Mangler i Discord | Sitet |
|---|---|
| 7.307 rest, 7.309 (postet som separat opslag 28/9, ok), 7.310 ny løbsmotor (kun nævnt i `#the-roadbook`), 7.311 | ja |
| 7.316, 7.317, 7.320-7.327, 7.329 | ja |
| 7.330 (alle syv) | ja efter denne PR |
| Mandatet for alle | hverken site eller Discord før denne PR |

Discord-udkast til ejeren: [`docs/drafts/2026-10-01-patch-notes-catchup-discord.md`](../drafts/2026-10-01-patch-notes-catchup-discord.md).
Træningspakken (beta) er allerede beskrevet for beta-gruppen i `#updates` 1/10; udkastet nævner den kort under BETA.

## Hvad auditten ikke dækker

- Om #6003 er deployet til Railway på skrivetidspunktet (merget 1/10 17:05 CEST); entryen siger "kommende etaper".
- Aftenens planlagte flip af træningspakken til alle: skal have sin egen `beta_to_live`-entry samme aften.
- Discord-tråde og forum er ikke gennemgået, kun kanalerne ovenfor.
