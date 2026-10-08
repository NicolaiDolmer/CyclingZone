# 2026-10-06 · To Supabase-udfald + langsomt merge-tempo

## Hvad skete
- 12:59 og 15:21 (dansk tid): Postgres stoppede. Først hård genstart på 1 min, så frys uden selvgenstart (ejeren genstartede 15:45). 40-80 % 5xx 15:25-15:45.
- Small-instans (2 GB). Stablede fuldtabel-læsninger: rangliste-refresh hvert ~8. min (12-22 s), `feature_liveness_table_counts` ved HVER PR-push fra CI (59 gange på en dag, 12-17 s), indeksbyg på 1,9 mio. rækker.
- Indeks-migrationen fra #6196 ramte statement_timeout efter 2,5 min og efterlod et INVALID indeks.

## Rod-årsag
Vores egen udviklingstrafik (CI-audit på pull_request) ramte prod-databasen, og flere parallelle bølger ganger det op. Ovenpå en for lille instans og en rangliste på uret.

## Hvad jeg tog fejl af undervejs
- Påstod "disken drosles" ud fra checkpoint write=270 s. Det er normalt (spredt over checkpoint-vinduet). Tjek hvad et tal betyder, før det bliver en forklaring.
- Mistænkte deploys. Kun 1 af 5 faldt sammen. Slå tidslinjen op før hypotesen nævnes.

## Tempo-fejl (ejer: "du har været ret langsom")
- Startede to merge-køer for samme PR og en ventende kø oven i en kørende (bryder "én merge ad gangen").
- Ventesløjfe der ventede på "ingen pwsh kører": Codex kører altid pwsh, så den stod 30 min. Start køen direkte, når den forrige har meldt færdig.
- Bølge startet fra `frontend/` → ingen admission. Kald `Workflow({name:"wave"})` fra repo-root.
- Skrev bølge-scope for #6237 uden at læse ejerens seneste kommentar ("kun scout") → PR måtte skæres ned.
- `cd X &&` foran allowlistede kommandoer → klassifikator-afvisninger og ejeren blev sendt i terminalen.

## Forebyggelse
- #6267: PR-audit tæller ikke prod. Ny hovedregel: intet CI-job må køre tunge forespørgsler mod prod; brug staging.
- #6265: CONCURRENTLY-migrationer på store tabeller sætter `statement_timeout` (20 min, ejer-valg) i sessionen.
- #6272 alarm, #6276 ugentlig måling, #6274 pooling/caching, #6275 lasttest.
- Hard rule 35 udvidet (ejer 6/10) så motor bag slukket revision, ops/infra og Dependabot-sikkerhed merges uden go-kort.
