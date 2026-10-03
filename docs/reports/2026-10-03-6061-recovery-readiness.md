# #6061: recovery-forberedelse 3/10

SSOT: [TRAINING_RULES](../TRAINING_RULES.md), førstegangstilstand og atomisk datoafregning; [PROGRESSION_RULES](../PROGRESSION_RULES.md), udvikling og lofter.
Ejer-go i Codex 3/10: forebyg og forbered genopretning. Intet go til prod-skrivning.

Read-only inventar gennem 2/10: 20 ryttere, 10 hold, 151 unikke uafregnede rytter-løbsdage. Datoerne har henholdsvis 45, 10, 50 og 46 unafregnede slots fra 29/9 til 2/10. En manglende kvittering er ikke bevis for et tabt træningspas: slots kan være løb eller hvile. To ejer-rækker på samme slot krediteres aldrig dobbelt.

Otte aktuelt ejede ryttere er førstegangskandidater; eksisterende tilstand, tidligere aktiviteter, holdskifte og fravær af ejerskab er separate review-klasser. Trigger-installation retter ingen af disse historiske datoer.

Ejeren valgte 3/10 kompensation med nuværende planer og motor. Frosne opening conditions mangler i berørte datoer, og der findes ingen historiktabel for træningsplaner. Beregningen er derfor en godkendt kompensationspolitik, ikke en præcis historisk rekonstruktion. Gemte resultater og oprindelige start-snapshots afgør løb/hvile uafhængigt af belastningsregistrering og nuværende division.

Privat manifest og kildeudtræk: OneDrive-context/private-recovery/6061. Den lokale balance-internals-kopi er en cache. Den nye prepare6061TrainingRecovery.mjs er read-only, kræver eksplicit cutoff og as-of og afviser --apply. SQL- og SDK-udtræk giver samme anonyme facit.

Endelig beregning efter review: 16 aktuelt ejede ryttere, 130 slots og 19 dokumenterede løbsudviklingsdage; fire ryttere kræver ejerskabsefterkontrol. Individuelle gevinster og beregningsgrundlag er private. Komplette løbsopslag og 23 source-checks giver samme anonyme facit. Den præcise planfil og input er kopieret til privat OneDrive med verificeret identisk SHA-256.

Den forberedte SQL ligger i database/proposals og auto-deployes ikke. Den anvender kun evnekompensation. Eksisterende condition/skader bevares; manglende førstegangstilstand initialiseres kun uden anvendt aktivitetshistorik. Kun en aktuel, stadig uafregnet dato kan genoptages fra neutral tilstand. Historiske karantæner og tilstandsafregninger rekonstrueres ikke.

Skrivepakken kræver SHA-256 af den præcise private planfil og en separat ejer-godkendelse til produktion. Kilder læses før og efter beregningen; ændringer afviser planen. RPC'en tager korte tabel-låse og sammenligner kilde-rækker, evner, ejerskab og tilstand før atomisk skrivning. Konflikt/deadlock afviser hele transaktionen. Separat kvittering pr. rytter/sæson/løbsdag beskytter retry; en normal træningskørsel på samme slot afvises også og kræver efterkontrol. Kvitteringerne erstatter ikke almindelige træningsrapporter.

Verifikation: 23 kompensationsregressioner, herunder PostgreSQL rollback/retry/grants/kildedrift, grønne. Fuld backend: 12663 pass, 3 skip, 0 fail; preflight 0 lint-fejl/advarsler og token-hygiejne 0 fail. Uafhængigt review rent efter rettelse af løbsopslag, dato-loop, kildelåse, gemte bindinger og stabil paginering. Lokal writer-dry-run verificerer præcis fil-hash, 16 ryttere og 130 slots uden netværk eller writes. Tidligere fuld frontend-suite/build var grøn. Fuld lokal e2e havde 24 fejl; isoleret retry rettede 23, og den sidste sponsor-sprogfejl blev reproduceret på uændret main-kode. CI's syv e2e-shards på forebyggelsescommitten var grønne; liga-gaten var rød (#6115). Ingen påstand om grøn fuld lokal e2e. Ingen prod-skrivning er udført.

CodeRabbit 3/10: tvetydigt ejerskab, forbrugt load uden receipt og manglende condition med anvendt historik afvises nu i beregningen før skrivepakken dannes. Én ekstra rytter med ét slot udgår. Begge aktive hjælpelokaliteter beskriver førstegangstilstanden. Målrettede regressioner og uafhængigt gen-review er grønne; fuld verifikation genkøres på disse rettelser.
