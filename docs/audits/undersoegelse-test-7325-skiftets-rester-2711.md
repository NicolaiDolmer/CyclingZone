# Undersøgelse #7325: skiftets fem rester prøvekørt på en lokal prod-kopi (kørsel 2, 27/11)

Spor: undersøgelse (kind: investigate, #5220). Kode: main på `0aa1c2318`. Ingen kode ændret, intet skrevet mod prod.
Prod blev kun læst (én læse-forespørgsel på `app_config`). Tal om hold, managere og saldi står ikke her.

## Hvad jeg gjorde

1. Lagde prod-dumpen fra 26/11 ind i en ny database i den lokale PG17-klynge fra kørsel 1 (127.0.0.1, egen port).
   Første forsøg fejlede, fordi tre ting manglede i kopien: rollen `codex_readonly`, `extensions.uuid_generate_v4()`
   og `auth.uid()`. Med dem stubbet tog restore 3 min. Kun de forventede 33 fremmednøgler til `auth.users` fejlede.
2. Brugte klienten oven på `pg` fra kørsel 1 og rettede fejlen derfra: arrays og objekter sendes nu som JSON til
   rpc-parametre af typen `jsonb` (typen slås op i `pg_proc`). Rettelsen ligger kun i scratch.
3. Al netværkstrafik var blokeret undtagen den lokale port. Der var 4 forsøg, alle på `discord_settings`
   via en falsk adresse, og alle blev stoppet. 0 forsøg mod prod, Resend eller Discord.
4. Uret i Node stod på lør 28/11 kl. 19:30 dansk tid. Kørte `transitionToNextSeason` fra S5 for alvor,
   under `verify-lock` (én tung proces ad gangen).
5. Målte før og efter med SQL. Bagefter blev databasen droppet og klyngen stoppet.

## Resultat af skiftet

Hele skiftet kørte igennem: **ok på 6 min 0 s**, cirka 31.800 forespørgsler, 26 faser uden fejl.
S5 blev færdig og S6 aktiv. Ingen dobbelte pengeposter (idempotens-nøglen), og ingen hold hvor saldoen
ikke passer med den seneste post, hverken før eller efter.

## De fem rester

| Rest | Virker? | Bevis fra kopien (før → efter) |
|---|---|---|
| #7323 oprykning junior→U23→senior | Virker | Fasen `season_squad_promotions` flyttede 589 ryttere. Juniorer 877 → 403, U23 1319 → 1338. Efter skiftet er der 0 juniorer og 0 U23-ryttere, der er for gamle til deres trup i S6. Ventende oprykninger 9 → 0 |
| #8034 trupgrænser 30/30/30, højst 60 | Virker | 0 hold over 60 i alt, både før og efter. Hold med over 30 i én trup steg fra 1 til 6 (alle senior, højst 33). Det er aftalt adfærd: GAME_INVARIANTS siger, at aldersoprykning må bringe en trup over 30 uden at ændre klubtallet. Ingen AI-hold over 30 |
| #8100 ingen bestyrelsesdom i comeback-sæsonen | Virker | Dommen ligger ikke i selve skiftet, men i sæsonafslutningen (`processTeamSeasonEnd` springer dommen over via `boardJudgmentHold`, og årsmødet kører stadig). Skiftet rørte ikke comeback-holdene. `boardComeback.test.js` og `seasonSquadPromotion.test.js`: 5 af 5 grønne |
| #5865 skader nulstilles (`clear`) | Virker | Fasen `season_injury_reset`: 38 aktive skader fundet, 38 fjernet, 0 forkortet. Efter skiftet: 0 ryttere skadet på eller efter 28/11. Markøren for at nulstillingen er kørt i S6 er sat, så en genkørsel ikke gør det igen |
| #8522 aldring i procent + varigt slid | Virker, og står **on** | Fasen `rider_progression`, regel `xp_pct`: 14.273 ryttere behandlet, 3.667 gik ned, 0 gik op, 154 stoppede. Varigt slid: 0 → 3.667 rækker, og slid-point lagt til er lig med de evnepoint, der faldt. Udviklingslog voksede med cirka 14.300 rækker |

**Vigtigt om #8522:** briefen siger, at `development_xp_model` står off. Det passer ikke.
Både kopien (26/11) og prod i dag (læst 27/11) har `development_xp_model = "on"` og `development_v2_aging_enabled = "on"`.
Det, der sker ved skiftet lørdag, er derfor procent-aldringen med varigt slid, som vist i tabellen.
Der kommer ingen vækst ved selve skiftet (0 gik op). Væksten kommer fra den daglige træning.

## Andre observationer

| # | Observation | Alvor |
|---|---|---|
| 1 | Klienten fra kørsel 1 virker nu på hele skiftet efter jsonb-rettelsen. Restore kræver tre stubs (rolle, uuid-funktion, `auth.uid()`) | Kan vente. Bør med i harnessen i PR #8692, hvis den skal bruges igen |
| 2 | 418 trupper under minimum fik en besked i skiftet (fordelt på junior, U23 og senior) | Kan vente. Forventet efter kontraktudløb og oprykning, men ejeren bør vide, at mange får beskeden |
| 3 | 61 gamle løbsdags-skader fra S4 og S5 har stadig en tæller. De gælder ikke i S6, fordi skadesreglen kræver samme sæson, og datoen er overskredet | Kan vente (kosmetisk data) |
| 4 | Klyngens datamappe fra kørsel 1 (cirka 7 GB) ligger stadig. Den blev genbrugt her for at spare disk (C: er 96 % fuld) | Skal ryddes af hovedsessionen eller ejeren efter lørdag |

## Hvad der skal bygges

Intet for de fem rester. De virker på en kopi af prod med dagens main.
Eneste rettelse er briefens antagelse om #8522: aldringen er tændt og kører lørdag.

## Bevis-test

- Ægte kørsel af `transitionToNextSeason` fra S5 på prod-kopien: `{"ok":true,"durationMs":359910,"queries":31807}`.
- Faselog: `season_squad_promotions count=589`, `season_injury_reset mode=clear injured=38 cleared=38`,
  `rider_progression rule=xp_pct declined=3667 riders_with_new_wear=3667`.
- SQL efter skiftet: 0 for gamle i junior/U23, 0 hold over 60, 0 aktive skader, 0 dobbelte pengeposter.
- `node --test lib/boardComeback.test.js lib/seasonSquadPromotion.test.js`: 5 bestået, 0 fejlet.

Dom: afvist + bevis-test
