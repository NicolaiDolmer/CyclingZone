# #5904: hold SQL-data adskilt fra proceslog

FULL-refresh blev stoppet før import, fordi credential-wrapperens driftslog blev
gemt sammen med SQL-rækketal. Den strenge parser afviste korrekt filen.

Rettelse: redirect kun psql stdout ved kilden til en midlertidig fil. Bevar
stderr og wrapper-log som diagnostik, nonzero-exit som fejl og parserens regex.
Samme indgang bruges til counts, schema-fingeraftryk og privacy. Filen slettes
ved både succes og fejl.

Regression: blandet wrapper-stdout/SQL-stderr med gyldige SQL-tal består;
forkert SQL-format, forkert antal og nonzero-exit afvises. Fuld runtime-refresh
udestår merge; ingen spillerændring eller patch notes er nødvendig.
