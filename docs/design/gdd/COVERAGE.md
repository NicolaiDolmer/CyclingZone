# GDD · Dækningsregister

[Til GDD](../../GAME_DESIGN_DOCUMENT.md) · Opdateret 10/9 2026.
Dette er et arbejdsregister over designspørgsmål, ikke en fejl- eller leveranceliste.
Ingen af nedenstående områder er samlet ejer-reviewet i denne samtale.

## Sådan registreres bevis

**Inventeret** betyder kun at området er identificeret. **Læst** kræver relevante
SSOT-afsnit. **Kontrolleret** kræver kilde, dato og kode/test/prod-bevis for den
konkrete påstand. **Diskuteret** kræver et ejer-svar. **Godkendt** kræver eksplicit
godkendelse af kapitlet og dets verifikationsplan. En stikprøve lukker ikke området.

Inventarets første grundlag: `frontend/src/App.jsx` ruter og `docs/FEATURE_REGISTRY.yml`
områder/feature-ID'er ved `3759ab2e639ffcb3f4888e105338a97aad63484e`, samt
`docs/META_DOCS_INDEX.md`. Ruteeksistens er ikke en påstand om live-tilgængelighed.
Senere kontrol skal også gennemgå baggrundsprocesser og funktioner uden egen rute.

## Områder

| ID | Område og designspørgsmål | Primære kilder under docs/ | Status i samtalen |
|---|---|---|---|
| G01 | Identitet, målspiller, managerfantasi og succeskriterier | Living World-doktrinen; #1145 | V-001, D-001 til D-008; ikke samlet reviewet |
| G02 | Onboarding, første beslutning, læring, hjælp og comeback | FEATURE_REGISTRY; App.jsx; #1140 | D-005: to indgange og let betjening; detaljer afventer |
| G03 | Besøgskadence, offline-spil, deadlines og assistance | ASSISTANT_RULES; PLANNING_CENTER_RULES; TRAINING_RULES | D-004/D-006: 2-3 besøg på 15-20 min; ASSISTANT_RULES §0-2 læst; E-001; D-007 om markedsaktivitet |
| G04 | Rytteridentitet, generation, egenskaber og typer | RIDER_GENERATION; PROGRESSION_RULES | PROGRESSION_RULES §0-10 læst; D-010 valgt; ingen samlet kode-/prod-kontrol |
| G05 | Træning, form, restitution, sygdom, skader og peaks | TRAINING_RULES; PROGRESSION_RULES | TRAINING_RULES §1, §12 og §13 læst; E-001; D-010; gammel støj-gate markeret afløst i PROGRESSION_RULES; ingen samlet mekaniktest |
| G06 | Scouting, fog of war, potentiale og informationsværdi | PROGRESSION_RULES; YOUTH_RULES; scout-system i FEATURE_REGISTRY | Inventeret; egen reglerute afklares ved læsning |
| G07 | Akademi, ungdomstrupper, karrierer og generationsskifte | YOUTH_RULES; RIDER_GENERATION; PROGRESSION_RULES | YOUTH_RULES læst; D-008: individuel ungdomsindsats valgfri; ingen samlet kodekontrol |
| G08 | Kalender, udtagelse, kapacitet og sæsonplan | CALENDAR_RULES; PLANNING_CENTER_RULES; ASSISTANT_RULES | Inventeret |
| G09 | Taktik, roller, løbsmotor og sportslig troværdighed | RACE_ENGINE_RULES | §0-1b, §2e og §9 læst; E-004 om hjælperrolle/holdarbejde; ikke samlet kontrolleret |
| G10 | At følge løbet, replay, forklaring og resultatoplevelse | RACE_ENGINE_RULES; FEATURE_REGISTRY; RaceDetailPage/RaceCentrePage | Inventeret |
| G11 | Ligaer, ranglister, kvalifikation, sæsonskift og genopbygning | CALENDAR_RULES; GAME_INVARIANTS; SEASON_TRANSITION_CHECKLIST | Inventeret |
| G12 | Økonomi, ressourcer, risiko, vækst og langtidsbalance | ECONOMY_RULES; GAME_INVARIANTS | ECONOMY_RULES delvist læst; påstande ikke genverificeret |
| G13 | Kontrakter, forhandling, transfer, auktion, bytte og lån | TRANSFER_MARKET_RULES; ECONOMY_RULES | TRANSFER_MARKET_RULES delvist læst, §2/§4 + kode/issue-stikprøve i E-002; D-007 valgt |
| G14 | Faciliteter, personale, klubidentitet og specialisering | FEATURE_REGISTRY; TRAINING_RULES; ECONOMY_RULES; #1149 | D-009 om fri omlægning valgt; DNA-genvalg kodekontrolleret i E-003; øvrig regeldækning afklares |
| G15 | Bestyrelse, sponsorer, ambition og handlefrihed | BOARD_RULES; SPONSOR_RULES | Rework afstemt i SSOT §0 med kode/PR/prod-bevis 10/9; D-003 valgt; ingen fuld mål-/konsekvenstest |
| G16 | AI-hold, verdensbefolkning, likviditet og skala | RIDER_GENERATION; TRANSFER_MARKET_RULES; #1151 | Inventeret |
| G17 | Sociale relationer, beskeder, forum og rivalisering | SOCIAL_RULES; FORUM_RULES | Inventeret |
| G18 | Historie, profiler, legender, anerkendelse og klubmuseum | SOCIAL_RULES; FEATURE_REGISTRY; #1148 | R-001/D-011–015: akademi/flere udviklingsklubber, tre sæsoner, offentlig + eget overblik, "Siden sidst"; Q-018 stillet; E-005; ingen UI-prøve |
| G19 | Dashboard, navigation, data, mobil/desktop og tilgængelighed | DASHBOARD_RULES; design/PAGE_TEMPLATES; design/TASTE | TASTE delvist læst; ruter inventeret |
| G20 | Premium, convenience, sportslig fairness og misbrug | BILLING_STACK; doctrine Fair competition; #1142; fairplay-rute | Doktrinens princip læst; øvrigt afventer |
| G21 | Notifikationer, kommunikation, surveys og spillerindflydelse | SOCIAL_RULES; COMMS_PLAYBOOK; EMAIL_STACK; SURVEY_SYSTEM | Inventeret |
| G22 | Spillerbevis, produktmåling og bæredygtig drift | ANALYTICS_STACK; GROWTH_STACK; FEATURE_REGISTRY | Inventeret; ingen aktuelle nøgletal vurderet |
| G23 | Tværgående sammenhæng og scenarier | GDD §7 + alle berørte SSOT'er | Afventer systemgennemgangen |

## Komplethedskontrol før samlet godkendelse

- Udvid hver områdelinje til dens faktiske mekanikker og spillerbeslutninger under gennemgangen.
- Afstem alle feature-ID'er og spillerrettede ruter til et område; begrund eventuelle fravalg.
- Registrér også pension, rollover, sweep, AI-handlinger og øvrige baggrundsregler.
- Afstem relevante ejerbeslutninger og åbne designspørgsmål i issues/specs med nyere SSOT'er.
- Gennemspil scenarier på tværs af områder og undersøg modstridende incitamenter.
- Dokumentér konkrete resterende huller; rapportér ikke "alt gennemgået" ud fra dette første inventar.
