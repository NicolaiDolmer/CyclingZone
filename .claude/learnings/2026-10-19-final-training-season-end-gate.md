# Sidste træningsdato før season-end (#6898)

- Trigger: S4 afsluttes 25/10 før datoens træning har dokumenteret afregning.
- Rodårsag: season-end kontrollerede løb, men ikke træning. Nye træningsdatoer opdages kun for active sæson; fraværende registreringer kan derfor forsvinde fra sweepens arbejdsindeks.
- Rettelse: læsende fail-closed gate før season-end-claim/writes og aktive transitioner (også force/scripts); alle registreringer terminale og ingen manglende aktive hold med ryttere. Ingen replay eller migration.
- Kontrakt: docs/TRAINING_RULES.md, sidste dato før sæsonafslutning. Design-go: #6898 + ejerens direkte bestilling 19/10.
- Testbevis: faste lokale SQL-fixtures 25/10/2026 kl. 20 Copenhagen; alle færdige, pending, partial, ingen registreringer, pagination, læsefejl og rutens stop før claim.
- Læring: afregningsbevis kræver både terminale eksisterende rækker og en uafhængig forventet population. Tomt arbejdsindeks er ikke færdigstatus.
- Afgrænsning: ingen prod-data, DB-migration, spillertekst, flag eller ny kernefeature. FEATURE_REGISTRY uændret.
- Patch-note-undtagelse: intern admin-readiness-vagt; ingen ny spillertekst eller spillerfunktion. Eventuel samlet spillerkommunikation forfattes af Claude.
- Lokal SQL-fixture: 27/27 bestået med isoleret PGlite 0.3.14/PostgreSQL 17.5 og 27/27 med repoets PostgreSQL 18.3. Repoets dependencies er uændrede; PG17-pakken ligger kun i midlertidig mappe.
- Review: uafhængig reviewer fandt force-omgåelse; regression reproduceret og kernegate tilføjet før første transition-write. Opfølgende review: ingen handlingskrævende fund. Samlet målrettet readiness/transition: 126/126 bestået.

## P1-opfølgning: aktiv S4 har end_date = null

- Den første fixture gav S4 en end_date, som den aktive sæson ikke har. Det skjulte en permanent blokering.
- Sidste træningsdato afledes nu af sæsonens sidste planlagte etape i Copenhagen via et season-scoped, begrænset kalenderopslag. end_date bruges aldrig som kalenderbevis.
- Hovedfixturen bruger end_date null; tests dækker færdig/pending/partial/manglende registrering, anden sæson, tom kalender, læsefejl, sen dato og Copenhagen-dato over UTC-midnat.

## Review-opfølgning: ét ur for transition og settlement

- Settlement brugte deps.now eller maskinuret, selv når transitionAt var givet. Det kunne afvise en deterministisk transition som fremtidig.
- Gaten bruger nu en Date fra samme normaliserede transitionAtIso som resten af transitionen. Intet ekstra vægur-opslag eller særskilt deps.now-override.
- Syv nye faste regressioner var røde før rettelsen: 25/10 kl. 21 Copenhagen som Date/ISO mod simulerede maskinure før/efter datoen samt et modstridende legacy deps.now. Ingen global Date-mutation eller læsning af faktisk vægur i testene.

## Review-opfølgning: force-audit efter settlement

- Ruten skrev MANUAL_OVERRIDE før kernens settlement-vagt. Uafregnet træning gav derfor en falsk force-audit og HTTP 500.
- Force-auditten udføres nu via kernens beforeTransitionWrites-hook efter samme settlement-vagt, før øvrige writes. Ingen dobbelt pre-check med et nyt afvisningspunkt efter auditten.
- Kernens forventede afvisning har fejlkoden training_settlement_blocked. Ruten svarer 400 med vagtteksten før generel exception-/fejlaudit-logning.
- Integreret route/kerne-fixture beviser pending, partial og manglende registrering: 400 og nul audit-/transition-writes; succes har rækkefølgen settlement, force-audit, transition-write. Dry-run og audit-skrivningsfejl dækkes også.
