# Natsession 6/9 (ca. 01:30 til 06:30): løbsmotor v4 byggekø + Supabase-hygiejne

> Designet med ejeren 5-6/9. Kører i den AKTIVE session (cyclingzone-65) med fire workers i gang; denne fil er kontrakten og fallback hvis sessionen dør. Starter en ny session herfra: læs `docs/NOW.md`, `docs/RACE_ENGINE_RULES.md` §9 og `docs/superpowers/specs/2026-09-06-race-engine-v4-flip-and-tactics-design.md` først, og tjek `git worktree list` + `gh pr list --state open` for hvad der allerede ligger.

## Mandat (ejer 6/9, ordret valgt i beslutningskort)

- **Merge selv:** ALLE backend-PR'er på de låste beslutninger + Supabase-hygiejne når CI er grøn, inkl. migrationer der er default OFF (flag) og #4870 (revoke af tre metrics-RPC'er). Post-verify hver migration i prod og skriv det på issuet. Én merge ad gangen, `--squash --admin`.
- **Venter på ejeren (ordret "merge"/"kør"):** alt UI og alle tekster (intention-UI, taktik-kort, help.json, patch note), flag-flip i prod, datareparation (#4865 de 11 bonus-mål, #4857 backfill), kalender. Byg dem færdige til preview med rigtige screenshots og tal, og læg dem i morgenrapporten.
- **Aldrig:** flip `race_engine_v4` eller andre flag i prod; gen-tænd et pauset live-system; post spillerbeskeder; skær scope pga. tid; `gh` bag `cd`.
- **Loop-guard:** 2 CI-fails på samme symptom → stop den PR, skriv issue, gå videre. Worker tavs 45 min → status; +15 → stop og genstart med snævrere brief.
- **Én motor:** al motor-logik i `backend/lib/engine/v4`; "bygget" og "koblet ind" er to kolonner.

## Rækkefølge

1. **Sentry 7-dages-triage** hvis `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d --limit=50` virker (ejeren kører `infisical login` før afgang). Issues for det der ikke er håndteret, dubletsøgning først.
2. **v4-køen, PR 1-4** (kører): flip-infrastruktur, intention-backend, uheldstrappen, tidsgrænsen. Verificér hver diff mod beslutningen i RULES §9 (ingen ny motor, ankre ikke røde, flag off), merge når grøn, done-flip issues (#4632 delvist: backend), post-verify migrationer.
3. **Paritets-bølge som workflow (ultracode), efter PR 1+3+4 er inde** (samme filer): bonussekunder (v4's egen mekanik, laget uden for motoren gates AF når v4 er on, paritets-tjek af point/trøjer i harness), indsats M12 koblet på det fem-trins-enum, holdspil (hold-id ind i kontrakten additivt, kaptajn beskyttes, hjælper koster), **holdtidskørsel koblet ind** (ejer: med i natten), vejr, brosten/grus, distance-slid. Én PR pr. mekanik, harness-måling (3 seeds) i hver PR-body: ankre må ikke blive røde. Merge én ad gangen.
4. **Ordre-kæden lukkes** (ejer: ja): adapteren kaldes fra v4's kaldssted, rollen bliver standardordren, sprint-tog får et felt i ordre-kontrakten, rollefeltet fjernes fra ordren (ejer 27/8). Taktik-kortet i appen bygges færdigt til preview (ingen merge).
5. **Rute-huller, alle seks** (ejer: A): sektorer tæt på mål i rutegeneratoren, v4 læser `sectors`, brostens-mekanik ind, enkeltstarters 80 hm, verifikation af de seks på rigtige S3-ruter i harnesset.
6. **Bjerg-kalibrering + gate-pin** (#4707): population + seeds låst i en npm-kommando, aggregeringen rettet (tre måletal mangler i opslag), 5-seed-gate, sprinter-populations-følsomhed dokumenteret.
7. **Intention-UI (variant B)** på PR 2's kontrakt: holdudtagelsen med etape-vælger, rolle = standard, intention = overlay; desktop + Android-bredde; alle 3 Playwright-projekter lokalt; screenshots til morgenrapporten. Ingen merge.
8. **Fyld mens CI kører:** #4868 (upsert ignoreDuplicates + scorecard readonly-forsøg væk), #4870 (revoke-migration + matview-kolonner mod fog of war), #4869 (maybeSingle + RLS-tjek på users), #4865 rod-årsag (hvilken skrivesti taber `source: bonus_offer`-mål; hvem lavede bulk-skrivningen 5/9 16:05) + forward-guard + reparations-script i dry-run med de 11 holds tal, klar til "kør".
9. **Doc-reparation:** de 21 modsigelser i RACE_ENGINE_RULES.md rettet til målt tilstand, ankertabellen genereres af harnesset.
10. **Close-out (senest 06:30):** samlet patch note-UDKAST i `docs/drafts/` (ikke i appen), help.json-udkast for intention/uheld/tidsgrænse (ikke merget), NOW.md ≤1.200 tokens med 🎯 Next action + Working agent nulstillet, done-flips, GitHub-issues for alt uafsluttet, `scripts/check-agent-token-hygiene.ps1`, og ÉN kort besked i chatten: merget / venter på "merge"/"kør" med billeder og tal / ikke nået.

## Låst, genåbn ikke

RULES §9 (seks beslutninger), bonussekunder = v4's egen mekanik som eneste kilde når v4 er on (ejer 6/9: bedste langsigtede valg, motoren skal producere alle hændelser så løbet kan ses live), træning #4850-#4854, S4-kalender ikke i DB før #4845, #4801 venter, #4789 anden session, #4835 venter på AUTO_MERGE_PAT, PR #4864 gennemgås med ejeren.
