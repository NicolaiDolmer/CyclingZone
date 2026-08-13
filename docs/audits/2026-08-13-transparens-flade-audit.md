# Transparens-audit: hver spillervendt flade der påstår noget om en rytters fremtid

**Dato:** 2026-08-13 · **Ramme:** ejer-mandat 13/8 — *"Det er hamrende vigtigt, at spillerne kan stole på den information de ser."*
**Kilde-prompt:** [`docs/sessions/2026-08-13-transparens-session-prompt.md`](../sessions/2026-08-13-transparens-session-prompt.md)
**Refs:** #3667 (kommunikationspakken) · #3666 + #2454 (landing 1) · #3671 (scout-gulvet) · #3649 · #3643 · #1543/#1162 (maskeringen)

> **Status ved skrivetidspunktet:** landing 1 er IKKE deployet — [PR #3670](https://github.com/NicolaiDolmer/CyclingZone/pull/3670) er åben, #3666 og #2454 er åbne. Auditten er alligevel kørt nu, fordi #3666's scope ordret er *"alle visningsflader i én PR"*, og denne tabel er det dokument der definerer hvad "alle" betyder. Rækkerne markeret **⏳ landing 1** kan først formuleres færdigt når den nye skala er live.

## Tabellen

| # | Flade | Hvad den påstår | Sandt? | Hvad der skal ske |
|---|---|---|---|---|
| **B** | `help.json › sections.riders.scouting` | "Potential is always shown as stars and a verdict, **never as a number**" | **NEJ — falsk** | [`RiderScoutingTab.jsx:65`](../../frontend/src/components/rider/profile/RiderScoutingTab.jsx) printer `{now} · {ceilLo}–{ceilHi}` som rene tal. ✅ **rettet** — teksten siger nu at ryttertype-rækkerne viser tal, og hvordan båndet skal læses |
| **C** | `help.json › faq.typeRatingScaleFaq` | "a **one-time** correction … a rider's number **stays put** unless his own abilities change" | **NEJ — falsk** | Ankrene `RATING_O_ELITE = 67,38` / `RATING_O_MIN = 2,04` ([`scoutingReport.js:17-19`](../../backend/lib/scoutingReport.js)) er fittet mod prod-populationen 29/6 (n=2.947). Et re-fit flytter alles tal uden at én evne ændrer sig — og #3666 ændrer modellen igen. ✅ **rettet** — FAQ'en siger nu at skalaen er forankret i puljen, og lover en patch note når ankrene flytter sig |
| **F** | `rider.json › scouting.scoutTitle`, `levelTitle`, `profile.scouting.rescoutHint` | "Use a scout slot to **narrow** this rider's potential estimate" | **NEJ for 95 % af holdene** | Gulvet i `minHalfWidthByScoutRating` bounder niveau 3 ned til niveau 2's værdi. ✅ **copy rettet** — teksten siger nu at sidste niveau afhænger af spejderens rating. **Mekanikken er #3671**, ikke lukket her |
| **D** | `help.json › faq.riderRating` | "the very best riders **sit near 99**" | Sandt i dag, **falsk ved landing 1** | ⏳ **landing 1.** Sandt ved konstruktion i dag (`O_ELITE` = p99.5 → 99). Bedste rytter bliver ~85 efter #3666. **Skal ligge i samme PR som #3666** — ikke i en opfølgning |
| **A** | Scouting-fanens `typesLegend` | "where his ceiling likely sits" + "Ratings are **comparable across roles**" | Delvis | *"likely sits"* er sandt (se beviset nedenfor). *"comparable across roles"* hviler på den rekalibrering #3666 erstatter — ⏳ **skal måles på ny**, ikke gentages ubeset |
| **E** | Udvikling-fanen: "To ceiling" / "Ceiling age" + `faq.developmentProjectionFaq` | "a rough estimate of how many seasons and at what age he **reaches** it" | Systematisk for tidligt | ETA'en kommer fra den **optimistiske** envelope (`RATE_GROWTH_HI = 1,15`, `DECLINE_MULT_MILD`) mod `ceilHi` — som allerede ligger over sandheden. Optimistisk på to uafhængige akser, præsenteret som et neutralt estimat. ⏳ **Skævheden er ikke målt** — mål den mod `developmentProjectionHarness` før teksten omskrives |
| **G** | Verdict-kortet (`buildVerdict`) | "Already close to his ceiling, little left to gain" — som en konstatering | Er en **mening**, vises som fakta | Bygget på `bestCeilMid` = båndets midtpunkt, og midtpunktet er bevidst forskudt pr. manager (`CEIL_BIAS_FACTOR = 0,5`). To managere får forskellig dom om samme rytter. `recalcNote` dækker båndet — ikke dommen. **Åben** |
| **I** | `help.json › sections.riders.riderType` | Typen "shows what he can **become at his ceiling**" | **Ikke målt — og i fare** | Med de nye opskrifter er `climber ⊆ gc` (+ #3592's fire kendte par). For de ryttere kan tallet under deres EGEN type aldrig være deres højeste tal. ⏳ **Mål på den nye skala** før teksten får lov at stå |
| **K** | `profile.overview.legend.level` + `faq.riderAbilities` | "rated **1-99** on 15 abilities" | Teknisk sandt, vildledende | Målt 13/8 (#3664-tråden): medianlofter 9–46, præcis **én** 99'er i hele spillet. Skalaen lover en top ingen kan nå. ⏳ Hører til i landing 1's besked om hvorfor 99 står tom |
| **H** | Hero'en | "Potential · ceiling" ved siden af "Rating /99" | To skalaer, ét ord | Stjerner (1–6) og rating (1–99) side om side. ⏳ **#2454 lukker den** |
| **J** | `training.focusGuideGating` (45 % / 12 %) | Neutral fit ≈ 45 %, modsat type ≈ 12 % | **JA — verificeret** | [`riderProgression.js:70-71`](../../backend/lib/riderProgression.js): `neutralFactor: 0.45`, `oppositeFactor: 0.12`. Lad stå |
| **L** | `training.focusCappedTitle` / `focusPartiallyCappedTitle` | "reached its lifetime ceiling and will not rise again" | **JA** | Loftet er hårdt. Lad stå |

## Beviset for loft-båndets øverste kant

Fra [`scoutingReport.js:47-61`](../../backend/lib/scoutingReport.js):

```
ceilHi = ceilTruth + bias + half,   bias ∈ [−0,5·half, +0,5·half]
      ⇒ ceilHi ≥ ceilTruth + 0,5·half
```

Øverste kant ligger **altid mindst en halv halvbredde over sandheden** og kan aldrig ramme den. Nederste kant ligger altid under (clampet op til `now`, som per konstruktion aldrig overstiger `ceilTruth`, fordi caps ≥ abilities elementvis).

**Konsekvens:** *"et sted herinde"* er bogstaveligt sandt. *"kan nå op til"* er bogstaveligt falsk, hver eneste gang. I dag kan 99-clampen maskere det i toppen; efter landing 1 (max ~85) forsvinder clampen, og overdrivelsen bliver undtagelsesfri.

**Vigtigt for #3667's copy:** skriv aldrig *hvor* inde i båndet sandheden ligger. At sige "øverste kant er tegnet over sandheden" skærer op til en tredjedel af intervallet væk og er en lækage mod `scoutingInversionHarness` (#1543/#1162). Formuleringen fra 13/8 — *"et sted herinde"* — er præcis den rigtige balance: den afviser den forkerte læsning uden at indsnævre den rigtige.

## Målinger mod prod (read-only, 13/8)

| Måling | Resultat |
|---|---|
| Menneskehold i alt | 202 |
| Uden ansat chefscout (effektiv overall = 40) | **149** (73,8 %) — niveau 3 køber matematisk nul |
| Med effektiv overall < 60 | **192** (95,0 %) — niveau 3 køber ≤ 0,5 rating-point |
| Gennemsnitlig effektiv spejder-overall | 42,6 |
| Målrettede jobs købt til niveau 3 | 15, i alt 15.000 CZ$ |
| — heraf fra hold **uden** chefscout | **0** |

Sidste række er den vigtige nuance: **ingen har endnu betalt for nul.** Alle 15 niveau-3-køb kom fra hold der havde ansat en spejder, så de fik alle en smule. Løftebruddet er reelt, men det har ikke kostet nogen penge endnu. Det gør #3671 til en fejl der skal rettes før den bider — ikke en der kræver oprydning bagud.

(#3671 opgør 150/203; forskellen er ét hold og skyldes at målingerne er taget med et par timers mellemrum. Konklusionen er den samme.)

## Hvad denne audit IKKE dækker

- Akademiets tilbudskort, sammenlign-siden, watchlist og auktionstabellen viser potentiale gennem samme `ScoutablePotentiale`-komponent og arver derfor **B** og **H** — men deres egen omkringliggende copy er ikke læst igennem.
- Række **E**'s skævhed er identificeret, ikke kvantificeret.
- Række **A** og **I** kræver måling mod den nye skala og kan ikke afgøres på dagens formel.
- Navnesammenfaldet (`sprint` som evne / træningsfokus / ryttertype, #3649 lag 2) er ikke en usand påstand og optræder derfor ikke i tabellen — det hører til i #3667's kommunikationspakke.

## Rækkefølge

1. **Nu (denne PR):** B, C, F — sande løgne i dag, uafhængige af skalaen.
2. **Med #3666 + #2454:** D, H, K, og målingerne bag A og I.
3. **Efter måling:** E, G.
