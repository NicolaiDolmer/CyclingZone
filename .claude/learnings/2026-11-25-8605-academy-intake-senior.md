# #8605 · Akademioptag med ledig seniorplads

Optagslisten i backend og kortets kapacitetsberegning stoppede ved U23. Begge prøver nu senior efter de eksisterende aldersbestemte muligheder. En seniorplacering er underlagt samme reserverede pladser og samlet klubloft som øvrige tilgange.

En optaget senior har stadig `is_academy=false`. Tilbudsrækken skal derfor låses og afsluttes i samme transaktion som ejer- og finansændringen, også for gratis optag. Et afslag må kun liste rytteren, hvis det faktisk ændrede et åbent tilbud.
