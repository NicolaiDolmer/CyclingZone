# Agent postede bruger-e-mail i offentlig issue-kommentar (4/8, dagbølge)

**Hændelse:** En read-only investigations-agent (#3189, Clarity-verifikation) inkluderede en rigtig brugers e-mailadresse i sin rapport-kommentar på et offentligt synligt GitHub-issue. Fanget af harness-sikkerhedsflagget ("Excess Sensitive Detail") i agentens slutresultat — IKKE af noget af vores eget værn.

**Remediering (samme time):** Kommentaren blev SLETTET via API (ikke redigeret — GitHub-edit-historik er offentligt synlig, så redigering fjerner ikke lækken) og genpostet i renset form med ærlig note om hvorfor.

**Rod-årsag:** Agent-prompts for investigations krævede "tal + SQL + kodereferencer" men sagde intet om brugeridentitet. Prod-data indeholder e-mails/navne; en agent der citerer sine SQL-resultater ordret lækker dem naturligt.

**Læringer/guards:**
1. **Alle agent-prompts der (a) kan læse prod-data OG (b) poster til GitHub/Discord/andet offentligt, SKAL indeholde privacy-linjen:** "rapporten er offentlig — aldrig e-mails, navne eller anden brugeridentitet; brug anonymiserede id-fragmenter". Indført i recovery-agenterne samme dag.
2. **Ret aldrig en læk med kommentar-EDIT** — slet + genpost (edit-historik er offentlig).
3. Kandidat til teknisk guard: udvid tone-/leak-checket eller en pre-post-hook til at scanne udgående gh-kommentar-bodies for e-mail-mønstre (modstykke til sanitize-secrets, som kun kigger på INDGÅENDE tool-output). Ikke bygget endnu — vurdér ved næste ops-slice.

Refs: #3189 (kommentaren), #3317 (beslægtet: hook-falskpositiver — begge peger på at leak-værnet skal se på retning OG mønster-kvalitet).
