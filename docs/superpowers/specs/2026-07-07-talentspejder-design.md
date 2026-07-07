# Talentspejder-system — design (ejer-låst 2026-07-07)

**Afløser interim scout-knappen (#1138 L1). Paraply: #1543. Relateret: #2000 (rytter-side), #2100 (loft-projektion), #27 (gemte filtre), #2216 (staff-motor), #1162 (inverterbarheds-gate).**

## Ejer-låste beslutninger (Q&A-session 2026-07-07)

1. **Talentspejderen er en staff-person** bygget på staff-motoren (#2216): evner (fx Bedømmelse, Netværk), speciale (ryttertype × aldersgruppe/niveau), løn, klikbar profil. To opgavetyper: **målrettet** ("undersøg denne rytter") og **missioner** ("dæk U23-løb i land X / division Y / nationale mesterskaber i N uger"). Spejderen har igangværende opgaver og melder løbende fund ind.
2. **Omkostning: ingame-penge + kapacitet + tid.** Opgaver koster rejseomkostninger (ingame), spejderen har begrænset samtidig kapacitet (1–2 opgaver), og rapporter modnes over dage (hænges på eksisterende daglige ticks). Fair-premium = *rigtige* penge køber aldrig viden; ingame-penge er en bevidst prioriterings-mekanik så ikke alle ved alt om alle.
3. **Spejder-kvalitet styrer præcision — og INGEN når 100%.** Bedre spejder ⇒ smallere bånd. En middelmådig spejder har et præcisions-loft (fx ★★★–★★★★ for evigt). Selv topspejderen ender med et lille rest-bånd (~±0,5 stjerne). Alle kan tage lidt fejl; ingen er komplet forkert. To managers kan vurdere samme talent forskelligt (per-manager/spejder-bias, allerede seedet i `scouting.js`).
4. **Usikkerheden gælder OGSÅ egne ryttere** — smallest bånd (egen stab kender rytteren bedst), men aldrig eksakt tal. Synlig ændring vs. i dag (egne = eksakt) → patch notes + help.json.
5. **Én spejder pr. hold i v1.** Datamodel designes til flere senere (scouting-facilitet / division), men UI/balance shipper med én.
6. **Mission-output = shortlist (3–5 navne, uden potentiale-tal) + én gratis niveau-1-rapport på topfundet.** Loop: mission → fund → målrettet scouting → beslutning. Shortlist-udvælgelse blandes med spejder-bias så den ikke lækker potentiale-rangering.

## Tilstande (rytter set af ikke-ejer)

- **Før:** "Ikke scoutet" — intet potentiale, intet loft-hint (allerede live server-side, `buildScoutEstimate` → `{hidden:true}`).
- **Under:** "Spejderen arbejder — rapport om N dage" (ny job-tilstand).
- **Efter (niveau 1→3):** verdict i klart sprog + fuzzy stjerne-bånd + per-ryttertype loft-bånd (genbruger #2100-mekanik) + Røverkøb-kort (design-SSOT Scouting-fanen). Båndbredde = f(niveau, spejder-rating, rytter-alder). Niveau 3 = spejderens minimums-bånd, aldrig eksakt.
- **Egne ryttere:** som niveau 3 med smalleste bånd.

## Arkitektur-skitse

- **Backend:** `scout_actions`-ledgeren udvides med job-model (`scout_assignments`: type mission/target, status, klar-dato, cost). Estimat-beregning forbliver server-side i `backend/lib/scouting.js`; ny input: spejder-rating → halvbredde-gulv (`minHalfWidthByScoutRating`). Egne ryttere: `effectiveLevel = maxLevel` bevares, men eksakt-branch erstattes af smalt bånd.
- **Spejder-entitet:** genbruger #2216's staff-tabeller/derivation (ny rolle: Talentspejder; specialiserings-akser: ryttertype × niveau).
- **Frontend:** Scouting-central (ny side/Klub-flade) + `RiderScoutingTab` (design-SSOT) + shortlist-feed. Gemte filtre (#27) føder missions-/shortlist-kriterier.

## Gates (obligatoriske)

- **Inverterbarhed (#1162):** alt output (bånd, shortlist, loft-projektion) gennem `potentialeHiding.routes.test.js`-mønsteret. Rest-båndet må ikke kunne inverteres — heller ikke ved gentagen scouting eller på tværs af spejder-ratings.
- **Simulate-before-ship:** balance-harness for båndbredder (rating × alder × niveau) mod ægte population + scorecard; rejseomkostninger gennem økonomi-scorecards. Ejer-review før merge.
- **Æstetik:** editorial, Bebas, ægte cykel-data, 0 AI-slop; design-SSOT `docs/design/design_handoff_rider_profile/` er pixel-referencen for Scouting-fanen.

## Faseplan (hver fase = egen PR)

1. **Fase 1 — Scouting-fane** (#2000-slice): backend per-ryttertype-estimat + verdict + `RiderScoutingTab`. Kører på eksisterende slots-model; bånd-i-stedet-for-eksakt (beslutning 3+4) indføres her.
2. **Fase 2 — Loft-projektion** (#2100): fuzzy loft-bånd + projektion i Udvikling-fanen, server-side.
3. **Fase 3 — Talentspejder-systemet:** staff-rolle på #2216 (afventer/bygges sammen med staff-motoren), job-model (missioner + målrettet, tid + rejseomkostninger), scouting-central, shortlist-feed, spejder-rating → præcision. Afløser slots-modellen; migrationsplan for eksisterende `scout_actions`.
4. **Fase 4 — Gemte filtre** (#27): CRUD + kobling til missions-kriterier. Uafhængig; kan bygges parallelt.

## Åbne detaljer (afklares i implementeringsplan, ikke blokerende)

- Konkrete tal: rejseomkostninger, missions-varighed, kapacitet (1 vs 2 samtidige opgaver), rest-båndbredder pr. spejder-rating — fastlægges via balance-harness + ejer-review.
- Migrationsstrategi: hvad sker med eksisterende scout-niveauer når spejder-modellen tager over (foreslået: bevares som niveau, båndbredde genberegnes med default-spejder).
- Verdict-copy (EN først, DA under) — tone-session før ship.
