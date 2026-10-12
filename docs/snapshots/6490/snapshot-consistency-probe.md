# Native snapshot-probe, #6490 M3

Lokal PostgreSQL 17.11, separat tom fixture-database, 12/10. Ingen remote data.
En controller holder en eksklusiv advisory-barriere. Readeren starter én SELECT
med en materialiseret gate-CTE og en datatabel, og gaten venter på en kompatibel
shared lås. `pg_blocking_pids` bekræfter ventetilstanden. En anden session ændrer
tabellens ene tal fra 0 til 1 og committer, før controlleren slipper barrieren.

```sql
CREATE FUNCTION fixture_guard() RETURNS int LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(6490,3);
  RETURN (SELECT n FROM fixture_snapshot);
END $$;
WITH gate AS MATERIALIZED (SELECT fixture_guard() AS checked)
SELECT json_build_object('guard',gate.checked,'data',d.n)
FROM gate CROSS JOIN fixture_snapshot d;
```

Faktisk resultat med VOLATILE: `{"guard":1,"data":0}`.
Samme test efter nulstilling og STABLE: `{"guard":0,"data":0}`.
VOLATILE-funktionens indre læsning kan altså se en nyere commit end den omgivende
SELECT. Det er ikke tilstrækkeligt til at certificere dens payload.

M3's private recovery-snapshot bruger derfor en særskilt STABLE boolean-gate,
som kontrollerer pair-paritet i callerens snapshot. Den returnerede boolean bruges
i WHERE, så kaldet er nødvendigt for resultatet; fejl kaster exception. Den normale
backfill/readers-gate og dens void-output er uændret. Native regression af den
faktiske gate tilhører den samlede L4-genverifikation.

Serveren blev stoppet efter proben. Dette er et afgrænset snapshot-bevis, ikke
kapacitets- eller produktionsgodkendelse. SSOT: [TRAINING_RULES](../../TRAINING_RULES.md).
