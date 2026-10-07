# #6318: grønt deploy er ikke cron-bevis

Et successful deployment og en passing smoke beviser ikke, at et berørt cron-job
stadig ticker. Desuden skriver boot-priming til samme heartbeat-kolonne som ticks.

Recovery bevarede den tidligere patch og tilføjede RED regressioner før integration:
første friske snapshot blev accepteret, extensionless import-hul blev ignoreret,
tom diff blev accepteret, workflow-gaten manglede, og smoke alene gav verified.

Gaten bruger registry-SSOT, transitive source-roots, target-SHA checkout og en
UTC-grænse efter positiv Railway-observation. Første snapshot og observerede
timestamp-kohorter udelukkes. Manglende/ulæseligt bevis fejler; lange kadencer
rapporteres deferred, aldrig verified. Køen stopper og nulstiller ikke deres
grænse gennem automatisk rerun. Se DEPLOYMENT.md for read-only-bevisets begrænsning.

Ingen spillerændring: patch notes og feature-registry er ikke relevante.
