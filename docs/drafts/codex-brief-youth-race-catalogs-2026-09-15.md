# Codex-brief: U23- og junior-løbskatalog (#4620 / #4621, bølge 4-forberedelse)

> Til Codex-session 15/9. Selvstændigt spor: rører KUN en ny SQL-migration + en JSON-fixture + `docs/CALENDAR_RULES.md` (nyt afsnit). Ingen kode i pakkeren (den bygges af Claude-bølgen). Eget worktree: `pwsh -File scripts/new-worktree.ps1 -Branch feat/4620-youth-race-catalog`. Læs `AGENTS.md` hard rules og `docs/YOUTH_RULES.md` §2.3 først. Commit kun bag `bash scripts/guard-commit-branch.sh <branch> <worktree>`.

## Ejer-beslutninger 15/9 (låst, spec `docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md` §10)

- **10.3:** eget U23-katalog, så tæt på virkeligheden som muligt, MEN navnene let ændret som spillets øvrige løb (rettigheder). Ordret: *"så tæt på virkeligheden som vi kan [...] ligesom vi gør inde i spillet, hvor vi laver navnene lidt om"*.
- **10.5:** 1-2 U23-løb om ugen; junior 1 om ugen (28 løbsdatoer i S4 → ca. 30-40 U23-løb, ca. 15-20 junior-løb inkl. reserve til pakkeren).
- Junior: kun sæsonalder 17-18 er løbsberettigede; kataloget må ikke indeholde løb over 5 etaper for junior (UCI-junior-format: endags + korte etapeløb 2-4 dage).

## Navne-konventionen (verificeret i prod 15/9, `race_pool`)

Spillets løb er genkendelige men omskrevne: "Tour de l'Ain Nouveau", "La Corsa dei Due Mari" (Tirreno), "Kasseienklassieker van Geraardsbergen", "Classique du Littoral", "Klassieker van Brugge", "Turul Carpaților", "Trofeo Camp de Morvedre Nuevo". Følg samme grad af omskrivning: stednavn + generisk løbsord på landets sprog, aldrig det registrerede varemærke ordret. Eksempler til U23: Tour de l'Avenir → "Tour des Espoirs de France"; Giro Next Gen → "Giro delle Nuove Leve"; Paris-Roubaix Espoirs → "Enfer du Nord Espoirs"; Ronde van Vlaanderen U23 → "Vlaanderens Mooiste Beloften"; Liège-Bastogne-Liège U23 → "La Doyenne des Espoirs"; Tour de Bretagne → "Tour de Bretagne Nouveau"; Thüringen Rundfahrt (U23) → "Thüringen-Rundfahrt der Talente". Junior: Paris-Roubaix Juniors, Tour du Pays de Vaud, Course de la Paix Juniors, Gent-Wevelgem Juniors, Trofeo Karlsberg, Giro della Lunigiana, Aubel-Thimister-Stavelot → tilsvarende omskrevet.

## Kolonner (`database/schema-snapshot.json`, `race_pool`)

`id, external_id, name, race_class, race_type ('single'|'stage_race'), stages, date_text ('d/m' eller 'd/m - d/m'), country, terrain_archetype, retired_at` + **ny kolonne `squad TEXT NOT NULL DEFAULT 'senior'` med CHECK (`senior|u23|junior`)** (additiv, idempotent). `race_class`-værdier i brug: `WorldTourA/B/C` (som `OtherWorldTourA` osv. i data), `ProSeries`, `Class1`, `Class2`, `Monument`, `GrandTour`. U23 bruger `Class1`/`Class2`/`ProSeries` (ingen WorldTour/Monument/GT); junior kun `Class2`/`Class1`. `terrain_archetype`-værdier: slå de eksisterende op (`select distinct terrain_archetype from race_pool`) og brug KUN dem der findes; fordelingen pr. tier skal ligge inden for samme komposition som senior (bjerg ca. 28 %, brosten, flad, bakket, ITT) så scorecardets tier-gate ikke fælder.

## Leverancer

1. `database/2026-09-15-4620-race-pool-squad-and-youth-catalog.sql`: idempotent (`ADD COLUMN IF NOT EXISTS`, `INSERT ... ON CONFLICT (external_id) DO NOTHING`), `external_id` med præfiks `u23-`/`jun-`. Realistiske `date_text` (U23-sæsonen ligger marts-september), `country`, `stages`.
2. `backend/lib/__fixtures__/racePoolCatalog.youth.json` med de samme rækker (samme form som `racePoolCatalog.prod.json`) til dry-run uden prod.
3. `docs/CALENDAR_RULES.md`: nyt afsnit "§16 Ungdomskataloger" med tabel (antal pr. klasse, terræn-fordeling, uge-tæthed) og henvisning til spec §4.4/§10.3.
4. Test: `node --test` på en lille testfil der læser fixture og verificerer: unikke navne, unikke external_id, ingen navne der kolliderer med senior-kataloget, terræn-værdier findes, junior ≤ 5 etaper, antal inden for 30-40 / 15-20.
5. PR (draft indtil grøn), `Refs #4620 #4621 #4845`, ingen patch note. Migrationen applies af CI ved merge (#2642); intet køres mod prod af Codex.

## Ikke i scope

Pakkeren, `league_divisions.squad`, `races.squad`, udtagelse, flader. Alt det bygger Claude-bølgen (spec §3-§7).
