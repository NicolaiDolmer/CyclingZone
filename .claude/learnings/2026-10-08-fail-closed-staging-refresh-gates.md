# 8/10-2026: Staging-refresh skal fejle sikkert, ikke fortsætte halvt (#6229)

## Hvad skete
Det første refresh-script kørte to `pg_restore`-kald, så ingen reel sammenligning og meldte
ubetinget GO. En afbrudt eller delvis import blev derfor ført videre som "gjort" (se
`2026-10-05-staging-restore-afbrudt-og-rensning-fejlede.md`). Det første udkast til rettelsen
(#6297) havde kun fire hjælpe-gates og ingen test af selve forløbet.

## Hvorfor
- Gates var ikke koblet til forløbet: en grøn hjælpe-test beviste ikke, at scriptet brugte den.
- Rensningen slog triggere til igen midt i transaktionen, så den kunne skabe nye rækker efter
  trunkeringen.
- psql-fejl kan ekko rækkedata (DETAIL/CONTEXT) til konsollen.
- `-SkipDump` kunne genbruge et halvt dump uden bevis for, at det var færdigt.

## Regler fremover
- Et refresh-trin med en gate skal testes som forløb: fingeraftryk, rækketal, privacy sidst, og
  intet GO hvis en tidligere gate kaster.
- Hele importen er én transaktion; kontrollér før start at ingen inputfil selv styrer
  transaktioner, og at filrækkefølgen er guard, auth, public, rensning.
- Vis aldrig rå psql-fejl fra en database med persondata; filtrér til ERROR/FATAL og mask nøgler.
- Genbrug af et dump kræver en markør, der først skrives, når alle dumps er færdige.

Refs #6229 #5904
