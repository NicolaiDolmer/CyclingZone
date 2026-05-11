# 2026-05-11 — Multer upload security (#295)

## Trigger
Dependabot havde high alerts på `multer` i backend, mens admin-resultatupload stadig brugte `multer@1.4.5-lts.1`.

## Læring
Security dependency bumps på upload-middleware skal verificeres på middleware-niveau, ikke kun i handler-tests. `adminImportResultsHandler`-tests beviser kun `req.file.buffer`-kontrakten efter multer har kørt; de beviser ikke at multipart parsing, form fields og fileFilter stadig virker efter major upgrade.

## Fremtidig regel
Når en parser/middleware dependency opgraderes, tilføj en minimal Express/multipart regressionstest tæt på konfigurationen. For admin-resultatupload betyder det: `file`, `race_id`, `stage_number`, memory buffer og afvisning af ikke-Excel filer.
