# Prompt til næste session (9/10 morgen)

Fortsæt Cycling Zone efter sessionen 8/10 aften-nat. Læs FØRST `docs/NOW.md` (🎯 Next action), `docs/MASTERPLAN.md` og denne fil. Sæt 🤖 Working agent i NOW.

## Sessionens ene mål (ejer 8/10, uændret)
Tour de l'Hexagone (D1, 18 etaper) starter søndag 11/10 kl. 11 og skal køre fejlfrit; træningens løfter skal lande. Frist for motor-revisionen: **lør 18:00**, ellers kører Touren på `orders_gc_v2`, og spillerne får det at vide.

## Arbejdsform (bindende)
Uændret fra `docs/sessions/2026-10-09-next-session-prompt.md` (Opus leder/bygger, Fable = designer + én dommer før motoren tændes, design før byg, merge-regel 35(d), bølger via `wave.js`, ét spørgsmål ad gangen med nøgletal i kortet, billeder som fil). **Beslutninger tages i morgenblokken kl. 08:30, ikke om aftenen** (ejer 8/10). **Én merge-kø ad gangen til køens proces er afsluttet** (læring 9/10).

## 1. Merges først (regel 35(d), én kø)
`scripts/merge-queue.ps1 -Pr "6375,6376,6382"` i den rækkefølge:
- **#6375** docs: udbrudsmålene samlet i RACE_ENGINE_RULES ("Udbrudsmål") + båndet er ejer-godkendt, ikke "kandidat".
- **#6376** kalibrering af `official_times_v2` mod udbrudsmålene (slukket; ingen løb bruger revisionen). Opus-review: bemærkninger, ikke blokerende.
- **#6382** patch note 7.347 (Train now-låsen, samme km i film/historie, online = synlig fane). Discord-udkast EN: `docs/drafts/discord-patch-notes-2026-10-08-aften.md` → til ejeren.
#6053 og #6248 må IKKE merges (ejer-gated: #6248 kommer med Udvikling 2.0). #6305 er draft (form).

## 2. Tour-gennemtest → Fable → billede (før morgenblokken)
`infisical run --env=prod -- node backend/scripts/dev/tourDryRun.mjs "--race-name=Tour de l'Hexagone" --revision=official_times_v2,orders_gc_v3 --compare=orders_gc_v2 --seeds=10` (Infisical var logget ind 8/10). Status 8/10 (5 seeds, før #6376): official_times_v2 57 PASS/5 WARN/9 FAIL mod orders_gc_v2 45/13/13 (eget hold jagter egne 17→0, klump ved +30:00 76→0, mærke-modsigelser 0,6→0, GC-margin 0:40→1:15). Kalibreringens private tal: `C:/Dev/CyclingZone-worktrees/feat-5578-breakaway-targets-official-v2/balance-internals/5578-official-v2/tal-2026-10-09.md`. Fable (READ-ONLY, `model: fable`) dømmer scorecard + RULES "Udbrudsmål" mod virkelig cykelsport. Ét annoteret før/efter-billede (orders_gc_v2 vs official_times_v2), aggregerede tal, ingen navne.

## 3. Morgenblok 08:30 (ét kort ad gangen, anbefaling + nøgletal i kortet)
1. **Tour-go på `official_times_v2`** (billede + Fables dom). Ved go: sæt revisionen for Touren (prod-data = ordret "kør"), frys.
2. **Konflikt mål 2 vs mål 3** (#5578): kalibreringen rammer udbrudssejre pr. terræn (#1021-båndet) og "bjerg: foran favoritterne ~45 %", men "holder til mål på legacy-niveau" FAILer på kuperet og højfjeld (og Giro-bjerg), fordi legacy selv ligger over #1021-båndet og har kaptajner i udbruddet. Anbefaling: mål 2 (virkelige data) går forud; mål 3 gælder flad/rullende eller måles på sejre. Skriv svaret i RULES "Udbrudsmål".
3. **Form #6156**: foreløbigt svar 8/10 = tænd ved S5 25/10 (endelig nu). Derefter hjælpetekst-kortet (linje i 5 tekster + notits i Formplanen) og om #6158 lukkes som overhalet. Fables 7 designkort: OneDrive `private-handoffs/2026-10-08-claude/form-6156-designmoede-9-10.md`.
4. **Grupetto/tidsudelukkelse** (#6199/#6330): OTL sker oftere end i v3 på hårde bjergetaper; ny spillervendt regel, før Touren tændes.
5. **Betaling + moms** (#4511 A anbefalet, #4514/#4512; slå Alunta "Betaling fejlet" + "Betalingsopfølgning" til).
6. **#5268 evner** (beslutning A låst 1/10): tør kørsel 8/10 (PR #6371 merget): 7.813 ryttere får et tomt felt fyldt, 0 ratingfald. Åbent punkt: 658 (Holdarbejde) / 719 (Lederskab) med 1-5 opstået fra NULL via træning. Apply = ejer-go + backup + `--owner-go --expect-riders=N` (rapport `docs/snapshots/5268/`). Tallet ændres dagligt (træningen fylder felter).
7. **PostHog-nøgle** `POSTHOG_PERSONAL_API_KEY` (#6310).

## 4. Derefter
Træning: #6383 (dagsboard/sæsonmatrix gråner låste ryttere), #6027 (4 af 5 dage), #6123 (nulstil til holdprogram), svar om 1.759 tabte træningsdage (#5912, lovet 30/9). Ops: #6370 (frontend-freshness falske røde + prod-domæne), #6318-opfølgning (30-min setInterval-jobs lander tæt på cron-bevisets deadline). Spillerstatus EN (Discord, ejeren poster) + roadmap synk.

## Laves IKKE (ejer 8/10)
Nye features (fx #5105), Udvikling 2.0-byg (#6110; kun designkort), byg af S5-etapeprofiler (kun design; designmøde fre-man), vækst og markedsføring.
