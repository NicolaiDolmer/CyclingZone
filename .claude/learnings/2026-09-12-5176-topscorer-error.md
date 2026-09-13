# #5176: afviste resultat-reads må ikke ligne tomme resultater

CodeRabbit fandt ved review af #5183, at ResultaterPage kun kontrollerede to
af tre Promise.all-svar. getTopRiderRankings returnerer `{ data: null, error }`,
så en backend-fejl blev behandlet som en tom topscorer-liste.

Fix: kast topRiderStatsRes.error til sidens eksisterende fejl/retry-visning.
En Playwright-test giver endpointet 500 og derefter 200 ved retry. Den fejlede
mod den gamle kode og bestod på desktop/Android efter rettelsen.

Testens locators følger den faktiske DOM: ErrorState viser sin titel som et
afsnit; rytterlinkets accessible name indeholder også nation, hold og point.
Brug ikke et antaget heading-tag eller et for snævert linknavn.

Kontrollér hver fejl i parallelle reads, før et manglende datasæt bliver til `[]`.
