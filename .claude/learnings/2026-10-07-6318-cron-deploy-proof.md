# #6318: grønt deploy er ikke cron-bevis

Et successful deployment og en passing smoke beviser ikke, at et berørt cron-job
stadig ticker. Desuden skriver boot-priming til samme heartbeat-kolonne som ticks.

Recovery bevarede den tidligere patch og tilføjede RED regressioner før integration:
første friske snapshot blev accepteret, extensionless import-hul blev ignoreret,
tom diff blev accepteret, workflow-gaten manglede, og smoke alene gav verified.

Gaten bruger registry-SSOT, transitive source-roots, target-SHA checkout og en
UTC-grænse efter positiv Railway-observation. Første snapshot og observerede
timestamp-kohorter udelukkes. Manglende/ulæseligt bevis fejler; lange kadencer
rapporteres deferred, aldrig verified. Se DEPLOYMENT.md for read-only-bevisets begrænsning.

Opus-review (8/10) fandt at deferred stoppede køen med exit 75 efter næsten
hver backend-PR, fordi fælles filer rammer alle jobs inkl. time/døgn-kadence, og
intet vendte deferred til verified. Lære: et gate-udfald der ikke kan opløses
inden for køens horisont må ikke være blokerende. Nu kræves kun korte kadencer
(≤ 30 min); lange vises og dækkes af heartbeat-vagten. Samme review: bevis skal
starte efter Railway-drain (gammel proces kan stadig tikke), heartbeat-læsningen
skal filtreres/sorteres, en tom commit må ikke gøre deploy-verify rød, og køens
timeout skal ligge over jobbets egen timeout.

Ingen spillerændring: patch notes og feature-registry er ikke relevante.
