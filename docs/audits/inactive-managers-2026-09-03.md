# Inaktive managere — audit 2026-09-03

> **Status:** read-only audit (Supabase MCP, `execute_sql`), ingen skrivninger. Refs #4592.
> **Formål:** trin 1-leverance til epic #4592 (ejer-design 2/9: 30 dages login-grænse via
> `users.last_seen`, parkering ved sæsonskiftet S4 28/9, uden datasletning).
> **Kilde:** samme "inaktiv"-definition som `backend/lib/managerActivity.js`
> (`isDormantManager`, `days = 30`) og samme menneskehold-diskriminator som
> `backend/scripts/dormantTeamsReport.js` (`is_ai=false, is_bank=false, is_test_account=false`).
> **Bemærk:** infrastrukturen til selve parkeringen (`backend/lib/managerParking.js`,
> migrationerne for `teams.parked_at`/`teams.next_season_signup_at`) blev bygget og merget
> 2/9 (PR #4663, draft-flag, ingen adfærdsændring endnu). Denne audit er et opdateret
> øjebliksbillede + de ekstra nedbrud (division/bånd, samtykke, Pro) som epic-trin 1 kræver,
> og som `parkingDryRun.js` ikke selv rapporterer.

## 1. Samlet billede

| Mål | Antal |
|---|---|
| Menneskehold i alt (`is_ai=false, is_bank=false, is_test_account=false`) | 237 |
| Allerede parkeret (`parked_at IS NOT NULL`) | 0 |
| Inaktive ≥30 dage, uparkeret | **111** |
| — heraf frosset (`is_frozen=true`, parkeres IKKE af designet) | 1 |
| — heraf tilmeldt via "Tilmeld dig næste sæson" (`next_season_signup_at`), parkeres ALDRIG | 0 |
| — reelle parkerings-kandidater ved dagens regel | **110** |

Ingen af de 111 inaktive har `last_seen IS NULL` (ingen "intet login nogensinde"-tilfælde i det aktuelle datasæt).

## 2. Fordelt pr. division og "sidst set"-bånd

| Division | 30–60 dage | 60–90 dage | 90+ dage | I alt |
|---|---:|---:|---:|---:|
| 1 | 5 | 0 | 0 | 5 |
| 2 | 14 | 4 | 0 | 18 |
| 3 | 43 | 22 | 1 | 66 |
| 4 | 7 | 13 | 2 | 22 |
| **I alt** | **69** | **39** | **3** | **111** |

Tyngden ligger i division 3 (66 af 111, ca. 59 %) og i 30–60-dages-båndet (69 af 111, ca. 62 %) —
de fleste er nyligt gået sovende, ikke langtidsfraværende.

## 3. Marketing-samtykke

| Mål | Antal (af 111 inaktive) |
|---|---:|
| `consent_preferences.email_marketing = true` | 78 |
| `consent_preferences.marketing = true` | 78 |
| `consent_preferences IS NULL` (banner ikke besvaret) | 3 |

`email_marketing` er den korrekte win-back-gate (se `docs/audits/winback-consent-audit-2026-09-02.md`
afsnit 1.3) — 78 af 111 (70 %) kan lovligt modtage en win-back-mail. De resterende 33
(30 af dem har enten svaret nej eller ikke besvaret banneret) må IKKE kontaktes uden samtykke,
uanset om deres hold parkeres.

Tallet 78 stemmer overens med det tidligere målte 77 fra 2/9 (samme størrelsesorden, en
manager mere er blevet dormant i mellemtiden).

## 4. Aktivt Pro-abonnement blandt de inaktive

**0 af de 111 inaktive hold har et aktivt Pro-abonnement** (`subscriptions.status = 'active'`
joinet på `team_id`). Der er derfor **ingen konflikt at afklare med ejeren lige nu** — men
reglen i `selectTeamsToPark` (`managerParking.js`) tjekker i dag IKKE `subscriptions.status`
overhovedet. Hvis en Pro-abonnent bliver inaktiv i 30 dage FØR de opsiger, parkeres holdet af
den nuværende logik uden at spørge — det er et hul, ikke bevidst designet ind, og bør lukkes
i trin 2 (se afsnit 6) inden cutover 28/9, selvom det ikke rammer nogen i dag.

## 5. Bilag: holdnavne (offentlige, ingen mails/brugernavne)

Sorteret efter division, mest inaktiv først.

<details>
<summary>Division 1 (5 hold)</summary>

| Hold | Dage siden login | Bånd |
|---|---:|---|
| Atom Bikers | 44,6 | 30-60 |
| TR Cycling | 41,0 | 30-60 |
| Apex Cycling | 38,7 | 30-60 |
| Vallados del Sur | 35,0 | 30-60 |
| Xtreme Noob | 33,8 | 30-60 |

</details>

<details>
<summary>Division 2 (18 hold)</summary>

| Hold | Dage siden login | Bånd |
|---|---:|---|
| Team Riskær | 67,8 | 60-90 |
| Team Discover | 66,0 | 60-90 |
| Air France-KLM Team | 65,1 | 60-90 |
| Fellaini Racing Team | 62,8 | 60-90 |
| Trader Joe / Schwan's | 58,3 | 30-60 |
| Team Velocity One | 51,2 | 30-60 |
| Bouboule Team | 49,8 | 30-60 |
| Indeso | 47,9 | 30-60 |
| Breda | 45,3 | 30-60 |
| MatsenSid | 45,1 | 30-60 |
| West Racing Team UK | 43,1 | 30-60 |
| martharacing | 42,2 | 30-60 |
| GA$$A RACING | 41,8 | 30-60 |
| Easy Riders | 39,1 | 30-60 |
| Scallabis Cycling Team | 38,6 | 30-60 |
| StormBreaker Continental Team | 36,5 | 30-60 |
| A-PEX VELO | 35,2 | 30-60 |
| Verstappen racing | 31,8 | 30-60 |

</details>

<details>
<summary>Division 3 (66 hold, inkl. 1 frosset — parkeres ikke)</summary>

| Hold | Dage siden login | Bånd | Note |
|---|---:|---|---|
| Equipo Kern Pharma | 112,7 | 90+ | |
| Krapouchi Cycling Team | 84,8 | 60-90 | |
| Hopplà Team | 84,8 | 60-90 | |
| Kemphanen Cycling Team | 84,7 | 60-90 | |
| Team Bucovina | 80,1 | 60-90 | |
| Team Holly | 69,8 | 60-90 | |
| Swatt Team | 68,7 | 60-90 | |
| puckpuckpuck | 68,1 | 60-90 | |
| The Morse Codes | 67,9 | 60-90 | |
| Red Bull - Robley - Rockets | 65,9 | 60-90 | |
| Squid Sycling | 65,8 | 60-90 | |
| Team Lea | 65,8 | 60-90 | |
| Slock Lyset | 65,7 | 60-90 | |
| Viimsi Racing | 65,4 | 60-90 | |
| Team BRND | 65,2 | 60-90 | |
| Parfek | 65,1 | 60-90 | |
| Uni team | 65,1 | 60-90 | |
| Silveracers | 64,9 | 60-90 | |
| MMDH Cycling Team | 64,3 | 60-90 | |
| Tuft cycling | 64,3 | 60-90 | |
| Pruffolini | 63,3 | 60-90 | |
| Sunnyvale Cycling Club | 61,0 | 60-90 | |
| Sky Racing | 60,1 | 60-90 | |
| COURTEMANCHE | 59,8 | 30-60 | |
| Barra CC | 59,7 | 30-60 | **frosset — parkeres ikke** |
| Nordica | 57,7 | 30-60 | |
| Sigaard Cycling | 57,1 | 30-60 | |
| Team Velux | 56,8 | 30-60 | |
| Timmer Racing | 55,9 | 30-60 | |
| Pattex Cycling Team | 55,9 | 30-60 | |
| Purple Rain | 55,7 | 30-60 | |
| Hatestone Cycling Club | 55,2 | 30-60 | |
| TeebsteebsTeam | 55,1 | 30-60 | |
| Kimi racing | 54,7 | 30-60 | |
| Euskaltel-Euskadi | 54,7 | 30-60 | |
| Festina Nissa | 50,0 | 30-60 | |
| CSM Unirea | 49,8 | 30-60 | |
| Bhutan Egg Racing | 48,0 | 30-60 | |
| montísky | 47,5 | 30-60 | |
| Isaac racing | 45,2 | 30-60 | |
| Quercy-Gel Team | 45,2 | 30-60 | |
| Corratec | 45,2 | 30-60 | |
| Oranje babies | 45,2 | 30-60 | |
| Frigo cycling | 45,1 | 30-60 | |
| Remco Goat | 45,0 | 30-60 | |
| Rockets | 45,0 | 30-60 | |
| Q365 Racing | 44,9 | 30-60 | |
| Les flandriens | 44,2 | 30-60 | |
| Stella Artois Cycling Team | 44,0 | 30-60 | |
| Zeitgeist racing team | 43,7 | 30-60 | |
| Fish racing | 42,8 | 30-60 | |
| Guds hånd | 42,4 | 30-60 | |
| martha racing | 42,2 | 30-60 | |
| The wild ducks | 41,3 | 30-60 | |
| Marco Cycling | 40,1 | 30-60 | |
| Lip Air France Team | 40,0 | 30-60 | |
| Guntzracing | 39,3 | 30-60 | |
| Wandlitz Racing | 38,7 | 30-60 | |
| Sportivianna DeLuxe | 37,3 | 30-60 | |
| Visma LAB | 37,2 | 30-60 | |
| Ponot Cycling | 36,2 | 30-60 | |
| Efapel cycling | 35,8 | 30-60 | |
| One Two Three Cycling Club | 35,3 | 30-60 | |
| ADM Cycling | 34,9 | 30-60 | |
| lopel racing | 33,9 | 30-60 | |
| Falcor Cycling | 30,3 | 30-60 | |

</details>

<details>
<summary>Division 4 (22 hold)</summary>

| Hold | Dage siden login | Bånd |
|---|---:|---|
| Inuit Cycling | 124,8 | 90+ |
| Trululu La Guacamaya | 112,2 | 90+ |
| Ardennaise Pro Cycling Team | 84,6 | 60-90 |
| HWT Rockets | 71,3 | 60-90 |
| African Cycling Project | 70,1 | 60-90 |
| Chilihvidløg | 65,8 | 60-90 |
| Torpedo Zaffelare | 65,3 | 60-90 |
| TUN Racing | 65,2 | 60-90 |
| Beany riders | 64,9 | 60-90 |
| Pfeiffer Dev | 64,7 | 60-90 |
| Red Corsairs | 63,9 | 60-90 |
| Crowther Racing | 63,1 | 60-90 |
| Cycling Topper | 61,9 | 60-90 |
| Finset Outboard | 61,2 | 60-90 |
| Kelme Cycling Team | 60,1 | 60-90 |
| Team Niller | 44,9 | 30-60 |
| Guinness Cycling Team | 36,0 | 30-60 |
| c_02 | 33,9 | 30-60 |
| UAE Team Emirates | 32,2 | 30-60 |
| JDG | 31,9 | 30-60 |
| Xtrona Race Club (Vitrona) | 31,1 | 30-60 |
| Wielerploeg Onder Ons Parike | 30,1 | 30-60 |

</details>

## 6. Hvad trin 2-4 kræver (kort)

Se PR-body for den fulde version — kort opsummeret her:

- **Trin 2 (parkering ved cutover):** koden findes allerede (`managerParking.js`,
  `parkDormantTeams`), kaldes fra `economyEngine.js` KUN når `season_signup_enabled='on'`.
  Mangler: (a) Pro-abonnement-tjek i `selectTeamsToPark` (afsnit 4 ovenfor — lukkes uanset
  0 rammer i dag, fordi reglen ellers er et hul der rammer den næste Pro-kunde der går
  inaktiv), (b) ejerens eksplicitte go til cutover-datoen 28/9 + gennemgang af den friske
  `parkingDryRun.js`-liste FØR flip (jf. "ejer ser live-tilstand før store destruktive
  prod-indgreb").
- **Trin 3 (tilmeld-knap):** bygget bag flag i PR #4663 (`/api/season/signup*`,
  Dashboard-kort). Mangler: flip af `season_signup_enabled`-flaget (ejer-go), og at hente
  et parkeret hold tilbage i en division ved tilmelding (noteret som fast-follow i
  migrationens kommentar — ikke bygget endnu).
- **Trin 4 (win-back, #2760):** consent-audit + SQL-segment + mail-udkast klar
  (`docs/audits/winback-consent-audit-2026-09-02.md`). Mangler: selve mail-afsendelsen
  (Resend-skabelon + `email_prefs`-type `winback`), som kræver ejer-godkendelse af
  udkastet FØR første send (jf. "send aldrig spillerbeskeder på ejerens vegne").
