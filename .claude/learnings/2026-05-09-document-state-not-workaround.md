# 2026-05-09 · Dokumentér tilstand i DB — undgå kode-workarounds

## Situation
Slice 08 startede med 93 ryttere låst i `pending_team_id`-limbo. v2.89 introducerede pending-flow som en bug-fix: hvis transfervindue var lukket → læg rytteren i pending. Men i sæson 0 (open beta transfer-fase) eksisterede der **ingen `transfer_windows`-row overhovedet** — så `getTransferWindowOpen()` returnerede `false`, og pending-flowet aktiveredes.

Resultatet: managers vandt auktioner men "fik ikke" rytteren med det samme. Forvirrende UX.

## Den naive løsning (jeg overvejede først)
Ændre `getTransferWindowOpen()` til at også returnere `true` hvis aktiv sæson har `number = 0`:

```js
return latestWindow?.status === "open" || activeSeason?.number === 0;
```

Det virker men er en brittle dual-condition: hvilken kilde er sandheden — sæson-nummeret eller transfer_windows-tabellen?

## Den rigtige løsning
**Dokumentér tilstanden i databasen.** Sæson 0 ER per definition et åbent transfervindue (open beta-fase). Indsæt en `transfer_windows`-row med `status='open'`:

```sql
INSERT INTO transfer_windows (id, season_id, status, opened_at, created_at)
VALUES ('00000000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000000', 'open', '2026-05-08T18:00:00Z', NOW());
```

Resultat: zero kode-ændringer i `auctionFinalization.js`, `transferExecution.js`, `marketUtils.js`. `getTransferWindowOpen()` finder den nye row og returnerer korrekt `true`. Alle 15 callsites virker konsistent uden dual-condition.

## Lære
- **Hvis runtime-state ikke matcher kodens forventning, er det ofte data der mangler — ikke kode der skal ændres.** Tjek først om der er en row der burde eksistere.
- **State-tabeller (windows, status-rækker) skal afspejle sandheden.** Hvis sæson 0 ER en transfer-fase, skal det stå i `transfer_windows`. Punktum.
- **Workarounds i kode skaber dual sources of truth.** Det fører til divergens, regression, "hvilken er rigtig?"-spørgsmål måneder senere.

## Genbrug
Pattern kan replikeres for:
- `seasons` med `status='active'` på 0 rækker → opret én før kode antager der findes en aktiv sæson
- `loan_config` defaults — i stedet for hardkodede values i JS, har vi en row med konfiguration
- `auction_timing_config` — samme princip; runtime-config bor i DB

## Anti-pattern at undgå
```js
// SLEMT: dual condition, hvilken vinder?
const isOpen = (await getTransferWindowOpen(supabase)) || (await getActiveSeason()).number === 0;

// GODT: én kilde til sandhed
const isOpen = await getTransferWindowOpen(supabase); // table reflects truth
```
