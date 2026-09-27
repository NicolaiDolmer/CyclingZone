# Discord: sæsonskiftet S3 → S4 samlet i ét opslag (#5474)

**Status: AFVENTER EJER.** Ikke sendt. Ejeren poster selv søndag 27/9 før skiftet, kun EN, i #the-roadbook
(ejer 27/9: roadbook-opslag er kun på engelsk). Stemme: `docs/TONE_OF_VOICE.md`.

**Skrevet om 27/9 formiddag** (ejer: forrige version var for klippe-klistret). Ordet for de 140 dage er
**season day** (ejer-valg 27/9); **race day** bruges kun om dage med løb.

**Antagelser, ejeren bekræfter før posting:**

- (a) ✅ Bestyrelsen (Mandatet) er flippet til on 27/9 10:26 (#4859; tørkørsel grøn: 245 hold).
- (b) Træning pr. sæsondag tændes i aften efter skiftet eller mandag (`training_tick_per_race_day`,
  ejer 27/9). Opslaget nævner ikke Train today (ejer: skriv ikke om det, der bare bliver).
- (c) Point-flytningen (#5268) koeres ikke i aften og faar ingen dato (ejer 27/9: rating-neutral foerst, ægte baroudeurer beholder aggression).

To beskeder (Discords grænse er 2.000 tegn). Refs #5474 #5506

---

## Besked 1

```
Hep! @everyone

Season 3 ends tonight. Here is everything about the switch to season 4 in one place.

**Tonight**
The last stages start at 18:00 in Divisions 2 to 4 and 19:00 in Division 1. I run the switch right after, around 19:30. Season 4's first stage is Monday at 19:30, so you get a full day to set your squad.

**The new pyramid**
Promotion and relegation run as normal, 2 up and 4 down. After that, every manager in Division 4 moves up to Division 3, spread over its four groups by points. Division 4 goes from 8 groups to 4 and is filled with AI teams for now. Every division has 140 season days, race days and training days, and the calendar is already out: Race Hub, Season, season 4.

**Your money**
Riders whose contract runs out become free agents tonight, so extend the ones you want to keep. Your sponsor's base is paid at season start. Retiring riders no longer cost you next season's wage, and your U23 and junior riders cost nothing in upkeep this time.
Upkeep itself changes. Instead of paying the whole season on day one, you pay Travel & staff for each senior race day you have a rider at the start. Race every day and it is the same total. Skip a race and you keep the money.
```

## Besked 2

```
**Youth**
Your U23 team holds 12 riders and your junior team 10. In season 4 both ride their own races in their own groups: U23 once or twice a week, juniors once. No prize money in youth races yet. On Graduation Day juniors turning 19 move to U23, and U23 riders turning 23 move to your senior team. You choose: move up, sell or release. Do nothing, and the club moves him up if there is room, otherwise he is sold.

**Training**
From Monday every season day is a race day or a training day for each rider, never both, and training runs in the evening after the day's last race.

**Your board**
The board goes live for everyone. It calls you to the annual meeting when the switch runs, and you sign your mandate for season 4 there.

**Been away?**
Teams with no login for 30 days that have not signed up are parked at the switch. Nothing is deleted. Wages are still paid, but there is no sponsor money. One tap on your dashboard brings you back, placed by your Global Rank.

**The new race engine**
Not switched on yet. I decide after the switch, and you hear from me before it runs a single race.

**Not done yet**
Tactics and aggression points moving into Teamwork and Leadership. I want it done so that no rating you see goes down and a real baroudeur keeps his aggression, and you hear from me before it runs. Promotion and relegation for the youth groups, and team time trials, come in season 5.

Questions? Drop them below, and I will answer tonight ✌️
Dolmer
```

---

## Kilder

| Påstand | Kilde |
|---|---|
| Sidste etape kl. 18 (D2-D4) / 19 (D1); skifte ca. 19:30 | Tørkørslen 27/9 (planlægningsvindue: sidste etape 27/9 19:00 D1, 18:00 D2-D4); `season_transition_planned_at` = 17:30Z |
| Første S4-etape mandag 19:30 | Tørkørslen 27/9 (D1-D4 første dag 2026-09-28 fra 19:30) |
| 2 op / 4 ned | Ejerens roadbook-opslag 24/9 |
| D4 → D3 i fire puljer efter point; D4 4 puljer, AI | Spec ejer 24/9; runbook 12a+ (#5641, #5642); tørkørslen 27/9 (D4 A-D beholdes, E-H pensioneres) |
| 140 sæsondage i alle divisioner; kalenderen ude | Kalender skrevet 27/9 (382 løb, kontrol-SQL grøn); patch note 7.305 |
| Free agents, sponsorbase, pensioneret uden løn, ingen ungdomsdrift | `help.json` FAQ; #4153/PR #5553; patch note 7.300; #5741 |
| Rejse og personale pr. seniorløbsdag, samme sum ved fuld deltagelse | PR #5800, `upkeep_per_race_day` on 27/9 09:24; `UPKEEP_BY_DIVISION` / 140 |
| Ungdom: 12/10, egne løb, ingen præmiepenge, Graduation Day | patch note 7.297; `YOUTH_RULES.md` §2.3; `raceResultsEngine.js` (ingen præmie i ungdomsløb); `help.json` |
| Træning pr. sæsondag fra mandag | Antagelse (b) |
| Bestyrelsen live, årsmøde ved skiftet | `board_mandate_model_enabled` = on 27/9 10:26; #5752 |
| Parkering: intet slettes, løn betales, ingen sponsor, comeback efter Global Rank | `managerParking.js`; `economyEngine.js` l. 314-323; #5643 |
| Ny motor ikke tændt | `race_engine_v4` = off |
| Point-flyt uden dato, rating-neutral; ungdoms-op/nedrykning og TTT i S5 | Ejer 27/9 (#5268); spec ungdomsløb Y3; ejerens roadbook-svar 26/9 (TTT → S5) |
